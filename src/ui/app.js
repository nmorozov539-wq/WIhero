// The WI Hero editor: one element on document.body (BUILD_SPEC 8.1) that ST's World Info button opens instead of
// ST's drawer. Closing only hides it; after a reload it starts on Home (D6). N2 builds the shared chrome and normal
// mode (LAYOUT "Shared" and "Normal mode"). Its own styles live in a shadow root, so ST's CSS and WI Hero's can't
// clash; ST's theme variables still come through.
import { buildModel, isMoment } from '../engine/model.js';
import { btn, html, createLayer, el, issueText, longPress, pressable, swEl } from './dom.js';
import { ic } from './icons.js';
import {
    MIXED, PARAM_LIST, addEntry, filterChoices, bookFolderOf, bookSettings, cardKey, commonValue, configOf,
    deleteBookSettings, entriesOf, folderOf, groupEntries, SORT_NAMES, sortEntries, idOf, isBlank, paramSummary,
    paramText, paramValue, rekeyEntry, removeEntry, search, setBookFolder, setFolder, setParam, strategyOf, titleOf,
} from './data.js';
import { editParam, paramRow, renderEntryPage, strategyColor } from './entry-page.js';
import { closedText, logicLines } from './logic-text.js';
import { LR, canvasBook } from './canvas-graph.js';
import { canvasMemory, mountCanvas } from './canvas.js';
import { entryStatus } from '../engine/turn.js';
import { getStringHash, isObject } from '../engine/util.js';
import { greetingFpOf, greetingSignature } from '../chat-state.js';
import { addToList, bookEditor, packsOf } from './pieces.js';
import { addLink } from './links.js';
import { BAR, mountPieceBar } from './piecebar.js';
import { createPreview } from './preview-view.js';
import { createHeroPanel } from './hero-panel.js';
import { createMenus } from './menus.js';
import { createHeroBar } from './hero-bar.js';
import { createHeroInspector } from './hero-inspector.js';
import { SAMPLE, createExplain } from './explain.js';
import { deskNormal, resizer } from './desk.js';

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

    // ---------------------------------------------------------------- the Guide and explain mode (explain.js)
    const { openGuide, startExplain, stopExplain, renderGuideTab } = createExplain({
        S, H, root, layer, library, render: () => render(),
        showMe: key => { showOnCanvas(SAMPLE, key); inspect(SAMPLE, key); },
    });

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
            renderGuideTab(main);
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

    // ---------------------------------------------------------------- the piece bar (hero-bar.js)
    // Built on first use: some of what it uses is defined further down this closure. The wrappers keep the names
    // callable from anywhere above, as the functions were.
    let heroBarView = null;
    const heroBar = () => (heroBarView ??= createHeroBar({
        H, S, chatGreetings, entryFolder, inspect, layer, library, linkable, main, modelOf, openGuide, openHeroTab,
        render: () => render(), root, saveSettings, settings, sortBy: () => sortBy(), tidyNow,
        canvas: () => heroCanvas,
    }));
    function barAct(...a) { return heroBar().barAct(...a); }
    function barApi(...a) { return heroBar().barApi(...a); }
    function barTap(...a) { return heroBar().barTap(...a); }
    function createEntry(...a) { return heroBar().createEntry(...a); }
    function dropPiece(...a) { return heroBar().dropPiece(...a); }
    function nodeOf(...a) { return heroBar().nodeOf(...a); }
    function openStrip(...a) { return heroBar().openStrip(...a); }
    function placePicker(...a) { return heroBar().placePicker(...a); }

    // ---------------------------------------------------------------- Preview (preview-view.js) and the entry panel (hero-panel.js)
    // Built lazily: some of what they use is defined further down this closure.
    let previewView = null;
    const preview = () => (previewView ??= createPreview({
        ctx, S, H, main, layer, library, settings, scan: deps.scan, render: () => render(), heroBook, need, loadingNote, entriesShown,
        buildBookModel, openHeroTab, showOnCanvas, inspect,
    }));
    const renderPreviewTab = () => preview().renderPreviewTab();
    let heroPanelView = null;
    const panelView = () => (heroPanelView ??= createHeroPanel({
        S, H, main, root, layer, library, settings, saveSettings, render: () => render(), canvas: () => heroCanvas,
        listShown: () => listShown(), deskSettings, deskColumns, createEntry, entriesShown, momentsOf, sortBy: () => sortBy(),
        entryFolder, chatGreetings, linkText, showOnCanvas, inspect, openHeroTab, bookPicker,
    }));
    const heroPanel = (book, data) => panelView().heroPanel(book, data);
    const panelState = () => panelView().panelState();

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

    // ---------------------------------------------------------------- the inspector (hero-inspector.js)
    // Built on first use: some of what it uses is defined further down this closure. The wrappers keep the names
    // callable from anywhere above, as the functions were.
    let heroInspView = null;
    const heroInsp = () => (heroInspView ??= createHeroInspector({
        H, S, chatStatus, ctx, dataSheet, deleteEntries, deskSettings, heroData, heroInspector, hooks, inspShown,
        layer, leave, library, linkable, main, modelOf, openGuide, openHeroTab, panelState, problemsOf,
        render: () => render(), saveSettings, settings, canvas: () => heroCanvas, isRenderQueued: () => renderQueued,
    }));
    function chatGreetings(...a) { return heroInsp().chatGreetings(...a); }
    function inspect(...a) { return heroInsp().inspect(...a); }
    function inspectorFor(...a) { return heroInsp().inspectorFor(...a); }
    function showOnCanvas(...a) { return heroInsp().showOnCanvas(...a); }

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

    // ---------------------------------------------------------------- menus (menus.js)
    // Built on first use: some of what they use is defined further down this closure. The wrappers keep the names
    // callable from anywhere above, as the functions were.
    let menusView = null;
    const menus = () => (menusView ??= createMenus({
        H, S, back, check, deleteBooks, deleteEntries, deskSettings, entryFolder, heroMenu, inspect, layer, leave, library, main, modeButton, modelOf, openIn, page, render: () => render(), saveSettings, settings, showOnCanvas, snapshots, sortBy, tab, toggle, visibleNames,
    }));
    function bookFolderSheet(...a) { return menus().bookFolderSheet(...a); }
    function bookMenu(...a) { return menus().bookMenu(...a); }
    function duplicateBook(...a) { return menus().duplicateBook(...a); }
    function entryMenu(...a) { return menus().entryMenu(...a); }
    function folderSheet(...a) { return menus().folderSheet(...a); }
    function linksSheet(...a) { return menus().linksSheet(...a); }
    function moveToBookSheet(...a) { return menus().moveToBookSheet(...a); }
    function newEntryFolder(...a) { return menus().newEntryFolder(...a); }
    function openMenu(...a) { return menus().openMenu(...a); }
    function problemsSheet(...a) { return menus().problemsSheet(...a); }
    function renameBook(...a) { return menus().renameBook(...a); }
    function snapshotsSheet(...a) { return menus().snapshotsSheet(...a); }
    function switchRow(...a) { return menus().switchRow(...a); }
    function wiSettingsSheet(...a) { return menus().wiSettingsSheet(...a); }

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

