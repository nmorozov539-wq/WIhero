// The WI Hero editor: one element on document.body (BUILD_SPEC 8.1) that ST's World Info button opens instead of
// ST's drawer. Closing only hides it; after a reload it starts on Home (D6). N2 builds the shared chrome and normal
// mode (LAYOUT "Shared" and "Normal mode"). Its own styles live in a shadow root, so ST's CSS and WI Hero's can't
// clash; ST's theme variables still come through.
import { createHistory, withHistory } from './history.js';
import { buildModel, isMoment } from '../engine/model.js';
import { btn, html, createLayer, el, issueText } from './dom.js';
import { ic } from './icons.js';
import {
    PARAM_LIST, addEntry, copyBookSettings, filterChoices, bookSettings, cardKey, configOf, deleteBookSettings, entriesOf, folderOf,
    SORT_NAMES, isBlank, removeEntry, reorderEntries, search, setFolder, setParam, titleOf,
} from './data.js';
import { strategyColor } from './entry-page.js';
import { canvasBook } from './canvas-graph.js';
import { canvasMemory } from './canvas.js';
import { bookEditor, packsOf, renamePack } from './pieces.js';
import { getStringHash } from '../engine/util.js';
import { greetingFpOf, greetingSignature } from '../chat-state.js';
import { createPreview } from './preview-view.js';
import { createHeroPanel } from './hero-panel.js';
import { createMenus } from './menus.js';
import { createHeroShell } from './hero-shell.js';
import { createHeroDesk } from './hero-desk.js';
import { createNormal } from './normal.js';
import { createHeroBar } from './hero-bar.js';
import { createHeroInspector } from './hero-inspector.js';
import { SAMPLE, createExplain } from './explain.js';
import { deskNormal } from './desk.js';

/** "light" when the theme's text is dark (a light theme), so the piece colors can deepen (VISUAL 2). */
function toneOf(root) {
    const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/.exec(getComputedStyle(root).color);
    if (!m) return 'dark';
    const [r, g, b] = m.slice(1, 4).map(Number);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b < 128 ? 'light' : 'dark';
}

/**
 * @param {object} deps
 *   { ctx, library, snapshots, hooks, settings, saveSettings, entryTemplate, cssUrl, openStEditor(), onVisible(open) }
 */
export function createApp(deps) {
    const { ctx, snapshots, hooks, settings, saveSettings } = deps;
    // Undo history (history.js): every change through the library is looked at; Ctrl+Z, Ctrl+Shift+Z and the
    // canvas's arrows step through it.
    const undoHistory = createHistory({ library: deps.library, settings, saveSettings, held: () => !!S.hero.bar.edit });
    const library = withHistory(deps.library, undoHistory);
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
    const menuBtn = btn('iconbtn', ic('menu'), () => openMenu(), 'Menu');
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
        const z = e.key.toLowerCase();
        // Undo and redo: also when a click left the focus on the page itself (a list redrawn under it).
        if ((e.ctrlKey || e.metaKey) && !e.altKey && (z === 'z' || z === 'y') && !typing() && !layer.isOpen()
            && (inside || document.activeElement === document.body)) {
            if (historyStep(z === 'y' || e.shiftKey)) { e.preventDefault(); e.stopPropagation(); }
            return;
        }
        if (!inside && !ctrlK) return;
        const took = S.mode === 'hero' ? heroKey(e) : deskN.key(e);
        if (took) { e.preventDefault(); e.stopPropagation(); }
    }, true);
    window.addEventListener('keydown', e => {
        if (e.key !== 'Escape' || host.hidden || e.defaultPrevented) return;
        if (document.querySelector('.popup[open], dialog[open]')) return; // an ST popup over everything
        if (e.composedPath()[0]?.dataset?.ownEscape) return; // a field that cancels its own edit with Escape
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
    /**
     * Whether an entry has story logic, its own or put on it by other entries (a switch's paths, Closes for,
     * Gates for): the list's teal dot.
     */
    const hasLogic = (e, node) => {
        const c = configOf(e);
        return (!!c && Object.keys(c).some(k => k !== 'id')) || !!(node && (node.closes.length || node.opens.all.length));
    };
    /** An entry's warnings and non-blocking notes, for the entry page and the inspector (problemsOf has the rest). */
    const warningsOf = (model, uid, book) => model.issues.filter(i => i.stKey === `${book}.${uid}` && (i.warning || i.blocking === false));
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

    /** The book on screen: Hero's, or the page's in Normal mode. */
    const currentBook = () => (S.mode === 'hero' ? S.hero.book : page()?.book) ?? null;
    /** Undo or redo one step on the book on screen. Returns false when there is no book (the key isn't ours). */
    function historyStep(redo = false) {
        const book = currentBook();
        if (!book || !library.peek(book)) return false;
        if (S.hero.bar.edit) { layer.toast('Finish the piece first: Done or Cancel'); return true; }
        const ok = redo ? undoHistory.redo(book) : undoHistory.undo(book);
        if (ok) render();
        layer.toast(ok ? (redo ? 'Redone' : 'Undone') : (redo ? 'Nothing to redo' : 'Nothing to undo'));
        return true;
    }

    function render() {
        pendingRender = false;
        undoHistory.touch(currentBook(), { redraw: true });
        root.dataset.colors = settings.colorMode ?? 'standard';
        root.dataset.tone = toneOf(root);
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

    // ---------------------------------------------------------------- Normal mode's views (normal.js)
    // Built on first use: some of what they use is defined further down this closure. The wrappers keep the names
    // callable from anywhere above, as the functions were.
    let normalView = null;
    const normal = () => (normalView ??= createNormal({
        H, S, back, bookFolderSheet, bookMenu, countInto, ctx, dataSheet, deleteBooks, deleteEntries, entriesShown,
        entryFolder, entryMenu, folderSheet, hiddenIn, homePlus, hooks, importBook, layer, leave, library, linkText,
        linksSheet, loadingNote, main, modelOf, need, newEntry, newEntryFolder, offHint, openIn, page, problemsOf, warningsOf, hasLogic,
        render: () => render(), renderTabs, saveSettings, settings, shadow, showOnCanvas, sortBy: () => sortBy(),
        switchMode, tab, up, visibleNames, wiSettingsSheet,
    }));
    function applyParam(...a) { return normal().applyParam(...a); }
    function bottomBar(...a) { return normal().bottomBar(...a); }
    function check(...a) { return normal().check(...a); }
    function renderBook(...a) { return normal().renderBook(...a); }
    function renderEntry(...a) { return normal().renderEntry(...a); }
    function renderHome(...a) { return normal().renderHome(...a); }
    function renderSearch(...a) { return normal().renderSearch(...a); }
    function selBar(...a) { return normal().selBar(...a); }
    function defaultsSheet(...a) { return normal().defaultsSheet(...a); }
    function defaultsSummary(...a) { return normal().defaultsSummary(...a); }

    // ---------------------------------------------------------------- creating
    /** A new entry, opened at once. `after`: placed right below that entry in the list. */
    function newEntry(book, folder = '', after = null) {
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
        if (after != null) library.change(book, d => { reorderEntries(d, [entry.uid], after, true); }, { quiet: true });
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

    // ---------------------------------------------------------------- Hero mode (N3): its shell (hero-shell.js)
    const H = S.hero;
    // Built on first use: some of what it uses is defined further down this closure. The wrappers keep the names
    // callable from anywhere above, as the functions were.
    let heroShellView = null;
    const heroShell = () => (heroShellView ??= createHeroShell({
        H, S, barApi, barTap, barShaping, barShapeSet, bookPicker, chatGreetings, ctx, deskCanvas, deskColumns, deskSettings, entryFolder,
        heroBackDesk, heroInspector, heroPanel, hiddenIn, hide, hooks, inspect, inspectorFor, layer, library,
        loadingNote, lassoFor, main, modelOf, need, packSheet, renamePackAsk, panelState, placePicker, render: () => render(), renderEntry,
        renderGuideTab, renderPreviewTab, renderTabs, revealActiveTab, root, saveSettings, settings, showOnCanvas,
        startExplain, stopExplain, strip, switchMode, tabbar, visibleNames, desk: () => deskN, checkCounts, checksSheet, undoHistory, historyStep,
    }));
    function chatStatus(...a) { return heroShell().chatStatus(...a); }
    function heroBack(...a) { return heroShell().heroBack(...a); }
    function heroBook(...a) { return heroShell().heroBook(...a); }
    function heroData(...a) { return heroShell().heroData(...a); }
    function openHeroTab(...a) { return heroShell().openHeroTab(...a); }
    function renderHero(...a) { return heroShell().renderHero(...a); }
    function renderHeroTabs(...a) { return heroShell().renderHeroTabs(...a); }
    function closeHeroTab(...a) { return heroShell().closeHeroTab(...a); }
    /** The mounted Hero canvas, or null (hero-shell.js owns it). */
    const heroCanvas = () => heroShellView?.canvas() ?? null;

    // ---------------------------------------------------------------- the Guide and explain mode (explain.js)
    const { openGuide, startExplain, stopExplain, renderGuideTab } = createExplain({
        S, H, root, layer, library, render: () => render(),
        showMe: key => { showOnCanvas(SAMPLE, key); inspect(SAMPLE, key); },
    });

    // ---------------------------------------------------------------- the piece bar (hero-bar.js)
    // Built on first use: some of what it uses is defined further down this closure. The wrappers keep the names
    // callable from anywhere above, as the functions were.
    let heroBarView = null;
    const heroBar = () => (heroBarView ??= createHeroBar({
        H, S, chatGreetings, entryFolder, inspect, layer, library, linkable, main, modelOf, openGuide, openHeroTab,
        render: () => render(), root, saveSettings, settings, sortBy: () => sortBy(), tidyNow,
        canvas: () => heroCanvas(), historyStep,
        entryTemplate: deps.entryTemplate,
    }));
    function barAct(...a) { return heroBar().barAct(...a); }
    function barApi(...a) { return heroBar().barApi(...a); }
    function barTap(...a) { return heroBar().barTap(...a); }
    function barShaping(...a) { return heroBar().shaping(...a); }
    function barShapeSet(...a) { return heroBar().shapeSet(...a); }
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
        S, H, main, root, layer, library, settings, saveSettings, render: () => render(), canvas: () => heroCanvas(),
        listShown: () => listShown(), deskSettings, deskColumns, createEntry, entriesShown, momentsOf, sortBy: () => sortBy(),
        entryFolder, chatGreetings, linkText, showOnCanvas, inspect, openHeroTab, bookPicker,
    }));
    const heroPanel = (book, data) => panelView().heroPanel(book, data);
    const panelState = () => panelView().panelState();

    function bookPicker() {
        layer.sheet('Switch book', sh => {
            const open = name => { H.book = name; H.active = 'canvas'; H.panel = false; H.insp = null; H.pick = []; render(); };
            // The actions sit on top as small icon buttons (#34); a long press (or hover) says what each does.
            const acts = el('div', 'pkacts');
            const act = (icon, label, fn) => {
                const b = btn('pkact', ic(icon), fn, label);
                b.title = label;
                b.addEventListener('contextmenu', e => { e.preventDefault(); layer.toast(label); });
                acts.append(b);
            };
            act('plus', 'New book', () => layer.askText({
                title: 'New book', placeholder: 'Book name', ok: 'Create', check: n => library.nameProblem(n),
                done: async n => {
                    try { open(await library.create(n)); } catch (e) { layer.toast(`Could not make ${n}: ${e.message}`); }
                },
            }));
            if (H.book) {
                act('copy', `Duplicate ${H.book}`, async () => {
                    layer.close();
                    const from = H.book;
                    let to;
                    try { to = await library.duplicate(from); } catch (e) { layer.toast(`Could not duplicate ${from}: ${e.message}`); return; }
                    copyBookSettings(settings, from, to);
                    saveSettings();
                    open(to);
                    layer.toast(`Made ${to}`);
                });
            }
            sh.append(acts);
            for (const n of visibleNames()) {
                sh.append(layer.opt(n, () => { layer.close(); open(n); }, { cur: n === H.book, icon: 'book', val: library.isGlobal(n) ? 'Global' : linkText(n) || undefined }));
            }
        });
    }

    /** Asks a pack's new name and renames it everywhere the book names it, and on the canvas (#21). */
    function renamePackAsk(book, from) {
        layer.askText({
            title: `Rename #${from}`, value: from, placeholder: 'Pack name (town/inn for one inside another)', ok: 'Rename',
            check: v => {
                const to = v.trim().replace(/^#/, '');
                if (!/^[A-Za-z0-9][A-Za-z0-9_.\-/]*$/.test(to)) return 'Letters, numbers, - _ . and / only';
                if (to !== from && packsOf(library.peek(book)).includes(to)) return `#${to} is already a pack`;
                return null;
            },
            done: v => {
                const to = v.trim().replace(/^#/, '');
                if (to === from) return;
                const mem = canvasMemory(bookSettings(settings, book));
                for (const k of Object.keys(mem.cards)) {
                    const name = k.startsWith('pack:') ? k.slice(5) : null;
                    if (name === from || name?.startsWith(`${from}/`)) { mem.cards[`pack:${to}${name.slice(from.length)}`] = mem.cards[k]; delete mem.cards[k]; }
                }
                saveSettings();
                if (library.change(book, d => renamePack(bookEditor(d), d, from, to))) layer.toast(`#${from} is now #${to}`);
            },
        });
    }

    function packSheet(book, data, name) {
        const m = canvasBook(data);
        const members = m.packMembers(name);
        const usesPack = rs => (rs ?? []).flat().some(r => r === `#${name}` || (typeof r === 'string' && r.startsWith(`#${name}:`)));
        const users = m.E.filter(e => usesPack(e.gate) || usesPack([e.gatesFor]) || usesPack(e.closeGate) || usesPack([e.closesFor]));
        layer.sheet(`#${name}`, sh => {
            sh.append(layer.opt('Rename', () => { layer.close(); renamePackAsk(book, name); }, { icon: 'edit' }));
            sh.append(el('div', 'lbl', 'In this pack'));
            for (const e of members) sh.append(layer.opt(e.title, () => { layer.close(); inspect(book, e.id); }, { dot: strategyColor(e.entry) }));
            if (users.length) {
                sh.append(el('div', 'lbl', 'Used by'));
                for (const e of users) sh.append(layer.opt(e.title, () => { layer.close(); inspect(book, e.id); }, { dot: strategyColor(e.entry) }));
            }
        }, { help: 'A pack is a tag. Rules can wait for any, all, or a number of its entries.' });
    }

    // ---------------------------------------------------------------- the inspector (hero-inspector.js)
    // Built on first use: some of what it uses is defined further down this closure. The wrappers keep the names
    // callable from anywhere above, as the functions were.
    let heroInspView = null;
    const heroInsp = () => (heroInspView ??= createHeroInspector({
        H, S, chatStatus, ctx, dataSheet, deleteEntries, deskSettings, heroData, heroInspector, hooks, inspShown,
        layer, leave, library, linkable, main, modelOf, openGuide, openHeroTab, panelState, problemsOf, warningsOf, hasLogic,
        render: () => render(), saveSettings, settings, canvas: () => heroCanvas(), isRenderQueued: () => renderQueued,
        dropPiece: (...a) => dropPiece(...a),
    }));
    function chatGreetings(...a) { return heroInsp().chatGreetings(...a); }
    function inspect(...a) { return heroInsp().inspect(...a); }
    function inspectorFor(...a) { return heroInsp().inspectorFor(...a); }
    function showOnCanvas(...a) { return heroInsp().showOnCanvas(...a); }

    /** The mode switch at the top of the ☰ menu: tap once to arm it, again to switch (LAYOUT "Modes"). */
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
                menus().checkRows(sh, book, data);
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
        // A trackpad pans with two fingers when the wheel scrolls; Ctrl+wheel and a pinch zoom either way.
        if (S.desk) {
            menus().choiceRow(sh, 'Mouse wheel', [['zoom', 'Zoom', 'Node-editor style: two fingers on a trackpad zoom'], ['scroll', 'Scroll', 'For a trackpad: two fingers pan, pinch or Ctrl+wheel zooms']],
                deskSettings().wheel === 'scroll' ? 'scroll' : 'zoom', k => { deskSettings().wheel = k; saveSettings(); });
        }
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
        H, S, back, check, defaultsSheet, defaultsSummary, deleteBooks, deleteEntries, deskSettings, entryFolder, heroMenu, hiddenIn, inspect, layer, leave, library, main, modeButton, modelOf, newEntry, openIn, page, render: () => render(), saveSettings, settings, showOnCanvas, snapshots, sortBy, tab, toggle, visibleNames,
    }));
    function bookFolderSheet(...a) { return menus().bookFolderSheet(...a); }
    function checkCounts(...a) { return menus().checkCounts(...a); }
    function checksSheet(...a) { return menus().checksSheet(...a); }
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

    // ---------------------------------------------------------------- Hero mode on desktop (hero-desk.js)
    // Built on first use: some of what it uses is defined further down this closure. The wrappers keep the names
    // callable from anywhere above, as the functions were.
    let heroDeskView = null;
    const heroDesk = () => (heroDeskView ??= createHeroDesk({
        H, S, barAct, barApi, chatGreetings, createEntry, dataSheet, deskSettings, dropPiece, entriesShown, entryFolder, hide,
        inspect, inspectorFor, layer, leave, library, main, modelOf, nodeOf, openHeroTab, openStrip, packSheet,
        placePicker, render: () => render(), saveSettings, settings, shadow, showOnCanvas, sortBy: () => sortBy(),
        startExplain, stopExplain, typing: () => typing(), canvas: () => heroCanvas(),
    }));
    function createEntryIn(...a) { return heroDesk().createEntryIn(...a); }
    function lassoFor(...a) { return heroDesk().lassoFor(...a); }
    function deskCanvas(...a) { return heroDesk().deskCanvas(...a); }
    function deskColumns(...a) { return heroDesk().deskColumns(...a); }
    function heroBackDesk(...a) { return heroDesk().heroBackDesk(...a); }
    function heroInspector(...a) { return heroDesk().heroInspector(...a); }
    function heroKey(...a) { return heroDesk().heroKey(...a); }
    function inspShown(...a) { return heroDesk().inspShown(...a); }
    function leaveEntry(...a) { return heroDesk().leaveEntry(...a); }
    function listShown(...a) { return heroDesk().listShown(...a); }
    function openHero(...a) { return heroDesk().openHero(...a); }
    function tidyNow(...a) { return heroDesk().tidyNow(...a); }

    const deskN = deskNormal({
        S, settings, library, layer, main, root, shadow,
        saveSettings: () => saveSettings(),
        tab, page, leave, render, renderTabs, closeTab, hide, need, loadingNote, modelOf, entriesShown, hiddenIn, entryFolder,
        problemsOf, warningsOf, linkText, countInto, sortBy, visibleNames, deleteBooks, deleteEntries, newBook, importBook, offHint, wiSettingsSheet,
        bookFolderSheet, folderSheet, snapshotsSheet, problemsSheet, renameBook, duplicateBook, newEntryFolder, openHero,
        createEntryIn, entryMenu, moveToBookSheet, applyParam, leaveEntry,
        hasLogic,
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

