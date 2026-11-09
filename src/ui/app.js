// The WI Hero editor: one element on document.body (BUILD_SPEC 8.1) that ST's World Info button opens instead of
// ST's drawer. Closing only hides it; after a reload it starts on Home (D6). N2 builds the shared chrome and normal
// mode (LAYOUT "Shared" and "Normal mode"). Its own styles live in a shadow root, so ST's CSS and WI Hero's can't
// clash; ST's theme variables still come through.
import { buildModel, isMoment } from '../engine/model.js';
import { btn, html, createLayer, el, issueText, longPress, pressable, swEl } from './dom.js';
import { ic } from './icons.js';
import {
    MIXED, PARAM_LIST, addEntry, addMoment, filterChoices, bookFolderOf, bookSettings, cardKey, commonValue, configOf, copyBookSettings,
    deleteBookSettings, duplicateEntry, entriesOf, entryAsText, folderOf, groupEntries, SORT_NAMES, sortEntries, idOf, isBlank, moveEntry,
    paramSummary, paramText, paramValue, rekeyEntry, removeEntry, renameBookSettings, search, setBookFolder, setFolder, setParam,
    strategyOf, titleOf,
} from './data.js';
import { editParam, paramRow, renderEntryPage, strategyColor } from './entry-page.js';
import { closedText, logicLines } from './logic-text.js';
import { IMPORTED, defaultSnapshotName } from './snapshots.js';
import { LR, PORT, TB, buildGraph, canvasBook, canvasSet, momentName } from './canvas-graph.js';
import { canvasMemory, mountCanvas } from './canvas.js';
import { entryStatus } from '../engine/turn.js';
import { getStringHash, isObject } from '../engine/util.js';
import { greetingFingerprint, greetingFpOf, greetingSignature, greetingsOf, openingGreeting } from '../chat-state.js';
import { addToList, bookEditor, greetingName, greetingRules, packsOf } from './pieces.js';
import { addLink } from './links.js';
import { renderGreetingInspector, renderInspector } from './inspector.js';
import { BAR, editExisting, mountPieceBar, startPiece } from './piecebar.js';
import { runPreview } from './preview.js';
import { renderPreviewPage } from './preview-page.js';
import { renderGuide } from './guide-page.js';
import { PIECE_ANCHOR } from './guide.js';
import { deskNormal, resizer } from './desk.js';

const COLOR_MODES = [['standard', 'Standard'], ['red-green', 'Red-green safe'], ['blue-yellow', 'Blue-yellow safe']];

/**
 * @param {object} deps
 *   { ctx, library, snapshots, hooks, settings, saveSettings, entryTemplate, cssUrl, openStEditor(), onVisible(open) }
 */
export function createApp(deps) {
    const { ctx, library, snapshots, hooks, settings, saveSettings } = deps;
    // The character filter's choices: ST's characters (by file name, as ST stores them) and tags.
    filterChoices.get = () => {
        const c = ctx();
        const chars = (c.characters ?? []).filter(x => x?.avatar).map(x => ({ key: String(x.avatar).replace(/\.[^.]+$/, ''), name: x.name }));
        const tags = (c.tags ?? []).filter(t => t?.id !== undefined).map(t => ({ key: t.id, name: t.name }));
        return { chars, tags };
    };

    // ---------------------------------------------------------------- DOM
    const host = document.createElement('div');
    host.id = 'wihero-editor';
    host.hidden = true;
    const shadow = host.attachShadow({ mode: 'open' });
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = deps.cssUrl;
    const root = el('div', 'wih');
    const tabbar = el('div', 'tabbar');
    const menuBtn = btn('iconbtn', ic('down'), () => openMenu(), 'Menu');
    const strip = el('div', 'strip');
    tabbar.append(menuBtn, strip);
    const main = el('div', 'main');
    const layerBox = el('div', 'layer');
    const toastBox = el('div', 'toast');
    toastBox.setAttribute('role', 'status');
    root.append(tabbar, main, layerBox, toastBox);
    shadow.append(link, root);
    document.body.append(host);
    const layer = createLayer(layerBox, toastBox);

    // Keys typed in WI Hero are its own: ST's hotkeys (arrows swipe, Enter sends) never see them.
    for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, e => e.stopPropagation());
    // Escape is Back while WI Hero is open, wherever the focus is (LAYOUT "Back").
    // Desktop keys (LAYOUT "Keys"): Ctrl K anywhere while WI Hero is open, the rest inside it.
    window.addEventListener('keydown', e => {
        if (!S.desk || host.hidden || e.defaultPrevented || e.key === 'Escape') return;
        if (document.querySelector('.popup[open], dialog[open]')) return;
        // In Hero mode a click on the list or the canvas can leave the focus on the page itself.
        const inside = e.composedPath().includes(host) || (S.mode === 'hero' && document.activeElement === document.body);
        const ctrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
        if (!inside && !ctrlK) return;
        const took = S.mode === 'hero' ? heroKey(e) : deskN.key(e);
        if (took) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    window.addEventListener('keydown', e => {
        if (e.key !== 'Escape' || host.hidden || e.defaultPrevented) return;
        if (document.querySelector('.popup[open], dialog[open]')) return; // an ST popup over everything
        e.preventDefault();
        e.stopPropagation();
        back();
    }, true);

    // ---------------------------------------------------------------- state (nothing here is saved, D6)
    let tabUid = 0;
    const S = {
        tabs: [{ id: ++tabUid, home: true, history: [{ type: 'home' }] }],
        active: 1,
        showOff: true,
        select: null, // Set of uids (book page) or names (Home)
        collapsed: new Set(),
        search: null, // { query }
        ui: { logic: false, params: false, defaults: false, condition: false },
        hiddenBooks: new Set(),
        hiddenEntries: new Map(), // book → Set(uid) waiting on an Undo toast
        mode: 'normal',
        // Hero mode (N3): one book's canvas, and entry tabs.
        hero: { book: null, tabs: [], active: 'canvas', explain: false, guide: null, panel: false, q: '', legend: false, chatState: false, closedFolders: new Set(), insp: null, pv: null, bar: { armed: null, edit: null }, dlist: null, dinsp: null, pick: [] },
        // Desktop (LAYOUT "Desktop"): where ST uses its desktop layout, wider than 1000px. Checked again on resize.
        desk: false,
    };
    const deskQuery = window.matchMedia?.('(min-width: 1001px)');
    S.desk = !!deskQuery?.matches;
    deskQuery?.addEventListener?.('change', () => { S.desk = deskQuery.matches; layer.close(); if (!host.hidden) render(); else pendingRender = true; });
    const deskSettings = () => (settings.desk ??= {});
    const tab = () => S.tabs.find(t => t.id === S.active) ?? S.tabs[0];
    const page = (t = tab()) => t.history.at(-1);

    // ---------------------------------------------------------------- helpers
    const visibleNames = () => library.names().filter(n => !S.hiddenBooks.has(n));
    const hiddenIn = book => S.hiddenEntries.get(book) ?? new Set();
    // Moments are entries in the book, but not in any entry list, search or count (CONCEPTS 3.13): they live on the
    // canvas and in the panel's Moments group. `linkable` is every entry a rule can name, Moments included.
    const entriesShown = (book, data) => entriesOf(data).filter(e => !hiddenIn(book).has(e.uid) && !isMoment(e));
    const momentsOf = (book, data) => entriesOf(data).filter(e => !hiddenIn(book).has(e.uid) && isMoment(e));
    const linkable = (book, data) => [...entriesShown(book, data), ...momentsOf(book, data)];
    /**
     * The engine's model of a book, built once per change: a Hero draw asks for it several times (problems, the
     * panel, the inspector, the piece bar's checks). Only the library's working copies are kept; a trial copy (the
     * piece bar tries an edit on one first) is built fresh each time.
     */
    const models = new WeakMap();
    // Built like the runtime's model (st-hooks), so a changed greeting shows here as it will play.
    const greetingFp = greetingFpOf(() => ctx().characters, getStringHash);
    const openCharacter = () => { const c = ctx(); return c.groupId ? null : c.characters?.[c.characterId] ?? null; };
    const buildBookModel = entries => buildModel(entries, { greetingFp });
    const modelOf = (book, data) => {
        const own = library.peek(book) === data;
        const kept = own ? models.get(data) : null;
        const greets = greetingSignature(openCharacter(), getStringHash);
        if (kept && kept.book === book && kept.version === library.version && kept.greets === greets) return kept.model;
        const model = buildBookModel(entriesOf(data).map(e => ({ ...e, world: book })));
        if (own) models.set(data, { book, version: library.version, greets, model });
        return model;
    };
    const problemsOf = (model, uid, book) => model.issues.filter(i => i.stKey === `${book}.${uid}` && !i.warning && i.blocking !== false);
    const linkText = name => { const l = library.links(name); return l.length ? `${l[0].name}${l.length > 1 ? ` +${l.length - 1}` : ''}` : ''; };
    const entryFolder = (book, e) => folderOf(settings, book, e);

    /**
     * Loads a book, then redraws once it is in. One redraw per book, however many draws asked for it while it
     * loaded (each draw used to add its own, and a list of books snowballed into thousands of redraws).
     * A page that opens a book also asks for its As imported copy (library.seen).
     */
    const waiting = new Set();
    /** book → why it could not be loaded. */
    const loadFailed = new Map();
    function need(book, { open = true } = {}) {
        const data = library.peek(book);
        if (data) { if (open) library.seen(book); return data; }
        if (!waiting.has(book) && !loadFailed.has(book)) {
            waiting.add(book);
            const fail = why => {
                waiting.delete(book);
                // Kept until WI Hero is closed, so a page that needs the book doesn't ask again on every draw.
                loadFailed.set(book, why);
                if (open) layer.toast(`Could not load ${book}: ${why}`);
                scheduleRender();
            };
            library.get(book).then(d => {
                if (!d) { if (library.names().includes(book)) fail('it came back empty'); else waiting.delete(book); return; }
                waiting.delete(book);
                scheduleRender();
            }, e => { console.error('[WI Hero] Could not load', book, e); fail(e?.message || 'an error'); });
        }
        return null;
    }
    /** What a page shows while its book isn't there: still loading, or why it couldn't be. */
    const loadingNote = book => (loadFailed.has(book) ? `Could not load ${book}: ${loadFailed.get(book)}.` : 'Loading…');

    /**
     * Home's entry counts: books load in the background, a few at a time, and each count is written into its row
     * as it comes in. Nothing is redrawn, so the list scrolls and taps while books are still loading.
     */
    const counting = [];
    let countsRunning = 0;
    const countSpans = new Map(); // book → the span showing its count now
    function countInto(name, span, fmt = null) {
        if (fmt) span.dataset.bare = '1';
        countSpans.set(name, span);
        if (!counting.includes(name)) counting.push(name);
        pumpCounts();
    }
    function pumpCounts() {
        while (countsRunning < 3 && counting.length) {
            const name = counting.shift();
            countsRunning++;
            library.get(name).then(d => {
                const span = countSpans.get(name);
                if (d && span?.isConnected) span.textContent = span.dataset.bare ? String(entriesShown(name, d).length) : (n => `${n} ${n === 1 ? 'entry' : 'entries'}`)(entriesShown(name, d).length);
            }, () => {}).finally(() => { countsRunning--; pumpCounts(); });
        }
    }

    /** One redraw on the next frame, however many things asked for it. */
    let renderQueued = false;
    function scheduleRender() {
        if (renderQueued) return;
        renderQueued = true;
        requestAnimationFrame(() => { renderQueued = false; refresh(); });
    }

    // ---------------------------------------------------------------- render
    let pendingRender = false;
    const typing = () => {
        const a = shadow.activeElement;
        return !!a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && !layerBox.contains(a)) || a.isContentEditable);
    };
    /** Redraw, unless something is being typed into: then once the typing is done. */
    function refresh() {
        if (host.hidden) { pendingRender = true; return; }
        if (typing()) { pendingRender = true; renderTabs(); return; }
        render();
    }
    // A narrow drawer (desk.js) lays the book out as list then entry: crossing that width (Chat width, a side panel
    // beside a widened drawer) draws again.
    let wasNarrow = null;
    if (globalThis.ResizeObserver) new ResizeObserver(() => {
        const n = root.clientWidth > 0 && root.clientWidth < 640;
        if (wasNarrow !== null && n !== wasNarrow && S.desk && S.mode === 'normal') refresh();
        wasNarrow = n;
    }).observe(root);
    root.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !typing()) render(); }, 0));

    function render() {
        pendingRender = false;
        root.dataset.colors = settings.colorMode ?? 'standard';
        root.style.setProperty('--content-font', settings.contentFont === 'sans' ? 'var(--sans)' : 'var(--serif)');
        root.dataset.mode = S.mode;
        shape();
        if (S.mode === 'hero') { renderHero(); return; }
        if (S.desk) { renderTabs(); deskN.render(); return; }
        renderTabs();
        const p = page();
        const old = main.querySelector('.view');
        if (old && main.dataset.page === pageId(p)) p.scroll = old.scrollTop;
        main.innerHTML = '';
        main.dataset.page = pageId(p);
        if (p.type === 'entry') renderEntry(p);
        else if (p.type === 'book') renderBook(p);
        else renderHome();
        if (p.type !== 'entry') main.append(S.select ? selBar(p) : bottomBar(p));
        if (S.search) renderSearch();
        const view = main.querySelector('.view');
        if (view && p.scroll) view.scrollTop = p.scroll;
    }
    const pageId = p => `${tab().id}:${p.type}:${p.book ?? ''}:${p.uid ?? ''}`;

    /**
     * Desktop size and place (LAYOUT "Size and place"): normal mode, and Hero mode at drawer size, take ST's World
     * Info drawer's box (under the top bar, Chat width wide, above the send form); Hero mode opens widened, over the
     * whole window under the top bar. Phones keep the whole screen.
     */
    function shape() {
        const wide = S.desk && S.mode === 'hero' && deskSettings().heroWide !== false;
        // Normal mode's Widen: the space ST's open side panels leave, still above the send form.
        const nwide = S.desk && S.mode === 'normal' && deskSettings().normalWide === true;
        root.dataset.desk = S.desk ? '1' : '';
        host.classList.toggle('desk', S.desk);
        host.classList.toggle('wide', wide);
        host.classList.toggle('nwide', nwide);
        layer.pop.desk = S.desk;
    }

    function pageTitle(p) {
        if (p.type === 'home') return 'Home';
        if (p.type === 'book') return p.book;
        const e = library.peek(p.book)?.entries[p.uid];
        return e ? (e.comment || 'New entry') : 'Entry';
    }

    function renderTabs() {
        strip.innerHTML = '';
        tabbar.querySelector('.tright')?.remove();
        if (S.mode === 'hero') { renderHeroTabs(); return; }
        if (S.desk) { deskN.renderTabs(strip, tabbar); revealActiveTab(); return; }
        for (const t of S.tabs) {
            const p = page(t);
            const active = t.id === S.active;
            const b = el('button', `tab${active ? ' active' : ''}${t.home ? ' fixed' : ''}`);
            b.type = 'button';
            if (t.home) {
                b.innerHTML = ic('home');
                b.setAttribute('aria-label', 'Home');
                b.addEventListener('click', () => { leave(); S.active = t.id; t.history = [{ type: 'home' }]; S.select = null; S.search = null; render(); });
            } else {
                if (p.type === 'entry') {
                    const e = library.peek(p.book)?.entries[p.uid];
                    if (e) { const d = el('i', 'sd'); d.style.background = strategyColor(e); b.append(d); }
                }
                b.append(el('span', 'name', pageTitle(p)));
                b.addEventListener('click', () => { if (S.active !== t.id) { S.active = t.id; S.select = null; S.search = null; render(); } });
                if (active) {
                    const x = el('span', 'x');
                    x.innerHTML = ic('x');
                    x.setAttribute('role', 'button');
                    x.setAttribute('aria-label', 'Close tab');
                    x.addEventListener('click', e => { e.stopPropagation(); closeTab(t.id); });
                    b.append(x);
                }
            }
            strip.append(b);
        }
        revealActiveTab();
    }

    /** Scrolls the active tab into view, only when it changed: on every draw it forced a layout each time. */
    let shownTab = null;
    function revealActiveTab() {
        const a = strip.querySelector('.tab.active');
        const key = `${S.mode}:${S.mode === 'hero' ? H.active : S.active}`;
        if (!a || key === shownTab) return;
        shownTab = key;
        a.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
    }

    // ---------------------------------------------------------------- navigation

    /** Leaving the current page: a new entry left completely empty is discarded. */
    function leave(p = page()) {
        if (p?.type !== 'entry' || !p.fresh) return;
        delete p.fresh;
        const e = library.peek(p.book)?.entries[p.uid];
        if (e && isBlank(e)) {
            library.change(p.book, d => { removeEntry(d, p.uid); }, { quiet: true });
            layer.toast('Empty entry removed');
        }
    }

    /** Opens a page: from Home's tab (or with `newTab`) in a new tab, otherwise in this tab's history. */
    function openIn(p, { newTab = false, background = false } = {}) {
        if (S.desk && S.mode === 'normal') {
            // Desktop: a book opens in a tab of its own; an entry shows in its book's tab, or its own tab when asked.
            if (p.type === 'book') { deskN.openBook(p.book, { background }); return; }
            if (p.type === 'entry') { if (newTab || background) deskN.openEntryTab(p.book, p.uid, { background }); else deskN.showInBook(p.book, p.uid); return; }
        }
        const t = tab();
        S.select = null;
        S.search = null;
        if (newTab || t.home) {
            const n = { id: ++tabUid, history: [p] };
            S.tabs.splice(S.tabs.indexOf(t) + 1, 0, n);
            if (background) { renderTabs(); layer.toast('Opened in a background tab'); return; }
            S.active = n.id;
        } else if (t.fresh) {
            leave();
            t.history = [p];
            delete t.fresh;
        } else {
            leave();
            t.history.push(p);
        }
        render();
    }

    function closeTab(id) {
        const i = S.tabs.findIndex(t => t.id === id);
        if (i < 0 || S.tabs[i].home) return;
        if (id === S.active) leave();
        S.tabs.splice(i, 1);
        if (S.active === id) S.active = (S.tabs[i] ?? S.tabs[i - 1] ?? S.tabs[0]).id; // the next tab slides into its place
        S.select = null;
        render();
    }

    function up() {
        const t = tab();
        const p = page();
        leave();
        if (t.history.length > 1) t.history.pop();
        else t.history = [{ type: 'book', book: p.book }];
        render();
    }

    /** Back (Android) and Escape: sheet → search → selection → the tab's history → close the tab → close the editor. */
    function back() {
        if (S.desk && S.mode === 'normal') return deskN.back();
        if (layer.isOpen()) { layer.close(); return true; }
        if (S.mode === 'hero') return heroBack();
        if (S.search) { S.search = null; render(); return true; }
        if (S.select) { S.select = null; render(); return true; }
        const t = tab();
        if (t.history.length > 1) { leave(); t.history.pop(); render(); return true; }
        if (!t.home) { closeTab(t.id); return true; }
        hide();
        return false;
    }

    // ---------------------------------------------------------------- open and close (D6)
    function show() {
        if (!host.hidden) return;
        host.hidden = false;
        pushBackState();
        render();
        deps.onVisible?.(true);
    }
    function hide() {
        if (host.hidden) return;
        leave();
        layer.close();
        layer.flushToast();
        host.hidden = true;
        library.flush().catch(() => {}); // a failed save is reported by the library
        loadFailed.clear();
        if (history.state?.wihero) { ignorePop = true; history.back(); }
        deps.onVisible?.(false);
    }
    const toggle = () => (host.hidden ? show() : hide());

    /** Opens the editor on a book, when ST asks for one (a card's lorebook just imported, a lorebook button). */
    function openBook(name) {
        if (!library.names().includes(name)) { show(); return; }
        if (S.mode === 'hero') {
            H.book = name;
            H.active = 'canvas';
            H.panel = false;
        } else {
            const t = S.tabs.find(x => !x.home && x.history.at(-1)?.type === 'book' && x.history.at(-1).book === name);
            if (t) { S.active = t.id; S.select = null; S.search = null; } else openIn({ type: 'book', book: name }, { newTab: true });
        }
        if (host.hidden) show(); else render();
    }
    const isOpen = () => !host.hidden;

    // Android's Back arrives as popstate: one history entry is pushed while the editor is open.
    let ignorePop = false;
    function pushBackState() { if (!history.state?.wihero) history.pushState({ wihero: true }, ''); }
    window.addEventListener('popstate', () => {
        if (ignorePop) { ignorePop = false; return; }
        if (host.hidden) return;
        if (back() && !host.hidden) pushBackState();
    });

    // ---------------------------------------------------------------- Home
    function renderHome() {
        const v = el('div', 'view');
        main.append(v);
        const names = visibleNames();
        if (S.select) v.append(selHead(names, 'books'));
        else {
            const h = el('div', 'head');
            h.append(el('h1', '', 'World Info'), btn('round flat', ic('gear'), wiSettingsSheet, 'World Info settings'));
            v.append(h);
        }
        const folders = Object.keys(settings.bookFolders).filter(f => settings.bookFolders[f].some(n => names.includes(n))).sort((a, b) => a.localeCompare(b));
        const loose = names.filter(n => !bookFolderOf(settings, n));
        v.append(el('div', 'section', 'Books'));
        for (const n of loose) v.append(bookRow(n));
        for (const f of folders) {
            const list = settings.bookFolders[f].filter(n => names.includes(n)).sort((a, b) => a.localeCompare(b));
            const key = `home:${f}`;
            const open = !S.collapsed.has(key);
            v.append(sectionHead(`${f} · ${list.length}`, open, () => { open ? S.collapsed.add(key) : S.collapsed.delete(key); render(); }, S.select ? list : null));
            if (open) for (const n of list) v.append(bookRow(n));
        }
        if (!names.length) v.append(el('div', 'empty-note', 'No books yet. Tap + to make the first one.'));
    }

    function bookRow(name) {
        const it = el('div', 'item');
        it.dataset.book = name;
        if (S.select) it.append(check(S.select.has(name)));
        const i = el('div', 'ic');
        i.innerHTML = ic('book');
        const tx = el('div', 'txt');
        tx.append(el('div', 't', name));
        const m = el('div', 'm');
        const data = library.peek(name);
        const count = el('span', '', data ? `${entriesShown(name, data).length} entries` : '…');
        if (!data) countInto(name, count);
        m.append(count);
        const global = library.isGlobal(name);
        const lt = linkText(name);
        if (library.unsaved?.(name)) { const u = el('span', 'badge u', 'Not saved'); u.title = 'Saving failed. Your edits are kept here; the next change tries again'; m.append(u); }
        if (global) m.append(el('span', 'badge g', 'Global'));
        if (lt) { const l = el('span', 'badge l'); l.innerHTML = ic('chain', 's'); l.append(lt); m.append(l); }
        if (!global && !lt) { const o = el('span', 'badge o', 'Off'); o.title = 'No chat uses it. Open the book to use it in a chat or make it global'; m.append(o); }
        tx.append(m);
        it.append(i, tx);
        if (!S.select) it.append(btn('more', ic('more'), () => bookMenu(name, { fromHome: true }), `${name} actions`));
        pressable(it, () => {
            if (S.select) { toggleSel(name); return; }
            if (settings.openInHero) { S.hero.book = name; switchMode(); return; }
            openIn({ type: 'book', book: name });
        }, S.select ? null : () => openIn({ type: 'book', book: name }, { newTab: true, background: true }));
        return it;
    }

    // ---------------------------------------------------------------- book page
    function renderBook(p) {
        const v = el('div', 'view');
        main.append(v);
        const data = need(p.book);
        if (!library.names().includes(p.book) && !data) { v.append(el('div', 'empty-note', 'This book was deleted or renamed.')); return; }
        if (!data) { v.append(el('div', 'empty-note', loadingNote(p.book))); return; }
        const book = p.book;
        const model = modelOf(book, data);
        const all = entriesShown(book, data);
        const shown = all.filter(e => S.showOff || !e.disable);

        if (S.select) v.append(selHead(shown.map(e => e.uid), 'entries'));
        else {
            const h = el('div', 'head');
            if (tab().history.length > 1) h.append(btn('round flat', ic('back'), back, 'Back'));
            const bn = el('button', 'bkname');
            bn.type = 'button';
            bn.append(el('h1', '', book), el('span', 'car', '▾'));
            bn.addEventListener('click', () => bookMenu(book, { fromPage: true }));
            h.append(bn);
            v.append(h);
            const chips = el('div', 'bkchips');
            const global = library.isGlobal(book);
            const g = btn(`chip2${global ? ' on' : ''}`, html`<i class="dot"></i><span>Global</span>`, () => {
                library.setGlobal(book, !global);
                layer.toast(!global ? `${book} is active everywhere` : `${book} is no longer global`);
                render();
            }, 'Active globally');
            g.setAttribute('aria-pressed', String(global));
            const lk = btn('chip2', html`${ic('chain', 's')}<span></span>`, () => linksSheet(book), 'Links');
            lk.querySelector('span').textContent = linkText(book) || 'Not linked';
            chips.append(g, lk);
            v.append(chips);
            const off = offHint(book);
            if (off) v.append(off);
            v.append(...defaultsBlock(book));
        }

        const groups = groupEntries(shown, sortBy(), e => entryFolder(book, e));
        for (const f of bookSettings(settings, book).folderList ?? []) if (!groups.some(([g]) => g === f)) groups.push([f, []]);
        groups.sort(([a], [b]) => (a !== '') - (b !== '') || a.localeCompare(b));
        for (const [g, list] of groups) {
            const key = `${book}:folder:${g}`;
            const open = !S.collapsed.has(key);
            if (g) {
                const head = sectionHead(`${g} · ${list.length}`, open, () => { open ? S.collapsed.add(key) : S.collapsed.delete(key); render(); }, S.select ? list.map(e => e.uid) : null);
                if (!S.select) head.append(btn('add', ic('plus', 's'), () => newEntry(book, g), `New entry in ${g}`));
                v.append(head);
                if (!open) continue;
            } else if (groups.length > 1) {
                v.append(el('div', 'section', 'No folder'));
            }
            for (const e of list) v.append(entryRow(book, e, model));
        }
        if (!shown.length) v.append(el('div', 'empty-note', all.length ? 'Every entry is off, and off entries are hidden (⌄ menu).' : 'No entries yet. Tap + to write the first one.'));
    }

    function entryRow(book, e, model) {
        const it = el('div', `item ent st-${strategyOf(e)}`);
        it.dataset.uid = e.uid;
        if (S.select) it.append(check(S.select.has(e.uid)));
        // Just the strategy stripe (no icon: it was the same on every row), and the teal dot desktop shows for an
        // entry with story logic.
        const i = el('div', 'ic');
        const tx = el('div', 'txt');
        const t = el('div', 't');
        t.append(el('span', 'nm', titleOf(e)));
        const c = configOf(e);
        if (c && Object.keys(c).some(k => k !== 'id')) { const d = el('i', 'ldot'); d.title = 'Has story logic'; t.append(d); }
        if (problemsOf(model, e.uid, book).length) { const b = el('span', 'bang', '!'); b.title = 'This entry has a problem'; t.append(b); }
        tx.append(t, el('div', 'm', e.constant ? 'Permanent' : `${(e.key ?? []).join(', ') || 'No key words'}${e.vectorized ? ' · vectorized' : ''}`));
        it.append(i, tx);
        if (!S.select) {
            it.append(swEl(!e.disable, on => library.change(book, d => { d.entries[e.uid].disable = !on; }), `${titleOf(e)} on`));
            it.append(btn('more', ic('more'), () => entryMenu(book, e.uid), `${titleOf(e)} actions`));
        }
        pressable(it, () => {
            if (S.select) { toggleSel(e.uid); return; }
            openIn({ type: 'entry', book, uid: e.uid });
        }, S.select ? null : () => openIn({ type: 'entry', book, uid: e.uid }, { newTab: true, background: true }));
        return it;
    }

    /** New entry defaults: folded, the header sums up what isn't default. */
    function defaultsBlock(book) {
        const defaults = bookSettings(settings, book).defaults ??= {};
        const fake = { ...defaults, extensions: defaults.by ? { wihero: { by: defaults.by } } : undefined };
        const d = el('button', `disc small${S.ui.defaults ? ' open' : ''}`);
        d.type = 'button';
        d.innerHTML = `${ic('right', 'chev')}<h2>New entry defaults</h2>`;
        d.append(el('span', 'sum', paramSummary(fake)));
        d.addEventListener('click', () => { S.ui.defaults = !S.ui.defaults; render(); });
        const out = [d];
        if (S.ui.defaults) {
            const box = el('div', 'defaults');
            for (const p of PARAM_LIST) {
                if (p.when && !p.when(fake)) continue;
                const value = paramValue(fake, p);
                box.append(paramRow(p, paramText(fake, p), value !== p.def, () => editParam(layer, p, value, x => {
                    if (x === p.def || x === null) delete defaults[p.field]; else defaults[p.field] = x;
                    saveSettings();
                    render();
                })));
            }
            out.push(box);
        }
        return out;
    }

    function sectionHead(text, open, onToggle, selectable) {
        const s = el('div', 'section');
        if (selectable) {
            const all = selectable.length && selectable.every(x => S.select.has(x));
            const c = check(all);
            c.setAttribute('role', 'checkbox');
            c.setAttribute('aria-label', `Select ${text}`);
            c.addEventListener('click', () => { for (const x of selectable) all ? S.select.delete(x) : S.select.add(x); render(); });
            s.append(c);
        }
        const b = btn(open ? 'open' : '', html`${ic('right')}<span></span>`, onToggle);
        b.querySelector('span').textContent = text;
        b.setAttribute('aria-expanded', String(open));
        s.append(b);
        return s;
    }

    function check(on) {
        const c = el('span', `check${on ? ' on' : ''}`);
        if (on) c.innerHTML = ic('check');
        return c;
    }

    // ---------------------------------------------------------------- bottom bar, selection
    function bottomBar(p) {
        const bb = el('nav', 'bottombar');
        bb.append(btn('', ic('search'), () => { S.search = { query: '' }; render(); }, 'Search'));
        bb.append(btn('', ic('plus'), () => (p.type === 'book' ? newEntry(p.book) : homePlus()), p.type === 'book' ? 'New entry' : 'New book or import'));
        bb.append(btn('', ic('select'), () => { S.select = new Set(); render(); }, 'Select'));
        return bb;
    }

    function toggleSel(x) {
        S.select.has(x) ? S.select.delete(x) : S.select.add(x);
        render();
    }

    function selHead(all, what) {
        const h = el('div', 'selhead');
        h.append(btn('', ic('x'), () => { S.select = null; render(); }, 'Leave selection'));
        h.append(el('span', 'cnt', `${S.select.size} selected`));
        const everything = all.length && all.every(x => S.select.has(x));
        h.append(btn('', everything ? 'None' : 'All', () => { S.select = everything ? new Set() : new Set(all); render(); }));
        h.append(btn('', 'Invert', () => { S.select = new Set(all.filter(x => !S.select.has(x))); render(); }));
        const d = btn('danger', 'Delete', () => {
            const list = [...S.select];
            S.select = null;
            if (what === 'books') deleteBooks(list); else deleteEntries(page().book, list);
        });
        d.disabled = !S.select.size;
        h.append(d);
        return h;
    }

    function selBar(p) {
        const bar = el('div', 'selbar');
        const act = (icon, label, fn) => { const b = btn('', html`${ic(icon)}<span>${label}</span>`, fn); b.disabled = !S.select.size; bar.append(b); };
        if (p.type === 'book') {
            const book = p.book;
            const sel = () => [...S.select];
            act('move', 'Move', () => folderSheet(book, null, f => {
                const data = library.peek(book);
                for (const uid of sel()) if (data.entries[uid]) setFolder(settings, book, data.entries[uid], f);
                saveSettings();
                S.select = null;
                render();
            }));
            act('on', 'On', () => library.change(book, d => { for (const uid of sel()) if (d.entries[uid]) d.entries[uid].disable = false; }));
            act('off', 'Off', () => library.change(book, d => { for (const uid of sel()) if (d.entries[uid]) d.entries[uid].disable = true; }));
            act('edit', 'Edit…', () => bulkEdit(book, sel()));
        } else {
            act('move', 'Move', () => bookFolderSheet(f => {
                for (const n of S.select) setBookFolder(settings, n, f);
                saveSettings();
                S.select = null;
                render();
            }));
            act('code', 'Export', async () => { for (const n of S.select) await library.exportBook(n); });
            const imp = btn('', html`${ic('import')}<span>Import</span>`, importBook);
            bar.append(imp); // needs no selection
        }
        return bar;
    }

    /** Edit…: the entry page's parameter rows for every selected entry; rows that differ say Mixed. */
    function bulkEdit(book, uids) {
        const draw = () => layer.sheet(`Edit ${uids.length} entr${uids.length === 1 ? 'y' : 'ies'}`, sh => {
            const data = library.peek(book);
            const list = uids.map(u => data.entries[u]).filter(Boolean);
            for (const p of PARAM_LIST) {
                if (p.when && !list.every(p.when)) continue;
                const value = commonValue(list, p);
                const text = value === MIXED ? 'Mixed' : paramText(list[0], p);
                sh.append(layer.opt(p.label, () => editParam(layer, p, value === MIXED ? null : value, x => {
                    library.change(book, d => { for (const u of uids) if (d.entries[u]) applyParam(book, d, u, p, x); });
                    draw();
                }), { val: text }));
            }
        }, { help: 'Only the rows you change are applied, to every selected entry.' });
        draw();
    }

    function applyParam(book, data, uid, p, value) {
        const had = idOf(data.entries[uid]);
        setParam(data, uid, p, value);
        const now = idOf(data.entries[uid]);
        if (!had && now) { rekeyEntry(settings, book, uid, now); saveSettings(); }
    }

    // ---------------------------------------------------------------- search
    function renderSearch() {
        const s = el('div', 'search');
        const bar = el('div', 'bar');
        bar.append(btn('round flat', ic('back'), () => { S.search = null; render(); }, 'Close search'));
        const input = el('input');
        input.placeholder = 'Search books and entries';
        input.setAttribute('aria-label', 'Search');
        input.value = S.search.query;
        bar.append(input);
        const res = el('div', 'res');
        s.append(bar, res);
        main.append(s);
        const names = visibleNames();
        for (const n of names) need(n, { open: false });
        const run = () => {
            S.search.query = input.value;
            res.innerHTML = '';
            const books = names.map(n => ({ name: n, folder: bookFolderOf(settings, n), entries: library.peek(n) ? entriesShown(n, library.peek(n)) : [], folderOf: e => entryFolder(n, e) }));
            const hits = search(books, input.value, page().book);
            if (!input.value.trim()) { res.append(el('div', 'empty-note', page().book ? 'Type to search every book: names, folders and key words. Entries of the open book come first.' : 'Type to search every book: names, folders and key words. Books come first.')); return; }
            if (!hits.length) { res.append(el('div', 'empty-note', 'Nothing found.')); return; }
            for (const h of hits.slice(0, 80)) {
                const it = el('div', `item${h.kind === 'entry' ? ` ent st-${strategyOf(h.entry)}` : ''}`);
                const i = el('div', 'ic');
                i.innerHTML = ic(h.kind === 'entry' ? 'entry' : h.kind === 'book' ? 'book' : 'folder');
                const tx = el('div', 'txt');
                const title = h.kind === 'entry' ? titleOf(h.entry) : h.kind === 'book' ? h.book : h.folder;
                const meta = h.kind === 'entry' ? `${h.book}${entryFolder(h.book, h.entry) ? ` · ${entryFolder(h.book, h.entry)}` : ''}`
                    : h.kind === 'book' ? 'Book' : h.book ? `Folder in ${h.book}` : 'Book folder';
                tx.append(el('div', 't', title), el('div', 'm', meta));
                it.append(i, tx);
                const behind = h.kind === 'entry' ? { type: 'entry', book: h.book, uid: h.entry.uid } : h.kind === 'book' ? { type: 'book', book: h.book } : null;
                pressable(it, () => {
                    if (h.kind === 'entry') openIn({ type: 'entry', book: h.book, uid: h.entry.uid }, { newTab: true });
                    else if (h.kind === 'book') openIn({ type: 'book', book: h.book }, { newTab: true });
                    else if (h.book) { S.collapsed.delete(`${h.book}:folder:${h.folder}`); openIn({ type: 'book', book: h.book }, { newTab: true }); }
                    else { S.collapsed.delete(`home:${h.folder}`); S.search = null; S.active = S.tabs[0].id; S.tabs[0].history = [{ type: 'home' }]; render(); }
                }, behind && (() => openIn(behind, { newTab: true, background: true })));
                res.append(it);
            }
        };
        input.addEventListener('input', run);
        run();
        setTimeout(() => { if (shadow.activeElement !== input) input.focus(); }, 0);
    }

    // ---------------------------------------------------------------- entry page
    function renderEntry(p, nav = null, into = main, extra = {}) {
        const data = need(p.book);
        if (!data) { const v = el('div', 'view'); v.append(el('div', 'empty-note', library.names().includes(p.book) ? loadingNote(p.book) : 'This book was deleted or renamed.')); into.append(v); return; }
        const e = data.entries[p.uid];
        if (!e || hiddenIn(p.book).has(p.uid)) { const v = el('div', 'view'); v.append(el('div', 'empty-note', 'This entry was deleted.')); into.append(v); return; }
        const book = p.book;
        const model = modelOf(book, data);
        const node = model.byStKey.get(`${book}.${e.uid}`);
        const lines = node ? logicLines(node, model) : [];
        const incoming = new Set();
        if (node?.key) {
            const label = k => model.nodes.get(k)?.label;
            for (const i of node.opens.all) if (i.source && i.source !== node.key && label(i.source)) incoming.add(label(i.source));
            for (const cl of node.closes) if (cl.source && cl.source !== node.key && label(cl.source)) incoming.add(label(cl.source));
            for (const k of model.riders?.get(node.key) ?? []) if (label(k)) incoming.add(label(k));
        }
        let closed = null;
        const loaded = hooks.model;
        if (node?.key && loaded.nodes.has(node.key) && ctx().chat?.length) {
            const c = hooks.state().closed[node.key];
            if (c) {
                closed = {
                    by: closedText(c.by, key => loaded.nodes.get(key)?.label ?? (key.startsWith('@') ? 'a greeting' : null)),
                    reopen: async () => { await hooks.reopenEntry(node.key); layer.toast(`${titleOf(e)} is open again in this chat`); render(); },
                };
            }
        }
        S.ui.condition = !!p.condition;
        renderEntryPage(into, {
            entry: e,
            bookName: book,
            folder: entryFolder(book, e),
            layer,
            ui: new Proxy(S.ui, { set: (t, k, v) => { t[k] = v; if (k === 'condition') p.condition = v; return true; } }),
            problems: problemsOf(model, e.uid, book).map(i => i.message.replace(/^./, ch => ch.toUpperCase())),
            lines,
            incoming: [...incoming],
            closed,
            fresh: !!p.fresh && !e.comment,
            change: (fn, quiet) => library.change(book, d => fn(d.entries[p.uid]), { quiet }),
            setParam: (param, value) => library.change(book, d => applyParam(book, d, p.uid, param, value)),
            up: nav?.up ?? up,
            hero: !!nav,
            showOnCanvas: () => showOnCanvas(book, cardKey(e)),
            data: () => dataSheet(e),
            openInHero: () => switchMode(cardKey(e)),
            masks: nav ? (configOf(e)?.masks ?? []).filter(x => isObject(x) && typeof x.name === 'string') : [],
            mask: nav?.tab?.mask ?? null,
            setMask: name => { if (nav?.tab) { nav.tab.mask = name; render(); } },
            changeMask: (name, text) => library.change(book, d => bookEditor(d).update(e.uid, c => { const m = c.masks?.find(x => x.name === name); if (m) m.content = text; }), { quiet: true }),
            chatOpen: !!ctx().chat?.length && !!node?.key && hooks.model.nodes.has(node.key),
            activeMask: (() => { try { return node?.key && hooks.model.nodes.has(node.key) && ctx().chat?.length ? entryStatus(hooks.model.nodes.get(node.key), hooks.state(), ctx().chat, hooks.model).mask : null; } catch { return null; } })(),
            redraw: render,
            retitle: renderTabs,
            // In the book page's grouping and order; long press opens one in a background tab.
            drawer: () => layer.sheet(book, sh => {
                const groups = groupEntries(entriesShown(book, data), sortBy(), x => entryFolder(book, x));
                for (const [g, list] of groups) {
                    if (g) sh.append(el('div', 'lbl', g));
                    else if (groups.length > 1) sh.append(el('div', 'lbl', 'No folder'));
                    for (const x of list) {
                        const o = layer.opt(titleOf(x), () => { layer.close(); if (nav) { nav.go(x.uid); return; } leave(); tab().history[tab().history.length - 1] = { type: 'entry', book, uid: x.uid }; render(); },
                            { cur: x.uid === e.uid, dot: strategyColor(x) });
                        longPress(o, () => {
                            if (nav) { if (!H.tabs.some(t => t.book === book && t.uid === x.uid)) H.tabs.push({ book, uid: x.uid }); renderTabs(); layer.toast('Opened in a background tab'); }
                            else openIn({ type: 'entry', book, uid: x.uid }, { newTab: true, background: true });
                        });
                        sh.append(o);
                    }
                }
            }),
            menu: () => entryMenu(book, e.uid, { onPage: !nav, heroTab: nav }),
            ...extra,
            tokens: text => (ctx().getTokenCountAsync ? ctx().getTokenCountAsync(text) : Promise.resolve(null)),
        });
    }

    // ---------------------------------------------------------------- creating
    function newEntry(book, folder = '') {
        const data = library.peek(book);
        if (!data) return;
        const defaults = { ...(bookSettings(settings, book).defaults ?? {}) };
        const by = defaults.by;
        delete defaults.by;
        const entry = library.change(book, d => {
            const x = addEntry(d, deps.entryTemplate, defaults);
            if (by) setParam(d, x.uid, PARAM_LIST.find(q => q.field === 'by'), by);
            return x;
        }, { quiet: true });
        if (folder) { setFolder(settings, book, entry, folder); saveSettings(); }
        openIn({ type: 'entry', book, uid: entry.uid, fresh: true });
    }

    /**
     * The Off hint (LAYOUT "Book page"): a book that is neither global nor linked reaches no chat, so its page says
     * how to use it. Null when the book is used somewhere.
     */
    function offHint(book) {
        if (library.isGlobal(book) || linkText(book)) return null;
        const box = el('div', 'offhint');
        box.append(el('b', '', 'Off'), el('span', '', 'No chat uses this book yet.'));
        const acts = el('span', 'acts');
        if (library.chatOpen()) acts.append(btn('linkish acc', 'Use it in this chat', async () => { await library.linkChat(book); layer.toast(`${book} is linked to this chat`); render(); }));
        else acts.append(btn('linkish acc', 'Link it to a character…', () => linksSheet(book)));
        acts.append(btn('linkish', 'Make it global', () => { library.setGlobal(book, true); layer.toast(`${book} is active everywhere`); render(); }));
        box.append(acts);
        return box;
    }

    /** Import (LAYOUT "Home"): a lorebook file through ST's own import, then the book opens in a tab. */
    function importBook() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.png,application/json,image/png';
        input.addEventListener('change', async () => {
            const file = input.files?.[0];
            if (!file) return;
            try {
                const name = await library.importFile(file);
                if (!name) return; // ST said why (or the overwrite was declined)
                S.select = null;
                openIn({ type: 'book', book: name }, { newTab: true });
                layer.toast(`Imported ${name}`);
            } catch (e) { layer.toast(`Could not import ${file.name}: ${e.message}`); }
        });
        input.click();
    }

    /** Phones: + on Home is a small menu, New book or Import. */
    function homePlus() {
        layer.sheet('Add', sh => {
            sh.append(layer.opt('New book', () => { layer.close(); newBook(); }, { icon: 'plus' }));
            sh.append(layer.opt('Import a file…', () => { layer.close(); importBook(); }, { icon: 'import', sub: 'A lorebook from SillyTavern (JSON), NovelAI, Agnai or Risu' }));
        });
    }

    function newBook() {
        layer.askText({
            title: 'New book', placeholder: 'Book name', ok: 'Create', check: n => library.nameProblem(n),
            done: async n => {
                try {
                    const name = await library.create(n);
                    openIn({ type: 'book', book: name }, { newTab: true });
                } catch (e) { layer.toast(`Could not make ${n}: ${e.message}`); }
            },
        });
    }

    // ---------------------------------------------------------------- deleting, with Undo (never asks)
    function deleteEntries(book, uids) {
        const data = library.peek(book);
        if (!data || !uids.length) return;
        const set = new Set(hiddenIn(book));
        for (const u of uids) set.add(u);
        S.hiddenEntries.set(book, set);
        const one = uids.length === 1 ? titleOf(data.entries[uids[0]]) : null;
        render();
        layer.toast(one ? `Deleted ${one}` : `Deleted ${uids.length} entries`, {
            action: ['Undo', () => { const s = hiddenIn(book); for (const u of uids) s.delete(u); render(); }],
            onEnd: () => {
                const s = hiddenIn(book);
                const gone = uids.filter(u => s.has(u));
                for (const u of gone) s.delete(u);
                const folders = bookSettings(settings, book).folders;
                library.change(book, d => {
                    for (const u of gone) {
                        if (d.entries[u]) delete folders[cardKey(d.entries[u])];
                        removeEntry(d, u);
                    }
                });
                saveSettings();
            },
        });
    }

    function deleteBooks(names) {
        if (!names.length) return;
        for (const n of names) S.hiddenBooks.add(n);
        for (const t of [...S.tabs]) if (!t.home && t.history.some(p => names.includes(p.book))) S.tabs.splice(S.tabs.indexOf(t), 1);
        if (!S.tabs.some(t => t.id === S.active)) S.active = S.tabs[0].id;
        render();
        layer.toast(names.length === 1 ? `Deleted ${names[0]}` : `Deleted ${names.length} books`, {
            action: ['Undo', () => { for (const n of names) S.hiddenBooks.delete(n); render(); }],
            onEnd: async () => {
                for (const n of names) {
                    if (!S.hiddenBooks.has(n)) continue;
                    await snapshots.removeAll(n);
                    await library.remove(n);
                    deleteBookSettings(settings, n);
                    S.hiddenBooks.delete(n);
                }
                saveSettings();
                render();
            },
        });
    }

    // ---------------------------------------------------------------- Hero mode (N3): one book's canvas, entry tabs
    const H = S.hero;
    let heroCanvas = null;

    /** The book Hero mode shows: the one picked, else the first one there is. */
    function heroBook() {
        const names = visibleNames();
        if (!H.book || !names.includes(H.book)) H.book = names[0] ?? null;
        return H.book;
    }

    const blockingUids = (book, model) => new Set(model.issues
        .filter(i => !i.warning && i.blocking !== false && i.stKey?.startsWith(`${book}.`))
        .map(i => Number(i.stKey.slice(book.length + 1))));

    /** The canvas's view of a book, worked out once per draw. */
    function heroData(book, data) {
        const problems = blockingUids(book, modelOf(book, data));
        const live = entriesOf(data).filter(e => !hiddenIn(book).has(e.uid));
        const m = canvasBook({ entries: Object.fromEntries(live.map(e => [e.uid, e])) }, { folderOf: e => entryFolder(book, e), problems, greetings: chatGreetings(data) });
        return { m, memory: canvasMemory(bookSettings(settings, book)), problems, chatState: H.chatState, status: H.chatState ? chatStatus(book) : () => null };
    }

    /** D17: each card's state in the open chat, at its latest message. Cards of books the chat doesn't use get none. */
    function chatStatus(book) {
        const chat = ctx().chat ?? [];
        const model = hooks.model;
        if (!chat.length || !model?.nodes?.size) return () => null;
        let state;
        try { state = hooks.state(); } catch { return () => null; }
        const nameOf = key => model.nodes.get(key)?.label ?? (key.startsWith('@') ? 'a greeting' : null);
        return key => {
            if (!key.startsWith('id:')) return null;
            const node = model.nodes.get(`${book}/${key.slice(3)}`);
            if (!node) return null;
            const s = entryStatus(node, state, chat, model);
            return {
                fired: state.fired[node.key] ?? 0,
                closed: s.status === 'closed' ? closedText(state.closed[node.key].by, nameOf) : null,
                holding: s.status === 'holding',
                waiting: s.status === 'waiting',
                happened: node.moment ? s.status === 'happened' : undefined,
                mask: s.mask,
            };
        };
    }

    function renderHeroTabs() {
        const mk = (label, active, onOpen, onClose, { icon, dot } = {}) => {
            const b = el('button', `tab${active ? ' active' : ''}${icon ? ' fixed' : ''}`);
            b.type = 'button';
            if (icon) { b.innerHTML = ic(icon); b.setAttribute('aria-label', label); } else {
                if (dot) { const d = el('i', 'sd'); d.style.background = dot; b.append(d); }
                b.append(el('span', 'name', label));
            }
            if (S.desk) b.title = label;
            if (S.desk && onClose) {
                // Desktop: × on hover too, and middle-click closes.
                b.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); onClose(); } });
                b.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
            }
            if ((active || S.desk) && onClose) {
                const x = el('span', 'x');
                x.innerHTML = ic('x');
                x.setAttribute('role', 'button');
                x.setAttribute('aria-label', 'Close tab');
                x.addEventListener('click', e => { e.stopPropagation(); onClose(); });
                b.append(x);
            }
            b.addEventListener('click', onOpen);
            strip.append(b);
        };
        mk('Canvas', H.active === 'canvas', () => { if (H.active !== 'canvas') { H.active = 'canvas'; render(); } }, null, { icon: 'canvas' });
        mk('Preview', H.active === 'preview', () => { if (H.active !== 'preview') { H.active = 'preview'; H.panel = false; render(); } }, null, { icon: 'eye' });
        if (H.guide) mk('Guide', H.active === 'guide', () => { if (H.active !== 'guide') { H.active = 'guide'; render(); } }, () => { H.guide = null; if (H.active === 'guide') H.active = 'canvas'; render(); }, { icon: 'help' });
        H.tabs.forEach((t, i) => {
            const e = library.peek(t.book)?.entries[t.uid];
            mk(e ? (e.comment || 'New entry') : 'Entry', H.active === i, () => { if (H.active !== i) { H.active = i; render(); } }, () => closeHeroTab(i), { dot: e ? strategyColor(e) : null });
        });
        if (S.desk) heroTabsRight();
        revealActiveTab();
    }

    /** Desktop (LAYOUT "Desktop: Hero mode", Tab row): the book picker, Search, Normal mode, Widen/Drawer size, ×. */
    function heroTabsRight() {
        const right = el('div', 'tright');
        const book = heroBook();
        const bp = btn('tbook', html`${ic('book', 's')}<span></span>${ic('down', 's')}`, () => bookPicker(), 'Switch book');
        bp.querySelector('span').textContent = book ?? 'No book';
        bp.title = 'Switch book';
        const sb = btn('tsearch', html`${ic('search', 's')}<span>Search</span><kbd>Ctrl K</kbd>`, () => { S.search = { query: '', at: 0 }; render(); }, 'Search (Ctrl K)');
        const nm = btn('tmode', html`${ic('entry', 's')}<span>Normal mode</span>`, () => switchMode(), 'Switch to Normal mode');
        const eq = btn('iconbtn explainq', ic('help'), () => (H.explain ? stopExplain() : startExplain()), 'Explain: click something to learn about it');
        eq.title = 'Explain (?)';
        const wide = deskSettings().heroWide !== false;
        const wb = btn('iconbtn', ic(wide ? 'drawer' : 'fit'), () => {
            deskSettings().heroWide = !wide;
            saveSettings();
            H.dlist = null; // the list and the inspector start as the new size has them
            H.dinsp = null;
            render();
            requestAnimationFrame(() => heroCanvas?.fit());
        }, wide ? 'Drawer size' : 'Widen');
        wb.title = wide ? 'Drawer size' : 'Widen';
        right.append(bp, sb, eq, nm, wb, btn('iconbtn', ic('x'), () => hide(), 'Close WI Hero'));
        tabbar.append(right);
    }

    // ---------------------------------------------------------------- the Guide and explain mode (LAYOUT "Guide")
    const SAMPLE = 'WIHero-Sample';
    /** Opens the Guide tab at an anchor (a piece's page, or a topic). */
    function openGuide(anchor) {
        H.explain = false;
        H.guide = { anchor };
        H.active = 'guide';
        H.panel = false;
        render();
    }
    /** Explain mode: for one tap, everything explainable is outlined and a tap opens the Guide there. */
    function startExplain() {
        H.explain = true;
        H.bar.armed = null;
        render();
    }
    function stopExplain() { H.explain = false; render(); }
    /** The Guide anchor of what was tapped in explain mode, or null (LAYOUT "Explain mode"). */
    function explainAnchor(t) {
        const at = sel => t.closest?.(sel);
        const chipEl = at('.pchip[data-piece]');
        if (chipEl) return PIECE_ANCHOR[chipEl.dataset.piece] ?? null;
        if (at('.pstrip')) { const k = H.bar.edit?.piece; return PIECE_ANCHOR[k] ?? 'strip'; }
        const pc = at('.pc[data-piece]');
        if (pc) return PIECE_ANCHOR[pc.dataset.piece] ?? 'inspector';
        if (at('.insp, .hinsp')) return 'inspector';
        const port = at('[data-port]');
        if (port) return PIECE_ANCHOR[PORT[port.dataset.port.split('|')[1]]?.piece] ?? 'canvas';
        const pill = at('.lockp');
        if (pill) return pill.dataset.kind === 'wait' ? 'wait' : 'lock';
        const line = at('.lhit');
        if (line) return { open: 'opens', close: 'closes', ride: 'glue' }[line.dataset.kind] ?? 'canvas';
        if (at('.junc')) return 'opens';
        if (at('.packframe')) return 'pack';
        if (at('.mnav, .layercard')) return 'mask';
        if (at('.card.moment')) return 'moment';
        if (at('.card.greet')) return 'greeting';
        if (at('.card')) return 'canvas';
        const b = at('button');
        const label = b?.getAttribute('aria-label') ?? '';
        if (/^Fit/.test(label)) return 'fit';
        if (/^Tidy/.test(label)) return 'tidy';
        if (at('.panelBtn, .panel, .pfold')) return 'panel';
        if (at('.hl, mark, .hit')) return 'highlights';
        if (at('.also')) return 'also';
        return null;
    }
    // In explain mode a press anywhere in WI Hero is caught before the element's own handlers: it never acts.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'touchstart', 'dblclick', 'contextmenu']) {
        root.addEventListener(type, e => {
            if (!H.explain || S.mode !== 'hero' || e.composedPath().some(n => n.classList?.contains('explainban'))) return;
            e.stopPropagation();
            if (e.cancelable && type !== 'touchstart') e.preventDefault();
        }, { capture: true, passive: false });
    }
    root.addEventListener('click', e => {
        if (!H.explain || S.mode !== 'hero') return;
        const path = e.composedPath();
        if (path.some(n => n.classList?.contains('explainban'))) return;
        e.stopPropagation();
        e.preventDefault();
        const t = path[0];
        const anchor = t instanceof Element ? explainAnchor(t) : null;
        if (anchor) openGuide(anchor);
        else layer.toast('Nothing to explain there. Tap something outlined, or Cancel.');
    }, true);

    function closeHeroTab(i) {
        H.tabs.splice(i, 1);
        if (H.active === i) H.active = i < H.tabs.length ? i : i > 0 ? i - 1 : 'canvas'; // the next tab slides into its place
        else if (typeof H.active === 'number' && H.active > i) H.active--;
        render();
    }

    /** Opens an entry in a Hero tab (the inspector comes in N4). */
    function openHeroTab(book, uid, mask = null) {
        let i = H.tabs.findIndex(t => t.book === book && t.uid === uid);
        if (i < 0) { H.tabs.push({ book, uid }); i = H.tabs.length - 1; }
        H.tabs[i].mask = mask;
        H.active = i;
        H.panel = false;
        render();
    }

    function heroBack() {
        if (H.explain) { stopExplain(); return true; }
        if (S.desk) return heroBackDesk();
        // Back on an open strip is its Cancel; on an armed chip it disarms.
        if (H.active === 'canvas' && H.bar.edit) {
            const e = H.bar.edit;
            if (e.dirty) barApi(e.book).restore(e.snap);
            H.bar.edit = null;
            render();
            return true;
        }
        if (H.active === 'canvas' && H.bar.armed) { H.bar.armed = null; render(); return true; }
        if (H.insp && H.active === 'canvas') { H.insp = null; render(); return true; }
        if (H.panel) { H.panel = false; render(); return true; }
        if (typeof H.active === 'number') { closeHeroTab(H.active); return true; }
        if (H.active === 'guide') { H.active = 'canvas'; render(); return true; }
        if (H.active === 'preview') {
            if (H.pv?.page) H.pv.page = null;
            else H.active = 'canvas';
            render();
            return true;
        }
        hide();
        return false;
    }

    /**
     * What the canvas draws from, as one string: when a Hero draw finds it unchanged (a piece bar step that only
     * changes the strip, the inspector opening, the panel), the cards and links stay as they are. The camera is left
     * out: it moves without a draw. Show chat state always draws, since the chat moves under it.
     */
    function canvasSig(book) {
        if (H.chatState) return null;
        const bs = settings.books?.[book] ?? {};
        const { camera, ...canvas } = bs.canvas ?? {};
        const top = Object.entries(settings).filter(([k, v]) => k !== 'books' && (v === null || typeof v !== 'object'));
        const c = ctx();
        return JSON.stringify([library.version, { ...bs, canvas }, top, [...hiddenIn(book)], c.getCurrentChatId?.() ?? c.chatId ?? null, c.characterId ?? null]);
    }
    /** The canvas kept between Hero draws of the same book: { book, data, vp, sig, data() cache }. */
    let heroMount = null;

    function renderHero() {
        renderTabs();
        // Explain mode: outlines on what can be explained, a banner with Cancel (LAYOUT "Explain mode").
        root.classList.toggle('explaining', !!H.explain);
        root.querySelector(':scope > .explainban')?.remove();
        if (H.explain) {
            const ban = el('div', 'explainban');
            ban.setAttribute('role', 'status');
            ban.append(el('span', '', S.desk ? 'Click anything to learn about it' : 'Tap anything to learn about it'), btn('pbtn sm', 'Cancel', stopExplain));
            root.append(ban);
        }
        if (typeof H.active === 'number' && !H.tabs[H.active]) H.active = 'canvas';
        const keepBook = H.active === 'canvas' ? heroBook() : null;
        const kept = heroMount && heroCanvas && keepBook && heroMount.book === keepBook && library.peek(keepBook) === heroMount.data
            && main.dataset.page === 'hero:canvas' && heroMount.vp.parentNode === main ? heroMount : null;
        if (kept) {
            // Same canvas: everything around it is drawn again (cheap), the cards and links only if they changed.
            for (const n of [...main.children]) if (n !== kept.vp) n.remove();
            kept.vp.querySelector('.legend')?.remove();
            if (H.legend) kept.vp.append(legendBox());
            const sig = canvasSig(keepBook);
            heroCanvas.overlay(null); // the piece bar sets its own again, as on a fresh canvas
            if (sig === null || sig !== kept.sig) { kept.cache = null; heroCanvas.render(); kept.sig = canvasSig(keepBook); } // a draw can place cards
            heroAround(keepBook, kept.data);
            return;
        }
        main.innerHTML = '';
        heroCanvas = null;
        heroMount = null;
        if (typeof H.active === 'number') {
            const t = H.tabs[H.active];
            main.dataset.page = `hero:${H.active}`;
            const nav = { up: () => closeHeroTab(H.active), go: uid => { t.uid = uid; t.mask = null; render(); }, tab: t };
            if (S.desk) {
                // Desktop: the shared entry page, Story logic always open, "Show on canvas ›".
                S.ui.logic = true;
                const e = library.peek(t.book)?.entries[t.uid];
                const folder = e ? entryFolder(t.book, e) : '';
                renderEntry({ type: 'entry', book: t.book, uid: t.uid }, nav, main, {
                    desk: {
                        crumbs: [{ label: t.book }, ...(folder ? folder.split('/').map(f => ({ label: f })) : [])],
                        showOnCanvas: e ? () => { showOnCanvas(t.book, cardKey(e)); inspect(t.book, cardKey(e)); } : null,
                    },
                });
                if (S.search) deskN.renderSearch();
                return;
            }
            renderEntry({ type: 'entry', book: t.book, uid: t.uid }, nav);
            return;
        }
        if (H.active === 'preview') { renderPreviewTab(); if (S.desk && S.search) deskN.renderSearch(); return; }
        if (H.active === 'guide' && H.guide) {
            main.dataset.page = 'hero:guide';
            renderGuide(main, {
                anchor: H.guide.anchor,
                hasSample: library.names().includes(SAMPLE),
                showMe: (_id, key) => { H.guide.anchor = null; showOnCanvas(SAMPLE, key); inspect(SAMPLE, key); },
            });
            H.guide.anchor = null; // scrolled there once; a redraw keeps the reader's place
            if (S.desk && S.search) deskN.renderSearch();
            return;
        }
        main.dataset.page = 'hero:canvas';
        const book = heroBook();
        if (!book) { const v = el('div', 'view'); v.append(el('div', 'empty-note', 'No books yet. Switch to Normal mode to make one.')); main.append(v); return; }
        const data = need(book);
        if (!data) { const v = el('div', 'view'); v.append(el('div', 'empty-note', loadingNote(book))); main.append(v); return; }

        if (S.desk) deskColumns(); // the columns first, so the canvas fits the room it really has
        const vp = el('div', 'vp');
        vp.tabIndex = -1;
        main.append(vp);
        if (H.legend) vp.append(legendBox());
        const mount = { book, data, vp, sig: null, cache: null };
        heroCanvas = mountCanvas(vp, {
            book: () => (mount.cache ??= heroData(book, data)),
            save: saveSettings,
            open: (key, piece) => inspect(book, key, piece),
            pack: name => packSheet(book, data, name),
            toast: text => layer.toast(text),
            holdEmpty: at => placePicker(book, data, at),
            tapTarget: hit => barTap(book, hit),
            focused: () => (H.insp?.book === book ? H.insp.key : null),
            tapEmpty: () => {
                if (H.panel) { H.panel = false; panelState(); }
                if (S.desk) { H.insp = null; heroInspector(book, data); return; }
                if (H.insp) { H.insp = null; main.querySelector('.insp')?.remove(); }
            },
            ...(S.desk ? deskCanvas(book, data) : {}),
        });
        heroMount = mount;
        heroCanvas.render();
        mount.sig = canvasSig(book); // after the draw, which can place cards
        heroAround(book, data);
    }
    /** What sits around the canvas: the entry panel, the piece bar and the inspector. */
    function heroAround(book, data) {
        if (S.desk) deskColumns();
        if (!S.desk) {
            // Phones: the "?" sits at the top right of the canvas.
            const q = btn('explainq', ic('help'), () => (H.explain ? stopExplain() : startExplain()), 'Explain: tap something to learn about it');
            main.append(q);
        }
        heroPanel(book, data);
        if (H.bar.edit && H.bar.edit.book !== book) H.bar.edit = null;
        mountPieceBar(barApi(book));
        if (S.desk) { heroInspector(book, data); if (S.search) deskN.renderSearch(); return; }
        if (H.insp?.book === book) inspectorFor(book, data);
    }
    function legendBox() {
        const lg = el('div', 'legend');
        for (const [v, label, dashed] of [['open', 'opens'], ['close', 'closes', true], ['glue', 'glue'], ['mask', 'mask'], ['pack', 'pack', true]]) {
            const s = el('span');
            s.style.color = `var(--p-${v})`;
            s.append(el('i', dashed ? 'd' : ''), label);
            lg.append(s);
        }
        return lg;
    }

    // ---------------------------------------------------------------- the piece bar (LAYOUT "Piece bar")
    /** A card key as the bar sees it: an entry by uid, a pack, or a greeting. */
    function nodeOf(book, key) {
        const data = library.peek(book);
        if (!data || !key) return null;
        if (key.startsWith('pack:')) return { t: 'pack', name: key.slice(5) };
        if (key.startsWith('greet:')) { const g = chatGreetings(data).find(x => x.key === key); return g ? { t: 'greet', ref: g.ref } : null; }
        const e = entriesOf(data).find(x => cardKey(x) === key);
        return e ? { t: 'entry', uid: e.uid, ...(isMoment(e) ? { moment: true } : {}) } : null;
    }

    /**
     * Runs a bar edit: first on a copy, and only when it adds no new problem (a loop, a self-link, a broken
     * switch) on the book itself. A refused edit says why on the strip.
     */
    function barAct(book, fn, quiet = false) {
        const data = library.peek(book);
        if (!data) return false;
        const issues = d => new Map(modelOf(book, d).issues.filter(i => !i.warning && i.blocking !== false).map(i => [`${i.stKey}|${i.message}`, i]));
        const before = issues(data);
        const trial = structuredClone(data);
        let why = null;
        try {
            fn(bookEditor(trial), trial);
            const fresh = [...issues(trial)].filter(([k]) => !before.has(k)).map(([, i]) => i);
            if (fresh.length) {
                const uid = Number(String(fresh[0].stKey ?? '').slice(book.length + 1));
                const who = trial.entries[uid] ? titleOf(trial.entries[uid]) : 'An entry';
                why = `Not done: ${who} ${fresh[0].message}.`;
            }
        } catch (err) { why = err.message; }
        if (why) {
            if (H.bar.edit) { H.bar.edit.note = why; H.bar.edit.noteBad = true; if (!quiet) render(); } else layer.toast(why);
            return false;
        }
        let created = [];
        library.change(book, d => { const ed = bookEditor(d); fn(ed, d); created = ed.created; }, { quiet: true });
        for (const [uid, id] of created) rekeyEntry(settings, book, uid, id);
        if (created.length) saveSettings();
        if (H.bar.edit) { H.bar.edit.note = H.bar.edit.noteBad ? null : H.bar.edit.note; H.bar.edit.noteBad = false; }
        if (!quiet) render();
        return true;
    }

    function barApi(book) {
        const data = () => library.peek(book);
        const nameOfId = id => { const x = entriesOf(data()).find(y => idOf(y) === id); return x ? titleOf(x) : id; };
        return {
            B: H.bar, main, root, canvas: heroCanvas, layer, desk: S.desk,
            data, editor: () => bookEditor(data()),
            act: (fn, { quiet = false } = {}) => barAct(book, fn, quiet),
            snapshot: () => ({ book, entries: structuredClone(data().entries), original: data().originalData === undefined ? undefined : structuredClone(data().originalData), settings: structuredClone(bookSettings(settings, book)) }),
            restore: snap => {
                library.change(book, d => { d.entries = structuredClone(snap.entries); if (snap.original !== undefined) d.originalData = structuredClone(snap.original); }, { quiet: true });
                settings.books[book] = structuredClone(snap.settings);
                saveSettings();
            },
            render: () => render(),
            nodeOf: key => nodeOf(book, key),
            keyOf: end => (end?.t === 'pack' ? `pack:${end.name}` : end?.t === 'greet' ? `greet:${end.ref.char}:${end.ref.greeting}` : data().entries[end?.uid] ? cardKey(data().entries[end.uid]) : null),
            nameOf: end => (end?.t === 'pack' ? `#${end.name}` : end?.t === 'greet' ? greetingName(end.ref.greeting) : data().entries[end?.uid] ? titleOf(data().entries[end.uid]) : '?'),
            nameOfId,
            candidates: () => {
                const d = data();
                const out = sortEntries(linkable(book, d), sortBy()).map(e => ({ key: cardKey(e), end: { t: 'entry', uid: e.uid }, title: titleOf(e) }));
                for (const p of packsOf(d)) out.push({ key: `pack:${p}`, end: { t: 'pack', name: p }, title: `#${p}` });
                for (const g of chatGreetings(d)) out.push({ key: g.key, end: { t: 'greet', ref: g.ref }, title: `${g.title}: ${g.text.slice(0, 30)}` });
                return out;
            },
            packs: () => packsOf(data()),
            closersOf: uid => {
                const model = modelOf(book, data());
                const node = model.byStKey.get(`${book}.${uid}`);
                return [...new Set((node?.closes ?? []).map(cl => (cl.kind === 'once' ? 'Once' : model.nodes.get(cl.source)?.label ?? 'a greeting')))];
            },
            contentOf: uid => data().entries[uid]?.content,
            openMask: (uid, name) => openHeroTab(book, uid, name),
            showMask: (uid, name, from = null) => {
                const e = data().entries[uid];
                if (!e) return;
                const mem = canvasMemory(bookSettings(settings, book));
                const key = cardKey(e);
                if (from && mem.cards[key]?.layer !== from) return;
                (mem.cards[key] ??= {}).layer = name;
                saveSettings();
            },
            folded: () => !!settings.pieceBarFolded,
            setFolded: v => { settings.pieceBarFolded = v; saveSettings(); },
            toast: t => layer.toast(t),
            place: (k, hit) => dropPiece(book, k, hit),
            entryTemplate: deps.entryTemplate,
            guide: piece => openGuide(PIECE_ANCHOR[piece] ?? 'strip'),
            makeMoment: made => {
                const mem = canvasMemory(bookSettings(settings, book));
                const key = cardKey(made);
                mem.cards[key] = { ...(mem.cards[key] ?? {}), placed: true };
                saveSettings();
            },
        };
    }

    function dropPiece(book, k, hit) {
        if (k === 'moment') { newMoment(book, hit?.card ? nodeOf(book, hit.card) : null); return; }
        const r = startPiece(k, hit, barApi(book));
        if (r.why) { render(); layer.toast(r.why); return; }
        openStrip(book, r.edit);
    }

    /** Opens a piece's strip: the inspector and the panel make way for it. */
    function openStrip(book, edit) {
        H.bar.edit = { ...edit, book };
        H.bar.armed = null;
        H.insp = null;
        H.panel = false;
        render();
    }

    /** A tap on the canvas, seen by the bar first: an armed chip lands, a loose end is picked, a line opens its strip. */
    function barTap(book, hit) {
        const B = H.bar;
        const x = barApi(book);
        if (B.edit) {
            if (hit?.card && B.loosePick) { const end = nodeOf(book, hit.card); if (end && B.loosePick(end)) return true; }
            return !!hit;
        }
        if (B.armed) {
            const k = B.armed;
            B.armed = null;
            if (k === 'moment') { newMoment(book, hit?.card ? nodeOf(book, hit.card) : null); return true; }
            if (!hit) { render(); return false; }
            dropPiece(book, k, hit);
            return true;
        }
        if (S.desk && hit?.cond) { inspect(book, hit.cond.key, PORT[hit.cond.port]?.piece ?? null); return true; }
        if (hit?.link || hit?.cond) {
            const edit = editExisting(hit, x);
            if (edit) { openStrip(book, edit); return true; }
        }
        if (hit?.row) { inspect(book, hit.row.key, PORT[hit.row.port].piece); return true; }
        return false;
    }

    /**
     * A new Moment (CONCEPTS 3.13), from the piece bar: asks its name, places it on the canvas and opens its inspector
     * for the phrases. Dropped on an entry, it asks whether the Moment opens or closes it, and links them.
     */
    function newMoment(book, on = null) {
        if (on && (on.t !== 'entry' || on.moment)) { render(); layer.toast('A Moment reacts on an entry: it opens or closes it.'); return; }
        const data = library.peek(book);
        const target = on ? data?.entries[on.uid] : null;
        layer.askText({
            title: 'New Moment', placeholder: 'What happens: Missing tooth', ok: 'Make',
            help: 'Something that can happen in the story, said in the chat. You add the phrases next.',
            done: name => {
                const made = library.change(book, d => addMoment(d, deps.entryTemplate, name.trim() || 'Moment'));
                if (!made) return;
                const key = cardKey(made);
                const mem = canvasMemory(bookSettings(settings, book));
                mem.cards[key] = { ...(mem.cards[key] ?? {}), placed: true };
                saveSettings();
                const finish = () => { render(); inspect(book, key); };
                if (!target) { finish(); return; }
                layer.sheet(`When ${name.trim()} happens, ${titleOf(target)}…`, sh => {
                    for (const [kind, label] of [['open', 'opens'], ['close', 'closes']]) {
                        sh.append(layer.opt(label, () => {
                            layer.close();
                            barAct(book, (ed, d) => addLink(ed, d, kind, { t: 'entry', uid: made.uid, moment: true }, { t: 'entry', uid: target.uid }, { join: 'and' }));
                            finish();
                        }));
                    }
                });
            },
        });
    }

    /** A new entry in a book, with the book's defaults for new entries. */
    function createEntry(book, name) {
        const defaults = { ...(bookSettings(settings, book).defaults ?? {}) };
        const by = defaults.by;
        delete defaults.by;
        return library.change(book, d => {
            const n = addEntry(d, deps.entryTemplate, defaults);
            n.comment = name;
            if (by) setParam(d, n.uid, PARAM_LIST.find(z => z.field === 'by'), by);
            return n;
        });
    }

    /** A long press on the canvas: pick an entry not on it yet, and it is placed there (or make a new one there). */
    function placePicker(book, data, at) {
        const on = heroCanvas?.view?.ids ?? new Set();
        const place = (key, title) => {
            const mem = canvasMemory(bookSettings(settings, book));
            mem.cards[key] = { ...(mem.cards[key] ?? {}), placed: true, ...(at ?? {}) };
            delete mem.cards[key].ports;
            saveSettings();
            render();
            layer.toast(`${title} placed`);
        };
        layer.sheet(S.desk ? 'Add to canvas here' : 'Place here', sh => {
            const q = el('input', 'pick-q');
            q.placeholder = 'Search entries';
            q.setAttribute('aria-label', 'Search entries');
            const list = el('div');
            const fill = () => {
                list.replaceChildren();
                const needle = q.value.trim().toLowerCase();
                const free = sortEntries(linkable(book, data), sortBy()).filter(e => !on.has(cardKey(e)) && (!needle || titleOf(e).toLowerCase().includes(needle)));
                for (const e of free.slice(0, 60)) list.append(layer.opt(titleOf(e), () => { layer.close(); place(cardKey(e), titleOf(e)); }, { dot: strategyColor(e), sub: entryFolder(book, e) || undefined }));
                if (!free.length) list.append(el('p', 'help', needle ? 'Nothing matches.' : 'Every entry is on the canvas already.'));
            };
            q.addEventListener('input', fill);
            sh.append(q, layer.opt('New entry here', () => layer.askText({
                title: 'New entry', placeholder: 'Entry name', ok: 'Create',
                done: name => { const x = createEntry(book, name); place(cardKey(x), name); },
            }), { icon: 'plus' }), list);
            if (S.desk) {
                list.classList.add('plimit');
                sh.append(layer.opt('Fit', () => { layer.close(); heroCanvas?.fit(); }, { icon: 'fit', val: 'F' }));
                sh.append(layer.opt('Tidy layout', () => { layer.close(); tidyNow(); }, { icon: 'tidy', val: 'T' }));
            }
            fill();
            if (S.desk) setTimeout(() => q.focus(), 0);
        }, { help: S.desk ? null : 'Entries that aren\'t on the canvas yet.' });
    }

    // ---------------------------------------------------------------- Preview (N5, LAYOUT "Preview tab")
    /** Where Preview can start from (BUILD_SPEC 15.5): the open chat, Fresh start, and each greeting of its character. */
    function previewSeeds() {
        const c = ctx();
        const chat = library.chatOpen() ? c.chat ?? [] : [];
        const ch = !c.groupId && c.characterId !== undefined ? c.characters?.[c.characterId] : null;
        const seeds = [];
        if (chat.length) {
            const u = chat.findLastIndex(m => m?.is_user && !m.is_system);
            const base = u < 0 ? chat : chat.slice(0, u);
            const reply = u < 0 ? null : chat.slice(u + 1).find(m => m && !m.is_user && !m.is_system);
            const name = c.groupId ? 'Group chat' : `${ch?.name ?? 'Open'} chat`;
            seeds.push({
                id: 'chat', label: `${name} · after ${base.length} message${base.length === 1 ? '' : 's'}`, sub: 'The open chat\'s latest exchange and how far its story has got',
                base, greeting: openingGreeting(chat, ch), user: u < 0 ? '' : chat[u].mes ?? '', reply: reply?.mes ?? '',
            });
        }
        seeds.push({ id: 'fresh', label: 'Fresh start', sub: 'From the beginning, nothing fired yet', base: [], greeting: null, user: '', reply: '' });
        if (ch?.avatar && library.chatOpen()) {
            greetingsOf(ch).forEach((text, n) => {
                if (!String(text ?? '').trim()) return;
                const mes = c.substituteParams ? c.substituteParams(text) : text;
                seeds.push({
                    id: `greet:${n}`, label: `Start at ${greetingName(n)}`, sub: String(mes).replace(/\s+/g, ' ').trim().slice(0, 80),
                    base: [{ is_user: false, name: ch.name, mes }], greeting: `@${ch.avatar}:${n}`, user: '', reply: '',
                });
            });
        }
        return seeds;
    }

    function seedPreview(seed) {
        H.pv = { seed: seed.id, user: seed.user, reply: seed.reply, edit: null, page: null };
    }

    function renderPreviewTab() {
        main.dataset.page = 'hero:preview';
        const book = heroBook();
        if (!book) { const v = el('div', 'view'); v.append(el('div', 'empty-note', 'No books yet. Switch to Normal mode to make one.')); main.append(v); return; }
        const data = need(book);
        if (!data) { const v = el('div', 'view'); v.append(el('div', 'empty-note', loadingNote(book))); main.append(v); return; }
        const seeds = previewSeeds();
        let seed = seeds.find(x => x.id === H.pv?.seed);
        if (!seed) { seed = seeds[0]; seedPreview(seed); }
        const shown = entriesShown(book, data);
        const entries = shown.map(e => ({ ...e, world: book }));
        const model = buildBookModel(entries);
        const g = deps.scan?.globals?.() ?? {};
        const run = runPreview({
            entries, model, base: seed.base, greeting: seed.greeting, renamed: settings.renamed ?? {},
            user: H.pv.user, reply: H.pv.reply, globals: { ...g, parseRegexFromString: deps.scan?.parseRegexFromString },
        });
        const byStKey = new Map(shown.map(e => [`${book}.${e.uid}`, e]));
        renderPreviewPage(main, {
            run, pv: H.pv, book, seedLabel: seed.label, layer,
            info: k => {
                const e = byStKey.get(k);
                return e ? { title: titleOf(e), color: strategyColor(e), logic: !!model.byStKey.get(k), uid: e.uid } : null;
            },
            set: patch => { Object.assign(H.pv, patch); render(); },
            pickSeed: () => layer.sheet('Start from', sh => {
                for (const x of seeds) sh.append(layer.opt(x.label, () => { layer.close(); seedPreview(x); render(); }, { cur: x.id === seed.id, sub: x.sub }));
            }, { help: 'Preview reads the open chat\'s latest exchange and how far its story has got, or starts from the beginning.' }),
            openEntry: k => { const e = byStKey.get(k); if (e) openHeroTab(book, e.uid); },
            showOnCanvas: k => { const e = byStKey.get(k); if (e) showOnCanvas(book, cardKey(e)); },
            desk: S.desk,
            // Desktop: a highlight or a report row jumps to the card on the canvas.
            jump: k => { const e = byStKey.get(k); if (e) { showOnCanvas(book, cardKey(e)); inspect(book, cardKey(e)); } },
        });
    }

    // The entry panel (LAYOUT "Entry panel"): every entry of the book, a dot that places it on the canvas or finds it.
    let panelState = () => {};
    function heroPanel(book, data) {
        const desk = S.desk;
        const pb = desk
            ? btn('panelBtn', ic(listShown() ? 'left' : 'panel'), () => { H.dlist = !listShown(); render(); }, listShown() ? 'Hide the entry list' : 'Show the entry list')
            : btn('panelBtn', ic('panel'), () => { H.panel = !H.panel; panelState(); }, 'Entries');
        if (desk) pb.title = listShown() ? 'Hide the entry list' : 'Show the entry list';
        if (desk && !listShown()) { main.append(pb); panelState = () => {}; return; }
        const p = el('aside', desk ? 'panel dock' : 'panel');
        main.append(pb, p);
        // The list is filled the first time the panel opens: a closed panel costs nothing on each draw.
        let filled = false;
        if (desk) {
            panelState = () => { if (!filled) fill(); p.classList.remove('closed'); };
            p.append(resizer(() => deskSettings().heroListW ?? 250, w => { deskSettings().heroListW = w; deskColumns(); }, { min: 200, max: 420, def: 250, side: 'right', onEnd: () => saveSettings() }));
        } else panelState = () => {
            if (H.panel && !filled) fill();
            p.classList.toggle('closed', !H.panel);
            pb.classList.toggle('open', H.panel);
            pb.innerHTML = H.panel ? ic('left') : ic('panel');
            pb.setAttribute('aria-label', H.panel ? 'Close the entry panel' : 'Entries');
            p.inert = !H.panel;
        };
        const ph = el('div', 'phead');
        const q = el('input');
        q.placeholder = 'Search entries';
        q.setAttribute('aria-label', 'Search entries');
        q.value = H.q;
        q.addEventListener('input', () => { H.q = q.value; fill(); });
        ph.append(q, btn('round flat', ic('plus'), () => layer.askText({
            title: 'New entry', placeholder: 'Entry name', ok: 'Create',
            // Made, not placed: it waits in the panel with a hollow dot until it is placed.
            done: name => { createEntry(book, name); H.panel = true; H.q = ''; render(); layer.toast(`${name} made. Drag or tap its dot to place it`); },
        }), 'New entry'));
        p.append(ph);
        const list = el('div', 'plist');
        p.append(list);
        const view = heroCanvas.view;
        // Dragging a dot out of the panel places the card where it is dropped (or moves it there). The panel slides
        // away once the drag starts, so the whole canvas is a drop target; dropping on the red × cancels.
        const dropped = new WeakSet();
        const dragged = ev => { if (!dropped.has(ev.currentTarget)) return false; dropped.delete(ev.currentTarget); return true; };
        const dotDrag = (dot, key, title) => {
            let start = null;
            let ghost = null;
            let cancel = null;
            const overCancel = ev => {
                const r = cancel?.getBoundingClientRect();
                return !!r && Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2)) <= r.width / 2 + 16;
            };
            dot.style.touchAction = 'none';
            dot.addEventListener('pointerdown', ev => {
                if (ev.button) return;
                start = { x: ev.clientX, y: ev.clientY };
                // A phone's dot is small: captured at once, so a quick drag can't leave it before it counts. A desktop
                // row is captured only once it is a drag, so a click on its dot still reaches the dot.
                if (!desk) dot.setPointerCapture?.(ev.pointerId);
            });
            dot.addEventListener('pointermove', ev => {
                if (!start) return;
                if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 8) return;
                if (!ghost) {
                    // Captured only once it is a drag, so a plain click still reaches what was clicked (the row's dot
                    // on desktop places the entry, the row itself inspects it).
                    if (desk) dot.setPointerCapture?.(ev.pointerId);
                    ghost = el('div', 'dragghost', title);
                    cancel = el('div', 'dropcancel');
                    cancel.innerHTML = ic('x');
                    cancel.setAttribute('aria-label', 'Drop here to cancel');
                    root.append(cancel, ghost);
                    p.classList.add('closed', 'dragging');
                }
                const r = root.getBoundingClientRect();
                ghost.style.transform = `translate(${ev.clientX - r.left}px, ${ev.clientY - r.top}px)`;
                const off = overCancel(ev);
                cancel.classList.toggle('over', off);
                ghost.classList.toggle('off', off);
            });
            const finish = (ev, drop) => {
                const g = ghost;
                const off = overCancel(ev);
                start = null;
                ghost = null;
                if (!g) return;
                g.remove();
                cancel.remove();
                cancel = null;
                dropped.add(dot);
                p.classList.remove('dragging');
                const at = drop && !off ? heroCanvas?.pointAt(ev.clientX, ev.clientY) : null;
                if (!at) { panelState(); return; }
                const mem = canvasMemory(bookSettings(settings, book));
                mem.cards[key] = { ...(mem.cards[key] ?? {}), placed: true, x: at.x, y: at.y };
                delete mem.cards[key].ports;
                saveSettings();
                H.panel = false;
                render();
                layer.toast(`${title} placed`);
            };
            dot.addEventListener('pointerup', ev => finish(ev, true));
            dot.addEventListener('pointercancel', ev => finish(ev, false));
        };
        const fill = () => {
            filled = true;
            list.innerHTML = '';
            const on = view?.ids ?? new Set();
            const needle = H.q.trim().toLowerCase();
            const groups = new Map();
            for (const e of sortEntries(entriesShown(book, data), sortBy())) {
                if (needle && !titleOf(e).toLowerCase().includes(needle)) continue;
                const f = entryFolder(book, e).split('/')[0];
                if (!groups.has(f)) groups.set(f, []);
                groups.get(f).push(e);
            }
            // The open chat's character's greetings (BUILD_SPEC 15.4), placed with the dot like entries. First, as the story
            // starts from them.
            const greets = chatGreetings(data).filter(g => !needle || g.title.toLowerCase().includes(needle) || g.text.toLowerCase().includes(needle));
            if (greets.length) {
                const open = !H.closedFolders.has('\u0000greetings');
                const hd = btn(`phdr${open ? ' open' : ''}`, html`${ic('right')}<span>Greetings</span><small></small>`, () => { open ? H.closedFolders.add('\u0000greetings') : H.closedFolders.delete('\u0000greetings'); fill(); });
                hd.querySelector('small').textContent = greets.length;
                list.append(hd);
                if (open) {
                    const box = el('div', 'pgrp');
                    for (const g of greets) {
                        const r = el('div', 'prow greet');
                        r.dataset.key = g.key;
                        const nm = el('span', 'nm');
                        nm.append(el('b', '', g.title), el('small', '', g.text));
                        r.append(nm);
                        if (g.changed) r.append(el('span', 'pbang', '!'));
                        const placed = on.has(g.key);
                        const gd = btn(`dotc${placed ? ' in' : ''}`, html`<i></i>`, ev => {
                            ev.stopPropagation();
                            if (dragged(ev)) return;
                            if (!placed) { canvasMemory(bookSettings(settings, book)).cards[g.key] = { placed: true }; saveSettings(); }
                            showOnCanvas(book, g.key);
                        }, placed ? `Show ${g.title} on the canvas` : `Place ${g.title} on the canvas`);
                        if (desk) { dotDrag(r, g.key, g.title); r.classList.toggle('on', H.insp?.key === g.key); } else dotDrag(gd, g.key, g.title);
                        r.append(gd);
                        r.addEventListener('click', ev => { if (desk && dragged(ev)) return; inspect(book, g.key); });
                        box.append(r);
                    }
                    list.append(box);
                }
            }
            // The book's Moments (CONCEPTS 3.13), under the greetings: the only list they are in.
            const moments = sortEntries(momentsOf(book, data), 'az').filter(e => !needle || titleOf(e).toLowerCase().includes(needle) || (e.key ?? []).some(k => String(k).toLowerCase().includes(needle)));
            if (moments.length) {
                const open = !H.closedFolders.has('\u0000moments');
                const hd = btn(`phdr${open ? ' open' : ''}`, html`${ic('right')}<span>Moments</span><small></small>`, () => { open ? H.closedFolders.add('\u0000moments') : H.closedFolders.delete('\u0000moments'); fill(); });
                hd.querySelector('small').textContent = moments.length;
                list.append(hd);
                if (open) {
                    const box = el('div', 'pgrp');
                    for (const e of moments) {
                        const key = cardKey(e);
                        const r = el('div', 'prow greet moment');
                        r.dataset.key = key;
                        const nm = el('span', 'nm');
                        nm.append(el('b', '', momentName(e)), el('small', '', (e.key ?? []).map(k => `“${k}”`).join(' · ') || 'no phrases yet'));
                        r.append(nm);
                        if (heroCanvas?.view?.m?.byId(key)?.problem) r.append(el('span', 'pbang', '!'));
                        const placed = on.has(key);
                        const place = () => { if (!placed) { canvasMemory(bookSettings(settings, book)).cards[key] = { placed: true }; saveSettings(); } showOnCanvas(book, key); };
                        const gd = btn(`dotc${placed ? ' in' : ''}`, html`<i></i>`, ev => { ev.stopPropagation(); if (!dragged(ev)) place(); }, placed ? `Show ${momentName(e)} on the canvas` : `Place ${momentName(e)} on the canvas`);
                        if (desk) { dotDrag(r, key, momentName(e)); r.classList.toggle('on', H.insp?.key === key); } else dotDrag(gd, key, momentName(e));
                        r.append(gd);
                        r.addEventListener('click', ev => { if (desk && dragged(ev)) return; if (placed || desk) inspect(book, key); else place(); });
                        box.append(r);
                    }
                    list.append(box);
                }
            }
            if (!groups.size) list.append(el('div', 'pnone', needle ? 'Nothing matches.' : 'No entries yet. Tap + to make one.'));
            for (const f of [...groups.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b))) {
                let box = list;
                if (f) {
                    const open = !H.closedFolders.has(f);
                    const hd = btn(`phdr${open ? ' open' : ''}`, html`${ic('right')}<span></span><small></small>`, () => { open ? H.closedFolders.add(f) : H.closedFolders.delete(f); fill(); });
                    hd.querySelector('span').textContent = f;
                    hd.querySelector('small').textContent = groups.get(f).length;
                    list.append(hd);
                    if (!open) continue;
                    box = el('div', 'pgrp');
                    list.append(box);
                }
                for (const e of groups.get(f)) {
                    const key = cardKey(e);
                    const r = el('div', `prow st-${strategyOf(e)}`);
                    r.dataset.key = key;
                    r.append(el('span', 'nm', titleOf(e)));
                    const model = heroCanvas?.view?.m;
                    if (model?.byId(key)?.problem) { const b = el('span', 'pbang', '!'); b.title = 'This entry has a problem'; r.append(b); }
                    const placed = on.has(key);
                    const place = () => { if (!placed) { canvasMemory(bookSettings(settings, book)).cards[key] = { placed: true }; saveSettings(); } showOnCanvas(book, key); };
                    const d = btn(`dotc${placed ? ' in' : ''}`, html`<i></i>`, ev => { ev.stopPropagation(); if (!dragged(ev)) place(); },
                        placed ? `Show ${titleOf(e)} on the canvas` : `Place ${titleOf(e)} on the canvas`);
                    r.append(d);
                    const rowMenu = () => layer.sheet(titleOf(e), sh => {
                        sh.append(layer.opt('Open entry', () => { layer.close(); openHeroTab(book, e.uid); }, { icon: 'tab', val: desk ? 'Double-click' : undefined }));
                        sh.append(layer.opt(placed ? 'Show on canvas' : 'Place on canvas', () => { layer.close(); place(); }, { icon: 'canvas' }));
                        if (placed || desk) sh.append(layer.opt('Inspect', () => { layer.close(); inspect(book, key); }, { icon: 'eye', val: desk ? 'Click' : undefined }));
                    }, { help: desk ? null : 'Or drag its dot onto the canvas to place it where you drop it.' });
                    if (desk) {
                        // Desktop: click inspects, double-click opens its tab, right-click is the menu, drag the row to place it.
                        dotDrag(r, key, titleOf(e));
                        r.classList.toggle('on', H.insp?.key === key);
                        r.title = placed ? titleOf(e) : `${titleOf(e)}: not on the canvas. Drag it there, or click its dot`;
                        r.addEventListener('click', ev => { if (!dragged(ev)) inspect(book, key); });
                        r.addEventListener('dblclick', () => openHeroTab(book, e.uid));
                        r.addEventListener('contextmenu', ev => { ev.preventDefault(); rowMenu(); });
                    } else {
                        dotDrag(d, key, titleOf(e));
                        pressable(r, () => openHeroTab(book, e.uid), rowMenu);
                    }
                    box.append(r);
                }
            }
        };
        if (desk) {
            // The footer: the book's links and how many of its entries are on the canvas.
            const ft = el('div', 'pfoot');
            const lt = linkText(book);
            const g = library.isGlobal(book);
            const links = el('span', 'plinks');
            links.innerHTML = ic(g ? 'book' : 'chain', 's');
            links.append(g ? 'Global' : lt || 'Not linked');
            const shown = entriesShown(book, data);
            const on = view?.ids ?? new Set();
            ft.append(links, el('span', 'pcount', `${shown.filter(e => on.has(cardKey(e))).length} of ${shown.length} placed`));
            p.append(ft);
            panelState();
            return;
        }
        const br = el('div', 'bookrow');
        const bp = btn('bookpick', html`<b><span></span>${ic('down', 's')}</b><span class="bchips"></span>`, () => bookPicker(), 'Switch book');
        bp.querySelector('b span').textContent = book;
        const bc = bp.querySelector('.bchips');
        const global = library.isGlobal(book);
        const lt = linkText(book);
        if (global) bc.append(el('span', 'badge g', 'Global'));
        if (lt) { const l = el('span', 'badge l'); l.innerHTML = ic('chain', 's'); l.append(lt); bc.append(l); }
        if (!global && !lt) bc.append(el('span', 'badge o', 'Off'));
        br.append(bp);
        p.append(br);
        panelState();
    }

    function bookPicker() {
        layer.sheet('Switch book', sh => {
            for (const n of visibleNames()) {
                sh.append(layer.opt(n, () => { layer.close(); H.book = n; H.active = 'canvas'; H.panel = false; H.insp = null; H.pick = []; render(); }, { cur: n === H.book, icon: 'book', val: library.isGlobal(n) ? 'Global' : linkText(n) || undefined }));
            }
            if (S.desk) {
                sh.append(layer.opt('New book', () => layer.askText({
                    title: 'New book', placeholder: 'Book name', ok: 'Create', check: n => library.nameProblem(n),
                    done: async n => { const name = await library.create(n); H.book = name; H.active = 'canvas'; H.insp = null; H.pick = []; render(); },
                }), { icon: 'plus' }));
            }
        });
    }

    function packSheet(book, data, name) {
        const m = canvasBook(data);
        const members = m.packMembers(name);
        const usesPack = rs => (rs ?? []).flat().some(r => r === `#${name}` || (typeof r === 'string' && r.startsWith(`#${name}:`)));
        const users = m.E.filter(e => usesPack(e.gate) || usesPack([e.gatesFor]) || usesPack(e.closeGate) || usesPack([e.closesFor]));
        layer.sheet(`#${name}`, sh => {
            sh.append(el('div', 'lbl', 'In this pack'));
            for (const e of members) sh.append(layer.opt(e.title, () => { layer.close(); inspect(book, e.id); }, { dot: strategyColor(e.entry) }));
            if (users.length) {
                sh.append(el('div', 'lbl', 'Used by'));
                for (const e of users) sh.append(layer.opt(e.title, () => { layer.close(); inspect(book, e.id); }, { dot: strategyColor(e.entry) }));
            }
        }, { help: 'A pack is a tag. Gates can wait for any, all, or a number of its entries.' });
    }

    // ---------------------------------------------------------------- the inspector (N4)

    /**
     * The inspector's "Take off canvas": a card placed by hand comes off; a linked card stays while it has links, and
     * the button says why (`why`: what to remove first) instead of hiding.
     */
    function takeOffFor(book, title, why) {
        const key = H.insp.key;
        const view = heroCanvas?.view;
        const mem = canvasMemory(bookSettings(settings, book));
        const linked = view?.g.edges.some(x => x.from === key || x.to === key) || (view?.m.byId(key)?.packs.length ?? 0) > 0;
        if (!linked) return mem.cards[key]?.placed ? () => { delete mem.cards[key]; saveSettings(); H.insp = null; render(); layer.toast(`${title} taken off the canvas`); } : null;
        return () => layer.sheet('It stays while it has links', sh => {
            for (const w of why) sh.append(el('p', 'help', w));
        }, { help: 'A card with story links is always on the canvas, so the links can be seen. Once it has none, it can be taken off.' });
    }

    /** The open chat's character's greetings (BUILD_SPEC 15.4): none with no chat or in a group chat. */
    function chatGreetings(data) {
        const c = ctx();
        if (!library.chatOpen() || c.groupId || c.characterId === undefined) return [];
        const ch = c.characters?.[c.characterId];
        if (!ch?.avatar) return [];
        // Fingerprints the book has for this character's greetings, to spot a changed one.
        const stored = new Map();
        const walk = x => {
            if (Array.isArray(x)) { x.forEach(walk); return; }
            if (!isObject(x)) return;
            if ('greeting' in x && x.char === ch.avatar) { const k = x.greeting; if (!stored.has(k)) stored.set(k, new Set()); stored.get(k).add(x.fp); return; }
            Object.values(x).forEach(walk);
        };
        for (const e of entriesOf(data)) walk(configOf(e));
        const opening = t => String(t ?? '').replace(/[*_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
        return greetingsOf(ch).map((text, n) => {
            const fp = greetingFingerprint(text, getStringHash);
            return {
                key: `greet:${ch.avatar}:${n}`, ref: { greeting: n, char: ch.avatar, name: ch.name, fp }, fp,
                title: greetingName(n), text: opening(text), full: text,
                changed: [...(stored.get(n) ?? [])].some(f => f !== fp),
            };
        }).filter(g => g.full.trim());
    }

    /** Runs `fn(editor, data)` on a book; entries that got an id have their folder and canvas place rekeyed. */
    function editBook(book, fn) {
        let created = [];
        const out = library.change(book, d => { const ed = bookEditor(d); const r = fn(ed, d); created = ed.created; return r; }, { quiet: true });
        if (created.length) {
            for (const [uid, id] of created) {
                rekeyEntry(settings, book, uid, id);
                if (H.insp?.book === book && H.insp.key === `uid:${uid}`) H.insp.key = `id:${id}`;
            }
            saveSettings();
        }
        render();
        return out;
    }

    /** Opens the inspector on a card (from the canvas, a port, a pack sheet or Problems). */
    function inspect(book, key, piece = null, { tab = null } = {}) {
        const data = library.peek(book);
        let open = null;
        if (piece && data && !key.startsWith('greet:')) {
            const e = entriesOf(data).find(x => cardKey(x) === key);
            const c = e ? configOf(e) ?? {} : {};
            const has = piece === 'masks' ? Array.isArray(c.masks) && c.masks.length : piece === 'glue' ? isObject(c.glue) : Array.isArray(c[piece]) && c[piece].length;
            if (has) open = piece;
        }
        const keep = H.insp?.key === key ? H.insp : null;
        H.insp = { book, key, open, full: keep?.full ?? false, scroll: 0, tab: tab ?? H.insp?.tab ?? 'logic', focusText: tab === 'text' };
        if (S.desk) {
            H.pick = [key];
            if (H.dinsp === null && deskSettings().heroInsp !== false && !inspShown()) H.dinsp = true; // a narrow drawer hid it: a click asks for it
        }
        H.panel = false;
        if (S.mode !== 'hero' || H.active !== 'canvas' || H.book !== book) { S.mode = 'hero'; H.active = 'canvas'; H.book = book; }
        else if (heroCanvas && data && main.dataset.page === 'hero:canvas' && !renderQueued) {
            // Already on this canvas: only the inspector changes, so leave the cards and links as they are.
            panelState();
            if (S.desk) {
                heroCanvas.setPicked(new Set([key]), true);
                for (const r of main.querySelectorAll('.prow')) r.classList.toggle('on', r.dataset.key === key);
                heroInspector(book, data);
                heroCanvas.reveal(key);
                return;
            }
            main.querySelector('.insp')?.remove();
            inspectorFor(book, data);
            heroCanvas.reveal(key, 0.5);
            return;
        }
        render();
        if (S.desk) heroCanvas?.setPicked(new Set([key]), true);
        heroCanvas?.reveal?.(key, S.desk ? 1 : 0.5);
    }

    const stateKeyToCard = k => (k.startsWith('@') ? `greet:${k.slice(1)}` : `id:${k.slice(k.indexOf('/') + 1)}`);

    /** What closed an entry in the open chat, with Reopen (D18). */
    function closedInfo(node, e) {
        const loaded = hooks.model;
        if (!node?.key || !loaded.nodes.has(node.key) || !ctx().chat?.length) return null;
        const c = hooks.state().closed[node.key];
        if (!c) return null;
        return {
            by: closedText(c.by, key => loaded.nodes.get(key)?.label ?? (key.startsWith('@') ? 'a greeting' : null)),
            reopen: async () => { await hooks.reopenEntry(node.key); layer.toast(`${titleOf(e)} is open again in this chat`); render(); },
        };
    }

    function inspectorFor(book, data, box = main) {
        const I = H.insp;
        const view = heroCanvas?.view;
        const shown = linkable(book, data);
        const others = except => shown.filter(x => x.uid !== except).map(x => ({ uid: x.uid, title: titleOf(x), dot: strategyColor(x) }));
        const nameOfId = id => { const x = entriesOf(data).find(y => idOf(y) === id); return x ? titleOf(x) : id; };
        const common = {
            layer, full: I.full, scroll: I.scroll, nameOfId, packs: packsOf(data),
            guide: key => openGuide(key ? PIECE_ANCHOR[key] ?? key : null),
            setFull: v => { I.full = v; render(); },
            onScroll: v => { I.scroll = v; },
            close: () => { H.insp = null; if (S.desk) heroCanvas?.setPicked(new Set(), true); render(); },
            inspect: key => inspect(book, key),
            edit: fn => editBook(book, fn),
            desk: S.desk,
            tab: I.tab ?? 'logic',
            focusText: !!I.focusText,
            setTab: k => { I.tab = k; I.focusText = k === 'text'; I.scroll = 0; heroInspector(book, data); I.focusText = false; },
        };
        I.focusText = false;
        if (I.key.startsWith('greet:')) {
            const g = chatGreetings(data).find(x => x.key === I.key);
            if (!g) { H.insp = null; return; }
            const r = greetingRules(data, g.ref);
            const byUid = uid => entriesOf(data).find(x => x.uid === uid);
            const usedBy = r.usedBy.map(byUid).filter(Boolean);
            const gwhy = [];
            if (r.gatesFor.length || r.closesFor.length) gwhy.push('Remove its Gates for and Closes for (above).');
            if (usedBy.length) gwhy.push(`Remove the pieces in other entries that point at it: ${[...new Set(usedBy.map(titleOf))].join(', ')}.`);
            renderGreetingInspector(box, {
                ...common, g, others: others(null), takeOff: takeOffFor(book, g.title, gwhy),
                rules: { gatesFor: r.gatesFor, closesFor: r.closesFor, usedBy: r.usedBy.map(byUid).filter(Boolean).map(x => ({ title: titleOf(x), key: cardKey(x), dot: strategyColor(x) })) },
            });
            return;
        }
        const e = shown.find(x => cardKey(x) === I.key);
        if (!e) { H.insp = null; return; }
        const model = modelOf(book, data);
        const node = model.byStKey.get(`${book}.${e.uid}`);
        const lines = node ? logicLines(node, model) : [];
        const nameOf = k => model.nodes.get(k)?.label ?? (k.startsWith('@') ? model.greetings?.get(k)?.ref ? `${greetingName(model.greetings.get(k).ref.greeting)} of ${model.greetings.get(k).ref.name || model.greetings.get(k).ref.char}` : 'a greeting' : k);
        const sources = [];
        if (node?.key) {
            for (const i of node.opens.all) if (i.source && i.source !== node.key) sources.push({ name: nameOf(i.source), key: stateKeyToCard(i.source), what: i.type === 'greeting' ? 'Starts this' : 'Gates for this', family: 'open' });
            for (const cl of node.closes) if (cl.source && cl.source !== node.key && (cl.kind === 'closesFor' || cl.kind === 'switch')) sources.push({ name: nameOf(cl.source), key: stateKeyToCard(cl.source), what: cl.kind === 'switch' ? 'Another path of its fork' : 'Closes this', family: 'close' });
            for (const k of model.riders?.get(node.key) ?? []) sources.push({ name: nameOf(k), key: stateKeyToCard(k), what: 'Rides along with this', family: 'glue' });
        }
        const mem = canvasMemory(bookSettings(settings, book));
        renderInspector(box, {
            ...common, entry: e,
            setText: v => library.change(book, d => { d.entries[e.uid].content = v; }, { quiet: true }), config: configOf(e) ?? {}, title: isMoment(e) ? momentName(e) : titleOf(e), open: I.open, lines, sources,
            happened: isMoment(e) && H.chatState ? !!chatStatus(book)(I.key)?.happened : null,
            renameMoment: () => layer.askText({
                title: 'Rename Moment', placeholder: 'Missing tooth', value: momentName(e), ok: 'Rename',
                done: v => { if (v.trim()) library.change(book, d => { d.entries[e.uid].comment = `Moment: ${v.trim()}`; }); },
            }),
            deleteMoment: () => {
                const unused = model.issues.some(i => i.stKey === `${book}.${e.uid}` && /nothing uses/.test(i.message));
                if (!unused) { layer.toast('Remove its links first: other cards use this Moment.'); return; }
                H.insp = null;
                deleteEntries(book, [e.uid]);
            },
            others: others(e.uid), greetings: chatGreetings(data),
            problems: problemsOf(model, e.uid, book).map(i => i.message.replace(/^./, ch => ch.toUpperCase())),
            closed: closedInfo(node, e),
            setOpen: k => { I.open = k; render(); },
            openEntry: mask => openHeroTab(book, e.uid, mask ?? null),
            data: () => dataSheet(e),
            takeOff: takeOffFor(book, titleOf(e), [
                ...(lines.length ? ['Remove its own pieces (the rows above).'] : []),
                ...(sources.length ? [`Remove the pieces in other entries that point at it: ${[...new Set(sources.map(x => x.name))].join(', ')}.`] : []),
                ...(view?.m.byId(I.key)?.packs.length ? ['Take it out of its packs.'] : []),
            ]),
            showMask: name => { (mem.cards[I.key] ??= {}).layer = name; saveSettings(); render(); heroCanvas?.reveal?.(I.key, 0.5); },
            renamedMask: (from, to) => { if (mem.cards[I.key]?.layer === from) { mem.cards[I.key].layer = to; saveSettings(); } },
        });
    }

    /** Switches to the canvas of `book` and finds the card, placing it first when it isn't on the canvas. */
    function showOnCanvas(book, key) {
        if (S.mode !== 'hero') { leave(); S.mode = 'hero'; S.select = null; S.search = null; }
        H.book = book;
        H.active = 'canvas';
        H.panel = false;
        const data = library.peek(book);
        if (data) {
            const { m } = heroData(book, data);
            const mem = canvasMemory(bookSettings(settings, book));
            const placedByHand = Object.entries(mem.cards).filter(([, c]) => c.placed).map(([k]) => k);
            if (!canvasSet(m, buildGraph(m), placedByHand).has(key) && m.byId(key)) { mem.cards[key] = { placed: true }; saveSettings(); }
        }
        render();
        heroCanvas?.centerOn(key);
    }

    /** The mode switch at the top of ⌄: tap once to arm it, again to switch (LAYOUT "Modes"). */
    function modeButton(sh) {
        const target = S.mode === 'hero' ? 'Normal mode' : 'Hero mode';
        const b = btn('modebtn', html`${ic(S.mode === 'hero' ? 'entry' : 'canvas')}<span>Switch to ${target}</span>`, () => {
            if (!b.classList.contains('arm')) { b.classList.add('arm'); b.querySelector('span').textContent = `Tap again to switch to ${target}`; return; }
            switchMode();
        });
        sh.append(b);
    }

    function switchMode(focusKey) {
        layer.close();
        if (S.mode === 'normal') {
            const p = page();
            if (focusKey && p.book) { showOnCanvas(p.book, focusKey); return; }
            leave();
            if (p.book) H.book = p.book;
            S.mode = 'hero';
            S.select = null;
            S.search = null;
            H.active = 'canvas';
            H.panel = false;
            render();
        } else {
            S.mode = 'normal';
            if (H.book && visibleNames().includes(H.book)) {
                let t = S.tabs.find(x => !x.home && page(x).book === H.book && page(x).type === 'book')
                    ?? S.tabs.find(x => !x.home && page(x).book === H.book);
                if (!t) { t = { id: ++tabUid, history: [{ type: 'book', book: H.book }] }; S.tabs.push(t); }
                S.active = t.id;
            }
            render();
        }
    }

    function heroMenu(sh) {
        const book = H.book;
        if (book) {
            sh.append(el('div', 'lbl', 'Book'));
            switchRow(sh, 'Active globally', library.isGlobal(book), v => {
                library.setGlobal(book, v);
                render();
                layer.toast(v ? `${book} is active everywhere` : `${book} is no longer global`);
            });
            sh.append(layer.opt('Linked to', () => linksSheet(book), { val: `${linkText(book) || 'Nothing'} ›` }));
            sh.append(layer.opt('Switch book', bookPicker, { val: `${book} ›` }));
            const data = library.peek(book);
            if (data) {
                const issues = modelOf(book, data).issues;
                if (issues.length) sh.append(layer.opt(issueText(issues, { menu: true }), () => problemsSheet(book), { val: '›', cls: 'probs' }));
            }
            sh.append(layer.opt('Snapshots', () => snapshotsSheet(book), { val: '›' }));
        }
        sh.append(layer.opt('Guide', () => { layer.close(); openGuide(null); }, { icon: 'help', val: '›' }));
        sh.append(el('div', 'lbl', 'Canvas'));
        sh.append(layer.opt('Tidy layout', () => {
            layer.close();
            if (H.active !== 'canvas') { H.active = 'canvas'; render(); }
            tidyNow();
        }, { icon: 'tidy', val: S.desk ? 'T' : undefined }));
        switchRow(sh, 'Legend', H.legend, v => { H.legend = v; render(); });
        switchRow(sh, 'Show chat state', H.chatState, v => { H.chatState = v; render(); }, { sub: library.chatOpen() ? 'The open chat, at its latest message' : 'Open a chat to see it' });
    }

    /** The entry's story logic as stored (extensions.wihero), read-only. */
    function dataSheet(e) {
        layer.sheet('Data', sh => {
            const pre = el('pre', 'data', JSON.stringify(e.extensions?.wihero ?? {}, null, 2));
            sh.append(pre);
            sh.append(layer.opt('Copy', async () => {
                try { await navigator.clipboard.writeText(pre.textContent); layer.toast('Copied'); } catch { layer.toast('Couldn\'t copy'); }
            }, { icon: 'copy' }));
        }, { help: 'The story logic as it is stored in the entry. It travels with the book.' });
    }

    const sortBy = () => (SORT_NAMES[settings.sortBy] ? settings.sortBy : 'order');

    // ---------------------------------------------------------------- menus
    /** A menu row with a choice: tapping it unfolds the choices under it; picking one keeps the menu open. */
    function choiceRow(sh, label, choices, cur, pick) {
        const name = k => choices.find(c => c[0] === k)?.[1] ?? '';
        const list = el('div', 'choices');
        list.hidden = true;
        const fold = open => { list.hidden = !open; row.classList.toggle('unfolded', open); row.setAttribute('aria-expanded', String(open)); };
        const row = layer.opt(label, () => fold(list.hidden), { val: name(cur), cls: 'has-choices' });
        row.setAttribute('aria-expanded', 'false');
        for (const [k, lab, sub] of choices) {
            const o = layer.opt(lab, () => {
                pick(k);
                row.querySelector('.val').textContent = name(k);
                for (const x of list.children) x.classList.toggle('cur', x.dataset.k === k);
                fold(false);
            }, { cur: k === cur, sub });
            o.dataset.k = k;
            list.append(o);
        }
        sh.append(row, list);
        return row;
    }

    /** A menu row with a switch that flips in place; the menu stays open. */
    function switchRow(sh, label, on, flip, { sub } = {}) {
        const r = layer.opt(label, () => s.click(), { sub });
        const s = swEl(on, v => {
            flip(v);
            s.classList.toggle('on', v);
            s.setAttribute('aria-checked', String(v));
        }, label);
        r.append(s);
        sh.append(r);
        return r;
    }

    function openMenu() {
        const p = S.mode === 'hero' ? { type: 'hero' } : page();
        layer.sheet(null, sh => {
            modeButton(sh);
            if (p.type === 'hero') heroMenu(sh);
            else if (p.type === 'home') {
                sh.append(el('div', 'lbl', 'View'));
                choiceRow(sh, 'Open books in', [['normal', 'Normal mode'], ['hero', 'Hero mode']], settings.openInHero ? 'hero' : 'normal', k => { settings.openInHero = k === 'hero'; saveSettings(); });
                if (S.desk) choiceRow(sh, 'Show books as', [['tiles', 'Tiles'], ['list', 'List']], deskSettings().homeView === 'list' ? 'list' : 'tiles', k => { deskSettings().homeView = k; saveSettings(); render(); });
            } else if (p.type === 'book') {
                const data = library.peek(p.book);
                sh.append(el('div', 'lbl', 'View'));
                choiceRow(sh, 'Sort by', Object.entries(SORT_NAMES), sortBy(), k => { settings.sortBy = k; saveSettings(); render(); });
                switchRow(sh, 'Show disabled entries', S.showOff, v => { S.showOff = v; render(); });
                if (data) {
                    const issues = modelOf(p.book, data).issues;
                    if (issues.length) sh.append(layer.opt(issueText(issues, { menu: true }), () => problemsSheet(p.book), { val: '›', cls: 'probs' }));
                }
                sh.append(layer.opt('Snapshots', () => snapshotsSheet(p.book), { val: '›' }));
            }
            sh.append(el('div', 'lbl', 'Display'));
            choiceRow(sh, 'Content font', [['serif', 'Serif'], ['sans', 'Sans']], settings.contentFont === 'sans' ? 'sans' : 'serif', k => {
                settings.contentFont = k;
                saveSettings();
                render();
            });
            sh.append(layer.opt('Colors', colorsSheet, { val: COLOR_MODES.find(([k]) => k === settings.colorMode)?.[1] ?? 'Standard' }));
            sh.append(el('div', 'lbl', 'Tabs'));
            sh.append(layer.opt('Close other tabs', () => {
                layer.close();
                if (S.mode === 'hero') {
                    const H = S.hero;
                    H.tabs = typeof H.active === 'number' ? [H.tabs[H.active]] : [];
                    if (H.tabs.length) H.active = 0;
                } else S.tabs = S.tabs.filter(t => t.home || t.id === S.active);
                render();
            }, { icon: 'x' }));
        }, { menu: true });
    }

    function colorsSheet() {
        layer.sheet('Colors', sh => {
            for (const [k, label] of COLOR_MODES) {
                sh.append(layer.opt(label, e => {
                    settings.colorMode = k;
                    saveSettings();
                    render();
                    for (const x of sh.querySelectorAll('.opt')) x.classList.toggle('cur', x === e.currentTarget);
                }, {
                    cur: (settings.colorMode ?? 'standard') === k,
                    sub: k === 'standard' ? 'WI Hero\'s own colors' : k === 'red-green' ? 'Stay apart with red-green color blindness' : 'Stay apart with blue-yellow color blindness',
                }));
            }
            const sw = el('div', 'swatches');
            for (const v of ['open', 'close', 'glue', 'mask', 'pack']) { const i = el('i'); i.style.background = `var(--p-${v})`; i.title = v; sw.append(i); }
            sh.append(sw);
        }, { help: 'The colors of the story pieces. Everything else follows your SillyTavern theme.' });
    }

    function problemsSheet(book) {
        const data = library.peek(book);
        if (!data) return;
        const issues = modelOf(book, data).issues;
        const sorted = [...issues.filter(i => !i.warning), ...issues.filter(i => i.warning)];
        layer.sheet(issueText(issues, { menu: true }), sh => {
            for (const i of sorted) {
                const uid = i.stKey ? Number(i.stKey.slice(i.stKey.lastIndexOf('.') + 1)) : null;
                const o = layer.opt(i.label, () => {
                    layer.close();
                    if (uid === null || !data.entries[uid]) return;
                    if (S.mode === 'hero') { H.active = 'canvas'; showOnCanvas(book, cardKey(data.entries[uid])); inspect(book, cardKey(data.entries[uid])); } else openIn({ type: 'entry', book, uid });
                }, { sub: i.message, dot: i.warning ? 'var(--warn)' : 'var(--bad)' });
                sh.append(o);
            }
        }, { help: 'Problems (red) stop an entry from firing. Warnings (yellow) only point at something odd.' });
    }

    function snapshotsSheet(book) {
        layer.sheet('Snapshots', sh => {
            sh.append(layer.opt('Take snapshot', () => layer.askText({
                title: 'Take snapshot', value: defaultSnapshotName(), ok: 'Take',
                done: async name => {
                    try { await snapshots.take(book, name); layer.toast(`Snapshot "${name}" taken`); } catch (e) { layer.toast(e.message); }
                },
            }), { icon: 'snap' }));
            const list = snapshots.list(book);
            if (!list.length) sh.append(el('p', 'help', 'No snapshots yet. A snapshot is a copy of the whole book you can go back to.'));
            for (const s of list) {
                sh.append(layer.opt(s.name, () => snapshotSheet(book, s), { sub: `${new Date(s.at).toLocaleString()} · ${s.entries} entr${s.entries === 1 ? 'y' : 'ies'}`, icon: s.imported ? 'book' : 'snap' }));
            }
        }, { help: 'Saving is automatic. Snapshots are copies you take yourself, to go back to later.' });
    }

    function snapshotSheet(book, s) {
        layer.sheet(s.name, sh => {
            sh.append(layer.opt('Restore', async () => {
                layer.close();
                try {
                    const old = await snapshots.restore(book, s);
                    render();
                    layer.toast(`Restored "${s.name}"`, { action: ['Undo', async () => { await library.replace(book, old); render(); layer.toast('Restore undone'); }] });
                } catch (e) { layer.toast(e.message); }
            }, { icon: 'back', sub: 'Puts the book back as it was. The chat\'s story state stays as it is.' }));
            if (!s.imported) {
                sh.append(layer.opt('Rename', () => layer.askText({ title: 'Rename snapshot', value: s.name, done: n => { snapshots.rename(book, s, n); snapshotsSheet(book); } }), { icon: 'edit' }));
            }
            sh.append(layer.opt('Delete', () => {
                layer.close();
                snapshots.forget(book, s);
                layer.toast(`Deleted snapshot "${s.name}"`, {
                    action: ['Undo', () => snapshots.keep(book, s)],
                    onEnd: () => snapshots.removeFile(s),
                });
            }, { icon: 'trash', danger: true }));
        }, { help: `${new Date(s.at).toLocaleString()} · ${s.entries} entries${s.imported ? ` · ${IMPORTED.toLowerCase()}` : ''}` });
    }

    function bookMenu(book, { fromHome = false, fromPage = false } = {}) {
        layer.sheet(book, sh => {
            if (fromPage) {
                sh.append(layer.opt('List', () => layer.close(), { cur: true, icon: 'entry', sub: 'This page' }));
                sh.append(el('div', 'div'));
                sh.append(layer.opt('New folder…', () => newEntryFolder(book), { icon: 'folder' }));
            }
            if (fromHome) sh.append(layer.opt('Open in new tab', () => { layer.close(); openIn({ type: 'book', book }, { newTab: true }); }, { icon: 'tab' }));
            sh.append(layer.opt('Rename', () => renameBook(book), { icon: 'edit' }));
            if (fromPage) sh.append(layer.opt('Duplicate', () => { layer.close(); duplicateBook(book); }, { icon: 'copy' }));
            sh.append(layer.opt('Move to folder', () => bookFolderSheet(f => { setBookFolder(settings, book, f); saveSettings(); render(); }), { icon: 'move', val: bookFolderOf(settings, book) || 'No folder' }));
            sh.append(layer.opt('Export', () => { layer.close(); library.exportBook(book); layer.toast(`${book}.json exported`); }, { icon: 'code' }));
            sh.append(layer.opt('Snapshots', () => snapshotsSheet(book), { icon: 'snap', val: '›' }));
            sh.append(layer.opt('Delete', () => { layer.close(); deleteBooks([book]); }, { icon: 'trash', danger: true }));
        });
    }

    function newEntryFolder(book) {
        layer.askText({
            title: 'New folder', placeholder: 'Folder name (Places/Town for one inside another)', ok: 'Create',
            done: f => {
                const b = bookSettings(settings, book);
                b.folderList = [...new Set([...(b.folderList ?? []), f.split('/').map(x => x.trim()).filter(Boolean).join('/')])];
                saveSettings();
                render();
            },
        });
    }
    function renameBook(book) {
        layer.askText({
            title: 'Rename book', placeholder: 'Book name', value: book, check: n => library.nameProblem(n, book),
            done: async n => {
                if (n === book) return;
                try {
                    const to = await library.rename(book, n);
                    renameBookSettings(settings, book, to);
                    saveSettings();
                    for (const t of S.tabs) for (const p of t.history) if (p.book === book) p.book = to;
                    if (H.book === book) H.book = to;
                    for (const t of H.tabs) if (t.book === book) t.book = to;
                    render();
                    layer.toast(`Renamed to ${to}`);
                } catch (e) { layer.toast(e.message); }
            },
        });
    }
    async function duplicateBook(book) {
        let to;
        try { to = await library.duplicate(book); } catch (e) { layer.toast(`Could not duplicate ${book}: ${e.message}`); return; }
        copyBookSettings(settings, book, to);
        saveSettings();
        openIn({ type: 'book', book: to }, { newTab: true });
        layer.toast(`Made ${to}`);
    }
    /** Moves entries to another book; links to entries of this one don't travel. */
    function moveToBookSheet(book, uids, after = () => {}) {
        layer.sheet('Move to', s2 => {
            for (const n of visibleNames().filter(x => x !== book)) {
                s2.append(layer.opt(n, async () => {
                    layer.close();
                    const target = await library.get(n);
                    if (!target) return;
                    const moved = [];
                    library.change(book, from => {
                        for (const uid of uids) {
                            if (!from.entries[uid]) continue;
                            delete bookSettings(settings, book).folders[cardKey(from.entries[uid])];
                            moved.push(moveEntry(from, uid, target));
                        }
                    });
                    library.change(n, () => {});
                    saveSettings();
                    after(n, moved);
                    render();
                    layer.toast(moved.length === 1 ? `Moved to ${n}` : `Moved ${moved.length} entries to ${n}`);
                }, { icon: 'book' }));
            }
        }, { help: 'Links to other entries of this book don\'t travel; the other book lists them as problems.' });
    }

    function entryMenu(book, uid, { onPage = false, heroTab = null, desk = null } = {}) {
        const ht = heroTab ? H.tabs[H.active] : null;
        const data = library.peek(book);
        const e = data?.entries[uid];
        if (!e) return;
        if (desk) { deskEntryMenu(book, uid, e, desk); return; }
        layer.sheet(titleOf(e), sh => {
            if (ht) sh.append(layer.opt('Show on canvas', () => { layer.close(); showOnCanvas(book, cardKey(e)); }, { icon: 'canvas' }));
            else sh.append(layer.opt('Open in new tab', () => { layer.close(); openIn({ type: 'entry', book, uid }, { newTab: true }); }, { icon: 'tab' }));
            sh.append(layer.opt('Duplicate', () => {
                layer.close();
                const copy = library.change(book, d => duplicateEntry(d, uid));
                const f = entryFolder(book, e);
                if (f) { setFolder(settings, book, copy, f); saveSettings(); }
                if (onPage) { leave(); tab().history[tab().history.length - 1] = { type: 'entry', book, uid: copy.uid }; }
                if (ht) ht.uid = copy.uid;
                render();
                layer.toast(`Made ${titleOf(copy)}`);
            }, { icon: 'copy' }));
            sh.append(layer.opt('Move to folder', () => folderSheet(book, entryFolder(book, e), f => { setFolder(settings, book, e, f); saveSettings(); render(); }), { icon: 'folder', val: entryFolder(book, e) || 'No folder' }));
            sh.append(layer.opt('Move to another book', () => layer.sheet('Move to', s2 => {
                for (const n of visibleNames().filter(x => x !== book)) {
                    s2.append(layer.opt(n, async () => {
                        layer.close();
                        const target = await library.get(n);
                        if (!target) return;
                        delete bookSettings(settings, book).folders[cardKey(e)];
                        let moved;
                        library.change(book, from => { moved = moveEntry(from, uid, target); });
                        library.change(n, () => {});
                        saveSettings();
                        if (onPage) { tab().history[tab().history.length - 1] = { type: 'entry', book: n, uid: moved.uid }; }
                        if (ht) { ht.book = n; ht.uid = moved.uid; }
                        render();
                        layer.toast(`Moved to ${n}`);
                    }, { icon: 'book' }));
                }
            }, { help: 'Links to other entries of this book don\'t travel; the other book lists them as problems.' }), { icon: 'move' }));
            sh.append(layer.opt('Copy as text', async () => {
                layer.close();
                try { await navigator.clipboard.writeText(entryAsText(e)); layer.toast('Copied'); } catch { layer.toast('Couldn\'t copy'); }
            }, { icon: 'entry' }));
            sh.append(layer.opt('Delete', () => {
                layer.close();
                if (onPage) { const t = tab(); if (t.history.length > 1) t.history.pop(); else t.history = [{ type: 'book', book }]; }
                if (ht) { const i = H.tabs.indexOf(ht); H.tabs.splice(i, 1); H.active = i > 0 ? i - 1 : 'canvas'; }
                deleteEntries(book, [uid]);
            }, { icon: 'trash', danger: true }));
        });
    }

    /**
     * Desktop's entry menu (right-click, ⋯, ⋮): Open in new tab · Turn off · Duplicate · Move to folder · Move to
     * another book · Copy as text · Delete. In an entry tab, "Show in its book" stands for Open in new tab.
     */
    function deskEntryMenu(book, uid, e, d) {
        const p = page();
        layer.sheet(null, sh => {
            if (d.openTab) sh.append(layer.opt('Open in new tab', () => { layer.close(); d.openTab(); }, { icon: 'tab', val: 'Double-click' }));
            if (d.inBook) sh.append(layer.opt('Show in its book', () => { layer.close(); d.inBook(); }, { icon: 'book' }));
            sh.append(layer.opt(e.disable ? 'Turn on' : 'Turn off', () => { layer.close(); library.change(book, x => { x.entries[uid].disable = !e.disable; }); }, { icon: e.disable ? 'on' : 'off', val: 'Space' }));
            sh.append(layer.opt('Duplicate', () => {
                layer.close();
                const copy = library.change(book, x => duplicateEntry(x, uid), { quiet: true });
                const f = entryFolder(book, e);
                if (f) { setFolder(settings, book, copy, f); saveSettings(); }
                if (p.type === 'book') { p.sel = copy.uid; p.anchor = copy.uid; p.select = null; }
                render();
                layer.toast(`Made ${titleOf(copy)}`);
            }, { icon: 'copy', val: 'Ctrl D' }));
            sh.append(layer.opt('Move to folder', () => folderSheet(book, entryFolder(book, e), f => { setFolder(settings, book, e, f); saveSettings(); render(); }), { icon: 'folder', val: entryFolder(book, e) || 'No folder' }));
            sh.append(layer.opt('Move to another book', () => moveToBookSheet(book, [uid], (n, moved) => {
                if (p.type === 'entry') Object.assign(p, { book: n, uid: moved[0].uid });
                else if (p.type === 'book') p.sel = null;
            }), { icon: 'move' }));
            sh.append(layer.opt('Copy as text', async () => {
                layer.close();
                try { await navigator.clipboard.writeText(entryAsText(e)); layer.toast('Copied'); } catch { layer.toast('Couldn\'t copy'); }
            }, { icon: 'entry' }));
            sh.append(el('div', 'div'));
            sh.append(layer.opt('Delete', () => {
                layer.close();
                if (d.afterDelete) { d.afterDelete(); return; }
                if (p.type === 'entry' && p.book === book && p.uid === uid) { const t = tab(); S.tabs.splice(S.tabs.indexOf(t), 1); S.active = S.tabs[0].id; }
                deleteEntries(book, [uid]);
            }, { icon: 'trash', danger: true, val: 'Delete' }));
        }, { at: d.at });
    }

    /** The entry folders of a book, No folder, and + New folder. This is the main way folders get made. */
    function folderSheet(book, current, pick) {
        const data = library.peek(book);
        const folders = [...new Set([...entriesOf(data).map(e => entryFolder(book, e)).filter(Boolean), ...(bookSettings(settings, book).folderList ?? [])])].sort();
        layer.sheet('Move to folder', sh => {
            sh.append(layer.opt('No folder', () => { layer.close(); pick(''); }, { cur: current === '', icon: 'entry' }));
            for (const f of folders) sh.append(layer.opt(f, () => { layer.close(); pick(f); }, { cur: current === f, icon: 'folder' }));
            sh.append(layer.opt('New folder', () => layer.askText({ title: 'New folder', placeholder: 'Folder name', ok: 'Move', done: f => pick(f) }), { icon: 'plus' }));
        });
    }

    function bookFolderSheet(pick) {
        const folders = Object.keys(settings.bookFolders).sort();
        layer.sheet('Move to folder', sh => {
            sh.append(layer.opt('No folder', () => { layer.close(); pick(''); }, { icon: 'book' }));
            for (const f of folders) sh.append(layer.opt(f, () => { layer.close(); pick(f); }, { icon: 'folder' }));
            sh.append(layer.opt('New folder', () => layer.askText({ title: 'New folder', placeholder: 'Folder name', ok: 'Move', done: f => pick(f) }), { icon: 'plus' }));
        }, { help: 'WI Hero\'s own folders for books.' });
    }

    function linksSheet(book) {
        layer.sheet('Linked to', sh => {
            const links = library.links(book);
            if (!links.length) sh.append(el('p', 'help', 'Not linked to any character or chat.'));
            for (const l of links) {
                sh.append(layer.opt(l.name, async () => {
                    layer.close();
                    try { await library.unlink(book, l); layer.toast(`Unlinked from ${l.name}`); } catch (e) { layer.toast(e.message); }
                    render();
                }, { val: 'Unlink', icon: l.kind === 'chat' ? 'entry' : 'user', sub: l.kind === 'char' ? 'Character\'s book' : l.kind === 'aux' ? 'Character\'s extra book' : undefined }));
            }
            if (library.chatOpen() && library.chatBook() !== book) {
                const other = library.chatBook();
                sh.append(layer.opt('Link to this chat', async () => { layer.close(); await library.linkChat(book); render(); }, { icon: 'plus', sub: other ? `Instead of ${other}` : undefined }));
            }
        }, { help: 'Characters and chats that turn this book on. Unlinking is how you turn a linked book off.' });
    }

    /** SillyTavern's World Info settings, all of them, in groups (they apply to every book). */
    function wiSettingsSheet() {
        let scroll = 0;
        const n = v => Number(v).toLocaleString();
        const draw = () => {
            const sh = layer.sheet('World Info settings', sh => {
                const s = library.wiSettings();
                const num = (key, label, sub, min, max, shown = v => String(v)) => sh.append(layer.opt(label, () => layer.askText({
                    title: label, value: String(s[key]), type: 'number',
                    check: v => (Number.isInteger(Number(v)) && Number(v) >= min && Number(v) <= max ? null : `A whole number from ${min} to ${max}`),
                    done: v => { library.setWiSetting(key, Number(v)); draw(); },
                }), { sub, val: shown(s[key]) }));
                const flag = (key, label, sub) => switchRow(sh, label, !!s[key], v => library.setWiSetting(key, v), { sub });

                sh.append(el('div', 'lbl', 'Scanning'));
                num('depth', 'Scan depth', 'How many recent messages are searched for key words', 0, 1000);
                flag('recursive', 'Recursive scan', 'Entries that fire can trigger other entries with their text');
                num('maxRecursion', 'Recursion steps', 'How many rounds of entries triggering entries. 0 is no limit. Can\'t be used with Min activations', 0, 10,
                    v => (v ? String(v) : 'No limit'));
                num('minActivations', 'Min activations', 'Keeps scanning older messages until this many entries fire. 0 is off. Turns off Recursion steps', 0, 100,
                    v => (v ? String(v) : 'Off'));
                num('minActivationsDepth', 'Min activations: max depth', 'How far back Min activations may look. 0 is the whole chat', 0, 100,
                    v => (v ? String(v) : 'Whole chat'));

                sh.append(el('div', 'lbl', 'Matching'));
                flag('caseSensitive', 'Case-sensitive', 'Key words match only with the same capitals');
                flag('wholeWords', 'Match whole words', 'A key word must stand as a word: "inn" won\'t match "inner"');
                flag('includeNames', 'Include names', 'Speaker names are part of the text that is scanned');
                flag('groupScoring', 'Group scoring', 'In an inclusion group, the entry matching the most key words wins');

                sh.append(el('div', 'lbl', 'Budget'));
                const tokens = s.maxContext ? Math.round(s.budget * s.maxContext / 100) : null;
                num('budget', 'Budget', tokens === null ? 'How much of the context World Info may use'
                    : `About ${n(tokens)} tokens of your ${n(s.maxContext)}-token context`, 1, 100, v => `${v}%`);
                num('budgetCap', 'Token cap', 'The most tokens World Info may use, whatever the percent says. 0 is no cap', 0, 65536,
                    v => (v ? `${n(v)} tokens` : 'No cap'));
                if (s.budgetCap && tokens !== null && s.budgetCap < tokens) sh.append(el('p', 'help', `The cap wins: World Info gets at most ${n(s.budgetCap)} tokens.`));
                flag('overflowAlert', 'Alert on overflow', 'A notice when entries are left out because the budget ran out');

                sh.append(el('div', 'lbl', 'Order'));
                const order = [['0', 'Sorted evenly', 'Every book\'s entries by their order'], ['1', 'Character books first'], ['2', 'Global books first']];
                const cur = order.find(([k]) => k === String(s.bookOrder)) ?? order[1];
                sh.append(layer.opt('Book order', () => layer.sheet('Book order', o => {
                    for (const [k, label, sub] of order) o.append(layer.opt(label, () => { library.setWiSetting('bookOrder', Number(k)); draw(); }, { cur: k === cur[0], sub }));
                }, { help: 'Which books\' entries go into the prompt first when several books are on.' }), { sub: 'Whose entries go in first', val: `${cur[1]} ›` }));
            }, { help: 'SillyTavern\'s own settings. They apply to every book.' });
            sh.scrollTop = scroll;
            sh.addEventListener('scroll', () => { scroll = sh.scrollTop; });
        };
        draw();
    }

    // ---------------------------------------------------------------- desktop
    // Hero mode on desktop (LAYOUT "Desktop: Hero mode"): three columns, the canvas's mouse, keys.
    /** The entry list shows when asked; else as the size has it (widened: shown, drawer size: hidden). */
    const listShown = () => H.dlist ?? (deskSettings().heroWide !== false);
    /** The inspector shows unless hidden; in a narrow drawer it starts hidden, so the canvas keeps some room. */
    const inspShown = () => H.dinsp ?? (deskSettings().heroInsp !== false && (deskSettings().heroWide !== false || (main.clientWidth || 9999) >= 800));
    function deskColumns() {
        main.style.setProperty('--lw', listShown() ? `${deskSettings().heroListW ?? 250}px` : '0px');
        main.style.setProperty('--iw', inspShown() ? `${deskSettings().heroInspW ?? 320}px` : '0px');
    }

    function tidyNow() {
        const undo = heroCanvas?.tidy();
        if (undo) layer.toast('Tidied', { action: ['Undo', () => { undo(); layer.toast('Layout put back'); }] });
    }

    /** Takes the selected cards off the canvas; a card with links stays, and the toast says so. */
    function takeOffPicked(keys = heroCanvas?.picked() ?? []) {
        const book = H.book;
        const view = heroCanvas?.view;
        if (!book || !view || !keys.length) return;
        const mem = canvasMemory(bookSettings(settings, book));
        const linked = k => view.g.edges.some(x => x.from === k || x.to === k) || (view.m.byId(k)?.packs.length ?? 0) > 0;
        const off = keys.filter(k => !linked(k) && mem.cards[k]?.placed);
        const stay = keys.filter(k => linked(k));
        for (const k of off) delete mem.cards[k];
        if (off.length) { saveSettings(); H.insp = null; heroCanvas.setPicked(new Set(), true); render(); }
        const nm = k => view.m.byId(k)?.title ?? 'It';
        if (stay.length) layer.toast(stay.length === 1 ? `${nm(stay[0])} stays: it has links. Remove them first` : `${stay.length} cards stay: they have links`);
        else if (off.length) layer.toast(off.length === 1 ? `${nm(off[0])} taken off the canvas` : `${off.length} cards taken off the canvas`);
    }

    /** What the canvas does with a mouse on desktop: left to right, link drags, menus, selection. */
    function deskCanvas(book, data) {
        return {
            desk: true,
            dir: LR,
            tools: box => {
                box.append(btn('', ic('tidy'), () => tidyNow(), 'Tidy layout (T)'));
                const t = btn('itoggle', ic('drawer'), () => {
                    const v = !inspShown();
                    H.dinsp = v;
                    if (deskSettings().heroWide !== false) { deskSettings().heroInsp = v; saveSettings(); H.dinsp = null; }
                    render();
                }, 'Show or hide the inspector');
                t.title = 'Show or hide the inspector';
                box.append(t);
                for (const b of box.querySelectorAll('button')) b.title ||= b.getAttribute('aria-label') ?? '';
            },
            link: (kind, from, to) => {
                const x = barApi(book);
                const src = nodeOf(book, from);
                const dst = nodeOf(book, to);
                if (!src || !dst) return;
                if (kind === 'ride' && (src.t !== 'entry' || dst.t !== 'entry')) { layer.toast('Glue goes between entries.'); return; }
                const piece = { open: 'opens', close: 'closes', ride: 'glue' }[kind];
                openStrip(book, { piece, isNew: true, snap: x.snapshot(), dirty: false, note: null, src, dst: null, ...(kind === 'ride' ? { mode: 'ride' } : {}) });
                H.bar.loosePick?.(dst);
            },
            openText: key => inspect(book, key, null, { tab: 'text' }),
            onPick: keys => {
                H.pick = keys;
                if (keys.length === 1) { inspect(book, keys[0]); return; }
                H.insp = null;
                heroInspector(book, data);
            },
            cardMenu: key => cardMenu(book, data, key),
            emptyMenu: at => placePicker(book, data, at),
        };
    }

    function cardMenu(book, data, key) {
        const end = nodeOf(book, key);
        if (!end) return;
        if (end.t === 'pack') { packSheet(book, data, end.name); return; }
        const e = end.t === 'entry' ? data.entries[end.uid] : null;
        const title = e ? titleOf(e) : chatGreetings(data).find(g => g.key === key)?.title ?? 'Greeting';
        const view = heroCanvas?.view;
        const linked = view?.g.edges.some(x => x.from === key || x.to === key) || (view?.m.byId(key)?.packs.length ?? 0) > 0;
        layer.sheet(title, sh => {
            sh.append(layer.opt('Inspect', () => { layer.close(); inspect(book, key); }, { icon: 'eye', val: 'Click' }));
            if (e) {
                sh.append(layer.opt('Open entry', () => { layer.close(); openHeroTab(book, e.uid); }, { icon: 'tab', val: 'New tab' }));
                sh.append(layer.opt('Edit text', () => { layer.close(); inspect(book, key, null, { tab: 'text' }); }, { icon: 'edit', val: 'Double-click' }));
            }
            sh.append(el('div', 'lbl', 'Add piece'));
            for (const p of BAR) sh.append(layer.opt(p.label, () => { layer.close(); dropPiece(book, p.k, { card: key }); }, { dot: `var(--p-${p.c})`, val: p.key }));
            if (e) sh.append(layer.opt('Data', () => { layer.close(); dataSheet(e); }, { icon: 'code' }));
            sh.append(layer.opt('Take off canvas', () => { layer.close(); takeOffPicked([key]); }, { icon: 'trash', val: linked ? 'Remove its links first' : 'Del', cls: linked ? 'muted' : undefined }));
        });
    }

    /** The right column: the card's inspector, the selected cards, or the book. */
    function heroInspector(book, data) {
        main.querySelector('.hinsp')?.remove();
        main.querySelector('.insp')?.remove();
        deskColumns();
        if (!inspShown()) return;
        const col = el('aside', 'hinsp');
        main.append(col);
        col.append(resizer(() => deskSettings().heroInspW ?? 320, w => { deskSettings().heroInspW = w; deskColumns(); }, { min: 260, max: 560, def: 320, side: 'left', onEnd: () => saveSettings() }));
        if (H.insp?.book === book) {
            inspectorFor(book, data, col);
            if (H.insp) return;
        }
        const picked = (heroCanvas?.picked() ?? []).filter(k => nodeOf(book, k));
        if (picked.length > 1) groupPane(col, book, data, picked);
        else bookPane(col, book, data);
    }

    function bookPane(col, book, data) {
        const sh = el('div', 'insp book');
        const body = el('div', 'ibody');
        sh.append(body);
        col.append(sh);
        const head = el('div', 'ihead');
        head.append(el('h2', '', book));
        body.append(head);
        const issues = modelOf(book, data).issues;
        body.append(el('div', 'lbl', 'Problems'));
        if (!issues.length) body.append(el('p', 'help', 'No problems in this book.'));
        for (const i of [...issues.filter(x => !x.warning), ...issues.filter(x => x.warning)]) {
            const uid = i.stKey ? Number(i.stKey.slice(i.stKey.lastIndexOf('.') + 1)) : null;
            body.append(layer.opt(i.label, () => {
                const x = uid === null ? null : data.entries[uid];
                if (x) { showOnCanvas(book, cardKey(x)); inspect(book, cardKey(x)); }
            }, { sub: i.message, dot: i.warning ? 'var(--warn)' : 'var(--bad)' }));
        }
        body.append(el('div', 'lbl', 'Links'));
        const lg = el('div', 'ilegend');
        for (const [v, label, dashed] of [['open', 'Opens: waits for, then opens'], ['close', 'Closes', true], ['glue', 'Glue: rides along'], ['mask', 'Masks (stacked cards)'], ['pack', 'Pack frame', true]]) {
            const r = el('span');
            r.style.color = `var(--p-${v})`;
            r.append(el('i', dashed ? 'd' : ''), el('span', '', label));
            lg.append(r);
        }
        body.append(lg);
        body.append(el('div', 'lbl', 'Mouse'));
        body.append(el('p', 'help', 'Rest the pointer on a card to see its links. Click to inspect, double-click to edit its text. Drag a card to move it, drag empty space to pan, Shift-drag to select several. The wheel zooms. Drag a colored port or a handle under a card onto another card to link them. Right-click a card or the canvas for more.'));
    }

    function groupPane(col, book, data, keys) {
        const ends = keys.map(k => nodeOf(book, k));
        const uids = ends.filter(x => x?.t === 'entry').map(x => x.uid);
        const names = keys.map(k => heroCanvas?.view?.m.byId(k)?.title ?? k);
        const sh = el('div', 'insp group');
        const body = el('div', 'ibody');
        sh.append(body);
        col.append(sh);
        const head = el('div', 'ihead');
        head.append(el('h2', '', `${keys.length} cards selected`), btn('round flat', ic('x'), () => { heroCanvas?.setPicked(new Set()); }, 'Clear the selection'));
        body.append(head);
        body.append(el('p', 'help', `${names.join(', ')}. Drag any of them to move them together.`));
        const act = (label, icon, fn) => body.append(layer.opt(label, fn, { icon }));
        act('Pack into…', 'tag', () => layer.sheet('Pack into', s2 => {
            const pack = name => {
                layer.close();
                if (barAct(book, ed => { for (const u of uids) ed.update(u, c => { c.packs = addToList(Array.isArray(c.packs) ? c.packs : [], name); }); })) layer.toast(`${uids.length} entries packed into #${name}`);
            };
            for (const p of packsOf(data)) s2.append(layer.opt(`#${p}`, () => pack(p), { icon: 'tag' }));
            s2.append(layer.opt('New pack…', () => layer.askText({
                title: 'New pack', placeholder: 'Pack name (town/inn for one inside another)', ok: 'Add',
                check: v => (/^[A-Za-z0-9][A-Za-z0-9_.\-/]*$/.test(v.replace(/^#/, '')) ? null : 'Letters, numbers, - _ . and / only'),
                done: v => pack(v.replace(/^#/, '')),
            }), { icon: 'plus' }));
        }));
        // Hold the group back until one card fires: each selected card waits for it (and for what it already waits for).
        act('Make these wait for…', 'canvas', () => layer.sheet(`Which card do these ${uids.length} wait for?`, s2 => {
            for (const x of sortEntries(entriesShown(book, data), sortBy()).filter(x => !uids.includes(x.uid))) {
                s2.append(layer.opt(titleOf(x), () => {
                    layer.close();
                    const src = { t: 'entry', uid: x.uid };
                    if (barAct(book, (ed, d) => { for (const u of uids) addLink(ed, d, 'open', src, { t: 'entry', uid: u }, { join: 'and' }); })) layer.toast(`${uids.length} entries wait for ${titleOf(x)}`);
                }, { dot: strategyColor(x) }));
            }
        }, { help: 'They open once it has fired.' }));
        act('Make one wait for all of these…', 'canvas', () => layer.sheet('Which card waits for all of them?', s2 => {
            for (const x of sortEntries(entriesShown(book, data), sortBy()).filter(x => !uids.includes(x.uid))) {
                s2.append(layer.opt(titleOf(x), () => {
                    layer.close();
                    const dst = { t: 'entry', uid: x.uid };
                    if (barAct(book, (ed, d) => { for (const u of uids) addLink(ed, d, 'open', { t: 'entry', uid: u }, dst, { join: 'and' }); })) layer.toast(`${titleOf(x)} waits for all ${uids.length}`);
                }, { dot: strategyColor(x) }));
            }
        }, { help: 'It opens once every selected entry has fired.' }));
        act('Turn off', 'on', () => {
            library.change(book, d => { for (const u of uids) if (d.entries[u]) d.entries[u].disable = true; });
            layer.toast(`${uids.length} entries turned off`);
        });
        act('Take off canvas', 'trash', () => takeOffPicked(keys));
    }

    function heroKey(e) {
        const k = e.key;
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && !e.altKey && k.toLowerCase() === 'k') { S.search = { query: S.search?.query ?? '', at: 0 }; render(); return true; }
        if (S.search || layer.isOpen() || typing() || ctrl || e.altKey) return false;
        if (H.active !== 'canvas' || !heroCanvas || !H.book) return false;
        const book = H.book;
        const up = k.length === 1 ? k.toUpperCase() : k;
        if (k === '?') { H.explain ? stopExplain() : startExplain(); return true; }
        const piece = !e.shiftKey && BAR.find(p => p.key === up);
        if (piece) {
            if (H.bar.edit) return false;
            const sel = heroCanvas.picked();
            if (sel.length === 1) { dropPiece(book, piece.k, { card: sel[0] }); return true; }
            H.bar.armed = H.bar.armed === piece.k ? null : piece.k;
            render();
            return true;
        }
        if (up === 'F') { heroCanvas.fit(); return true; }
        if (up === 'T') { tidyNow(); return true; }
        if (k === '+' || k === '=') { heroCanvas.zoomAt(1.2); return true; }
        if (k === '-') { heroCanvas.zoomAt(1 / 1.2); return true; }
        if (k === '/') { H.dlist = true; render(); main.querySelector('.panel .phead input')?.focus(); return true; }
        if (k === 'Delete' || k === 'Backspace') { takeOffPicked(); return true; }
        return false;
    }

    /** Esc on desktop: menu, search, armed piece, strip (Cancel), text box, selection, then closes WI Hero. */
    function heroBackDesk() {
        if (S.search) { S.search = null; render(); return true; }
        if (H.active === 'canvas') {
            if (H.bar.armed) { H.bar.armed = null; render(); return true; }
            if (H.bar.edit) {
                const ed = H.bar.edit;
                if (ed.dirty) barApi(ed.book).restore(ed.snap);
                H.bar.edit = null;
                H.bar.loosePick = null;
                render();
                return true;
            }
        }
        if (typing()) { shadow.activeElement?.blur(); return true; }
        if (H.active === 'canvas' && (H.insp || heroCanvas?.picked().length)) {
            H.insp = null;
            heroCanvas?.setPicked(new Set(), true);
            render();
            return true;
        }
        if (H.active === 'preview' && H.pv?.page) { H.pv.page = null; render(); return true; }
        hide();
        return false;
    }
    /** Discards a new entry left completely empty when the book pane moves on from it. */
    function leaveEntry(p) {
        if (p.fresh == null || p.fresh !== p.sel) return;
        const uid = p.fresh;
        p.fresh = null;
        const e = library.peek(p.book)?.entries[uid];
        if (e && isBlank(e)) { library.change(p.book, d => { removeEntry(d, uid); }, { quiet: true }); layer.toast('Empty entry removed'); }
    }
    /** A new entry in a book (and folder), with the book's defaults, not opened anywhere yet. */
    function createEntryIn(book, folder = '') {
        if (!library.peek(book)) return null;
        const x = createEntry(book, '');
        if (folder) { setFolder(settings, book, x, folder); saveSettings(); }
        return x;
    }
    function openHero(book) {
        leave();
        H.book = book;
        S.mode = 'hero';
        S.select = null;
        S.search = null;
        H.active = 'canvas';
        H.panel = false;
        render();
    }
    const deskN = deskNormal({
        S, settings, library, layer, main, root, shadow,
        saveSettings: () => saveSettings(),
        tab, page, leave, render, renderTabs, closeTab, hide, need, loadingNote, modelOf, entriesShown, hiddenIn, entryFolder,
        problemsOf, linkText, countInto, sortBy, visibleNames, deleteBooks, deleteEntries, newBook, importBook, offHint, wiSettingsSheet,
        bookFolderSheet, folderSheet, snapshotsSheet, problemsSheet, renameBook, duplicateBook, newEntryFolder, openHero,
        createEntryIn, entryMenu, moveToBookSheet, applyParam, leaveEntry,
        hasLogic: e => { const c = configOf(e); return !!c && Object.keys(c).some(k => k !== 'id'); },
        nextTabId: () => ++tabUid,
        typing: () => typing(),
        renderEntryInto: (into, p, extra) => renderEntry(p, null, into, extra),
        heroBook: () => heroBook(),
        // Search in Hero mode: an entry is found on its canvas (or opened in a tab), a book or folder switches the canvas.
        heroOpen: (h, background) => {
            if (h.kind === 'entry') {
                if (background) { if (!H.tabs.some(t => t.book === h.book && t.uid === h.entry.uid)) H.tabs.push({ book: h.book, uid: h.entry.uid }); render(); layer.toast('Opened in a background tab'); return; }
                showOnCanvas(h.book, cardKey(h.entry));
                inspect(h.book, cardKey(h.entry));
                return;
            }
            if (h.book) { H.book = h.book; H.active = 'canvas'; H.insp = null; H.pick = []; }
            render();
        },
    });

    return {
        show, hide, toggle, isOpen, refresh, host, back, openBook,
        /** For the in-ST checks. */
        get state() { return S; },
    };
}

