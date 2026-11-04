// The WI Hero editor: one element on document.body (BUILD_SPEC 8.1) that ST's World Info button opens instead of
// ST's drawer. Closing only hides it; after a reload it starts on Home (D6). N2 builds the shared chrome and normal
// mode (LAYOUT "Shared" and "Normal mode"). Its own styles live in a shadow root, so ST's CSS and WI Hero's can't
// clash; ST's theme variables still come through.
import { buildModel } from '../engine/model.js';
import { btn, createLayer, el, longPress, pressable, swEl } from './dom.js';
import { ic } from './icons.js';
import {
    MIXED, PARAM_LIST, addEntry, bookFolderOf, bookSettings, cardKey, commonValue, configOf, copyBookSettings,
    deleteBookSettings, duplicateEntry, entriesOf, entryAsText, folderOf, groupEntries, SORT_NAMES, sortEntries, idOf, isBlank, moveEntry,
    paramSummary, paramText, paramValue, rekeyEntry, renameBookSettings, search, setBookFolder, setFolder, setParam,
    strategyOf, titleOf,
} from './data.js';
import { editParam, paramRow, renderEntryPage, strategyColor } from './entry-page.js';
import { closedText, logicLines } from './logic-text.js';
import { IMPORTED, defaultSnapshotName } from './snapshots.js';
import { PORT, buildGraph, canvasBook, canvasSet } from './canvas-graph.js';
import { canvasMemory, mountCanvas } from './canvas.js';
import { entryStatus } from '../engine/turn.js';
import { getStringHash, isObject } from '../engine/util.js';
import { greetingFingerprint, greetingsOf, openingGreeting } from '../chat-state.js';
import { bookEditor, greetingName, greetingRules, packsOf } from './pieces.js';
import { renderGreetingInspector, renderInspector } from './inspector.js';
import { editExisting, mountPieceBar, startPiece } from './piecebar.js';
import { runPreview } from './preview.js';
import { renderPreviewPage } from './preview-page.js';

const COLOR_MODES = [['standard', 'Standard'], ['red-green', 'Red-green safe'], ['blue-yellow', 'Blue-yellow safe']];

/**
 * @param {object} deps
 *   { ctx, library, snapshots, hooks, settings, saveSettings, entryTemplate, cssUrl, openStEditor(), onVisible(open) }
 */
export function createApp(deps) {
    const { ctx, library, snapshots, hooks, settings, saveSettings } = deps;

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
        hero: { book: null, tabs: [], active: 'canvas', panel: false, q: '', legend: false, chatState: false, closedFolders: new Set(), insp: null, pv: null, bar: { armed: null, edit: null } },
    };
    const tab = () => S.tabs.find(t => t.id === S.active) ?? S.tabs[0];
    const page = (t = tab()) => t.history.at(-1);

    // ---------------------------------------------------------------- helpers
    const visibleNames = () => library.names().filter(n => !S.hiddenBooks.has(n));
    const hiddenIn = book => S.hiddenEntries.get(book) ?? new Set();
    const entriesShown = (book, data) => entriesOf(data).filter(e => !hiddenIn(book).has(e.uid));
    const modelOf = (book, data) => buildModel(entriesOf(data).map(e => ({ ...e, world: book })));
    const problemsOf = (model, uid, book) => model.issues.filter(i => i.stKey === `${book}.${uid}` && !i.warning && i.blocking !== false);
    const linkText = name => { const l = library.links(name); return l.length ? `${l[0].name}${l.length > 1 ? ` +${l.length - 1}` : ''}` : ''; };
    const entryFolder = (book, e) => folderOf(settings, book, e);

    /**
     * Loads a book, then redraws once it is in. One redraw per book, however many draws asked for it while it
     * loaded (each draw used to add its own, and a list of books snowballed into thousands of redraws).
     * A page that opens a book also asks for its As imported copy (library.seen).
     */
    const waiting = new Set();
    function need(book, { open = true } = {}) {
        const data = library.peek(book);
        if (data) { if (open) library.seen(book); return data; }
        if (!waiting.has(book)) {
            waiting.add(book);
            library.get(book).then(d => { waiting.delete(book); if (d) scheduleRender(); }, () => waiting.delete(book));
        }
        return null;
    }

    /**
     * Home's entry counts: books load in the background, a few at a time, and each count is written into its row
     * as it comes in. Nothing is redrawn, so the list scrolls and taps while books are still loading.
     */
    const counting = [];
    let countsRunning = 0;
    const countSpans = new Map(); // book → the span showing its count now
    function countInto(name, span) {
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
                if (d && span?.isConnected) span.textContent = `${entriesShown(name, d).length} entries`;
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
    root.addEventListener('focusout', () => setTimeout(() => { if (pendingRender && !typing()) render(); }, 0));

    function render() {
        pendingRender = false;
        root.dataset.colors = settings.colorMode ?? 'standard';
        root.style.setProperty('--content-font', settings.contentFont === 'sans' ? 'var(--sans)' : 'var(--serif)');
        root.dataset.mode = S.mode;
        if (S.mode === 'hero') { renderHero(); return; }
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

    function pageTitle(p) {
        if (p.type === 'home') return 'Home';
        if (p.type === 'book') return p.book;
        const e = library.peek(p.book)?.entries[p.uid];
        return e ? (e.comment || 'New entry') : 'Entry';
    }

    function renderTabs() {
        strip.innerHTML = '';
        if (S.mode === 'hero') { renderHeroTabs(); return; }
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
            library.change(p.book, d => { delete d.entries[p.uid]; }, { quiet: true });
            layer.toast('Empty entry removed');
        }
    }

    /** Opens a page: from Home's tab (or with `newTab`) in a new tab, otherwise in this tab's history. */
    function openIn(p, { newTab = false, background = false } = {}) {
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
        library.flush();
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
        if (global) m.append(el('span', 'badge g', 'Global'));
        if (lt) { const l = el('span', 'badge l'); l.innerHTML = ic('chain', 's'); l.append(lt); m.append(l); }
        if (!global && !lt) m.append(el('span', 'badge o', 'Off'));
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
        if (!data) { v.append(el('div', 'empty-note', 'Loading…')); return; }
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
            const g = btn(`chip2${global ? ' on' : ''}`, '<i class="dot"></i><span>Global</span>', () => {
                library.setGlobal(book, !global);
                layer.toast(!global ? `${book} is active everywhere` : `${book} is no longer global`);
                render();
            }, 'Active globally');
            g.setAttribute('aria-pressed', String(global));
            const lk = btn('chip2', `${ic('chain', 's')}<span></span>`, () => linksSheet(book), 'Links');
            lk.querySelector('span').textContent = linkText(book) || 'Not linked';
            chips.append(g, lk);
            v.append(chips);
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
        const i = el('div', 'ic');
        i.innerHTML = ic('entry');
        const tx = el('div', 'txt');
        const t = el('div', 't');
        t.append(el('span', 'nm', titleOf(e)));
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
        const b = btn(open ? 'open' : '', `${ic('right')}<span></span>`, onToggle);
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
        bb.append(btn('', ic('plus'), () => (p.type === 'book' ? newEntry(p.book) : newBook()), p.type === 'book' ? 'New entry' : 'New book'));
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
        const act = (icon, label, fn) => { const b = btn('', `${ic(icon)}<span>${label}</span>`, fn); b.disabled = !S.select.size; bar.append(b); };
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
    function renderEntry(p, nav = null) {
        const data = need(p.book);
        if (!data) { const v = el('div', 'view'); v.append(el('div', 'empty-note', library.names().includes(p.book) ? 'Loading…' : 'This book was deleted or renamed.')); main.append(v); return; }
        const e = data.entries[p.uid];
        if (!e || hiddenIn(p.book).has(p.uid)) { const v = el('div', 'view'); v.append(el('div', 'empty-note', 'This entry was deleted.')); main.append(v); return; }
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
        renderEntryPage(main, {
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

    function newBook() {
        layer.askText({
            title: 'New book', placeholder: 'Book name', ok: 'Create', check: n => library.nameProblem(n),
            done: async n => {
                const name = await library.create(n);
                openIn({ type: 'book', book: name }, { newTab: true });
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
                        delete d.entries[u];
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
            if (active && onClose) {
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
        H.tabs.forEach((t, i) => {
            const e = library.peek(t.book)?.entries[t.uid];
            mk(e ? (e.comment || 'New entry') : 'Entry', H.active === i, () => { if (H.active !== i) { H.active = i; render(); } }, () => closeHeroTab(i), { dot: e ? strategyColor(e) : null });
        });
        revealActiveTab();
    }

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
        if (H.active === 'preview') {
            if (H.pv?.page) H.pv.page = null;
            else H.active = 'canvas';
            render();
            return true;
        }
        hide();
        return false;
    }

    function renderHero() {
        renderTabs();
        main.innerHTML = '';
        heroCanvas = null;
        if (typeof H.active === 'number' && !H.tabs[H.active]) H.active = 'canvas';
        if (typeof H.active === 'number') {
            const t = H.tabs[H.active];
            main.dataset.page = `hero:${H.active}`;
            renderEntry({ type: 'entry', book: t.book, uid: t.uid }, { up: () => closeHeroTab(H.active), go: uid => { t.uid = uid; t.mask = null; render(); }, tab: t });
            return;
        }
        if (H.active === 'preview') { renderPreviewTab(); return; }
        main.dataset.page = 'hero:canvas';
        const book = heroBook();
        if (!book) { const v = el('div', 'view'); v.append(el('div', 'empty-note', 'No books yet. Switch to Normal mode to make one.')); main.append(v); return; }
        const data = need(book);
        if (!data) { const v = el('div', 'view'); v.append(el('div', 'empty-note', 'Loading…')); main.append(v); return; }

        const vp = el('div', 'vp');
        vp.tabIndex = -1;
        main.append(vp);
        if (H.legend) {
            const lg = el('div', 'legend');
            for (const [v, label, dashed] of [['open', 'opens'], ['close', 'closes', true], ['glue', 'glue'], ['mask', 'mask'], ['pack', 'pack', true]]) {
                const s = el('span');
                s.style.color = `var(--p-${v})`;
                s.append(el('i', dashed ? 'd' : ''), label);
                lg.append(s);
            }
            vp.append(lg);
        }
        let cache = null;
        heroCanvas = mountCanvas(vp, {
            book: () => (cache ??= heroData(book, data)),
            save: saveSettings,
            open: (key, piece) => inspect(book, key, piece),
            pack: name => packSheet(book, data, name),
            toast: text => layer.toast(text),
            holdEmpty: at => placePicker(book, data, at),
            tapTarget: hit => barTap(book, hit),
            tapEmpty: () => {
                if (H.panel) { H.panel = false; panelState(); }
                if (H.insp) { H.insp = null; main.querySelector('.insp')?.remove(); }
            },
        });
        heroCanvas.render();
        heroPanel(book, data);
        if (H.bar.edit && H.bar.edit.book !== book) H.bar.edit = null;
        mountPieceBar(barApi(book));
        if (H.insp?.book === book) inspectorFor(book, data);
    }

    // ---------------------------------------------------------------- the piece bar (LAYOUT "Piece bar")
    /** A card key as the bar sees it: an entry by uid, a pack, or a greeting. */
    function nodeOf(book, key) {
        const data = library.peek(book);
        if (!data || !key) return null;
        if (key.startsWith('pack:')) return { t: 'pack', name: key.slice(5) };
        if (key.startsWith('greet:')) { const g = chatGreetings(data).find(x => x.key === key); return g ? { t: 'greet', ref: g.ref } : null; }
        const e = entriesOf(data).find(x => cardKey(x) === key);
        return e ? { t: 'entry', uid: e.uid } : null;
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
            B: H.bar, main, root, canvas: heroCanvas, layer,
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
                const out = sortEntries(entriesShown(book, d), sortBy()).map(e => ({ key: cardKey(e), end: { t: 'entry', uid: e.uid }, title: titleOf(e) }));
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
        };
    }

    function dropPiece(book, k, hit) {
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
            if (!hit) { render(); return false; }
            dropPiece(book, k, hit);
            return true;
        }
        if (hit?.link || hit?.cond) {
            const edit = editExisting(hit, x);
            if (edit) { openStrip(book, edit); return true; }
        }
        if (hit?.row) { inspect(book, hit.row.key, PORT[hit.row.port].piece); return true; }
        return false;
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
        layer.sheet('Place here', sh => {
            const q = el('input', 'pick-q');
            q.placeholder = 'Search entries';
            q.setAttribute('aria-label', 'Search entries');
            const list = el('div');
            const fill = () => {
                list.replaceChildren();
                const needle = q.value.trim().toLowerCase();
                const free = sortEntries(entriesShown(book, data), sortBy()).filter(e => !on.has(cardKey(e)) && (!needle || titleOf(e).toLowerCase().includes(needle)));
                for (const e of free.slice(0, 60)) list.append(layer.opt(titleOf(e), () => { layer.close(); place(cardKey(e), titleOf(e)); }, { dot: strategyColor(e), sub: entryFolder(book, e) || undefined }));
                if (!free.length) list.append(el('p', 'help', needle ? 'Nothing matches.' : 'Every entry is on the canvas already.'));
            };
            q.addEventListener('input', fill);
            sh.append(q, layer.opt('New entry here', () => layer.askText({
                title: 'New entry', placeholder: 'Entry name', ok: 'Create',
                done: name => { const x = createEntry(book, name); place(cardKey(x), name); },
            }), { icon: 'plus' }), list);
            fill();
        }, { help: 'Entries that aren\'t on the canvas yet.' });
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
        if (!data) { const v = el('div', 'view'); v.append(el('div', 'empty-note', 'Loading…')); main.append(v); return; }
        const seeds = previewSeeds();
        let seed = seeds.find(x => x.id === H.pv?.seed);
        if (!seed) { seed = seeds[0]; seedPreview(seed); }
        const shown = entriesShown(book, data);
        const entries = shown.map(e => ({ ...e, world: book }));
        const model = buildModel(entries);
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
        });
    }

    // The entry panel (LAYOUT "Entry panel"): every entry of the book, a dot that places it on the canvas or finds it.
    let panelState = () => {};
    function heroPanel(book, data) {
        const pb = btn('panelBtn', ic('panel'), () => { H.panel = !H.panel; panelState(); }, 'Entries');
        const p = el('aside', 'panel');
        main.append(pb, p);
        panelState = () => {
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
                dot.setPointerCapture?.(ev.pointerId);
            });
            dot.addEventListener('pointermove', ev => {
                if (!start) return;
                if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 8) return;
                if (!ghost) {
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
                const hd = btn(`phdr${open ? ' open' : ''}`, `${ic('right')}<span>Greetings</span><small></small>`, () => { open ? H.closedFolders.add('\u0000greetings') : H.closedFolders.delete('\u0000greetings'); fill(); });
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
                        const gd = btn(`dotc${placed ? ' in' : ''}`, '<i></i>', ev => {
                            ev.stopPropagation();
                            if (dragged(ev)) return;
                            if (!placed) { canvasMemory(bookSettings(settings, book)).cards[g.key] = { placed: true }; saveSettings(); }
                            showOnCanvas(book, g.key);
                        }, placed ? `Show ${g.title} on the canvas` : `Place ${g.title} on the canvas`);
                        dotDrag(gd, g.key, g.title);
                        r.append(gd);
                        r.addEventListener('click', () => inspect(book, g.key));
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
                    const hd = btn(`phdr${open ? ' open' : ''}`, `${ic('right')}<span></span><small></small>`, () => { open ? H.closedFolders.add(f) : H.closedFolders.delete(f); fill(); });
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
                    const d = btn(`dotc${placed ? ' in' : ''}`, '<i></i>', ev => { ev.stopPropagation(); if (!dragged(ev)) place(); },
                        placed ? `Show ${titleOf(e)} on the canvas` : `Place ${titleOf(e)} on the canvas`);
                    dotDrag(d, key, titleOf(e));
                    r.append(d);
                    pressable(r, () => openHeroTab(book, e.uid), () => layer.sheet(titleOf(e), sh => {
                        sh.append(layer.opt('Open entry', () => { layer.close(); openHeroTab(book, e.uid); }, { icon: 'tab' }));
                        sh.append(layer.opt(placed ? 'Show on canvas' : 'Place on canvas', () => { layer.close(); place(); }, { icon: 'canvas' }));
                        if (placed) sh.append(layer.opt('Inspect', () => { layer.close(); inspect(book, key); }, { icon: 'eye' }));
                    }, { help: 'Or drag its dot onto the canvas to place it where you drop it.' }));
                    box.append(r);
                }
            }
        };
        fill();
        const br = el('div', 'bookrow');
        const bp = btn('bookpick', `<b><span></span>${ic('down', 's')}</b><span class="bchips"></span>`, () => bookPicker(), 'Switch book');
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
                sh.append(layer.opt(n, () => { layer.close(); H.book = n; H.active = 'canvas'; H.panel = false; render(); }, { cur: n === H.book, icon: 'book', val: library.isGlobal(n) ? 'Global' : linkText(n) || undefined }));
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
    function inspect(book, key, piece = null) {
        const data = library.peek(book);
        let open = null;
        if (piece && data && !key.startsWith('greet:')) {
            const e = entriesOf(data).find(x => cardKey(x) === key);
            const c = e ? configOf(e) ?? {} : {};
            const has = piece === 'masks' ? Array.isArray(c.masks) && c.masks.length : piece === 'glue' ? isObject(c.glue) : Array.isArray(c[piece]) && c[piece].length;
            if (has) open = piece;
        }
        const keep = H.insp?.key === key ? H.insp : null;
        H.insp = { book, key, open, full: keep?.full ?? false, scroll: 0 };
        H.panel = false;
        if (S.mode !== 'hero' || H.active !== 'canvas' || H.book !== book) { S.mode = 'hero'; H.active = 'canvas'; H.book = book; }
        else if (heroCanvas && data && main.dataset.page === 'hero:canvas' && !renderQueued) {
            // Already on this canvas: only the inspector changes, so leave the cards and links as they are.
            panelState();
            main.querySelector('.insp')?.remove();
            inspectorFor(book, data);
            heroCanvas.reveal(key, 0.5);
            return;
        }
        render();
        heroCanvas?.reveal?.(key, 0.5);
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

    function inspectorFor(book, data) {
        const I = H.insp;
        const view = heroCanvas?.view;
        const shown = entriesShown(book, data);
        const others = except => shown.filter(x => x.uid !== except).map(x => ({ uid: x.uid, title: titleOf(x), dot: strategyColor(x) }));
        const nameOfId = id => { const x = entriesOf(data).find(y => idOf(y) === id); return x ? titleOf(x) : id; };
        const common = {
            layer, full: I.full, scroll: I.scroll, nameOfId, packs: packsOf(data),
            setFull: v => { I.full = v; render(); },
            onScroll: v => { I.scroll = v; },
            close: () => { H.insp = null; render(); },
            inspect: key => inspect(book, key),
            edit: fn => editBook(book, fn),
        };
        if (I.key.startsWith('greet:')) {
            const g = chatGreetings(data).find(x => x.key === I.key);
            if (!g) { H.insp = null; return; }
            const r = greetingRules(data, g.ref);
            const byUid = uid => entriesOf(data).find(x => x.uid === uid);
            const usedBy = r.usedBy.map(byUid).filter(Boolean);
            const gwhy = [];
            if (r.gatesFor.length || r.closesFor.length) gwhy.push('Remove its Gates for and Closes for (above).');
            if (usedBy.length) gwhy.push(`Remove the pieces in other entries that point at it: ${[...new Set(usedBy.map(titleOf))].join(', ')}.`);
            renderGreetingInspector(main, {
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
        renderInspector(main, {
            ...common, entry: e, config: configOf(e) ?? {}, title: titleOf(e), open: I.open, lines, sources,
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
        const b = btn('modebtn', `${ic(S.mode === 'hero' ? 'entry' : 'canvas')}<span>Switch to ${target}</span>`, () => {
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
                if (issues.length) sh.append(layer.opt(`Problems (${issues.length})`, () => problemsSheet(book), { val: '›', cls: 'probs' }));
            }
            sh.append(layer.opt('Snapshots', () => snapshotsSheet(book), { val: '›' }));
        }
        sh.append(el('div', 'lbl', 'Canvas'));
        sh.append(layer.opt('Tidy layout', () => {
            layer.close();
            if (H.active !== 'canvas') { H.active = 'canvas'; render(); }
            const undo = heroCanvas?.tidy();
            if (undo) layer.toast('Tidied', { action: ['Undo', () => { undo(); layer.toast('Layout put back'); }] });
        }, { icon: 'tidy' }));
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

    function newTab() {
        const t = { id: ++tabUid, history: [{ type: 'home' }], fresh: true };
        S.tabs.push(t);
        leave();
        S.active = t.id;
        S.select = null;
        render();
    }

    // Pulling the tab row left past its end opens a new tab (Normal mode): a + grows at the right, under the finger.
    {
        const pull = el('div', 'pullnew');
        pull.innerHTML = ic('plus');
        tabbar.append(pull);
        const atEnd = () => strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
        let x0 = null;
        const show = w => { pull.style.width = `${w}px`; pull.classList.toggle('ready', w >= 64); };
        strip.addEventListener('touchstart', e => { x0 = S.mode === 'normal' && !S.select && atEnd() ? e.touches[0].clientX : null; }, { passive: true });
        strip.addEventListener('touchmove', e => {
            if (x0 === null) return;
            const dx = x0 - e.touches[0].clientX;
            if (!atEnd() || dx <= 0) { show(0); return; }
            show(Math.min(dx * 0.6, 80));
        }, { passive: true });
        strip.addEventListener('touchend', () => {
            const go = x0 !== null && pull.classList.contains('ready');
            x0 = null;
            show(0);
            if (go) newTab();
        });
        strip.addEventListener('touchcancel', () => { x0 = null; show(0); });
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
            } else if (p.type === 'book') {
                const data = library.peek(p.book);
                sh.append(el('div', 'lbl', 'View'));
                choiceRow(sh, 'Sort by', Object.entries(SORT_NAMES), sortBy(), k => { settings.sortBy = k; saveSettings(); render(); });
                switchRow(sh, 'Show disabled entries', S.showOff, v => { S.showOff = v; render(); });
                if (data) {
                    const issues = modelOf(p.book, data).issues;
                    if (issues.length) sh.append(layer.opt(`Problems (${issues.length})`, () => problemsSheet(p.book), { val: '›', cls: 'probs' }));
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
            if (S.mode !== 'hero') sh.append(layer.opt('New tab', () => { layer.close(); newTab(); }, { icon: 'tab' }));
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
        layer.sheet(`Problems (${issues.length})`, sh => {
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
                sh.append(layer.opt('New folder…', () => layer.askText({
                    title: 'New folder', placeholder: 'Folder name (Places/Town for one inside another)', ok: 'Create',
                    done: f => {
                        const b = bookSettings(settings, book);
                        b.folderList = [...new Set([...(b.folderList ?? []), f.split('/').map(x => x.trim()).filter(Boolean).join('/')])];
                        saveSettings();
                        render();
                    },
                }), { icon: 'folder' }));
            }
            if (fromHome) sh.append(layer.opt('Open in new tab', () => { layer.close(); openIn({ type: 'book', book }, { newTab: true }); }, { icon: 'tab' }));
            sh.append(layer.opt('Rename', () => layer.askText({
                title: 'Rename book', placeholder: 'Book name', value: book, check: n => library.nameProblem(n, book),
                done: async n => {
                    if (n === book) return;
                    try {
                        const to = await library.rename(book, n);
                        renameBookSettings(settings, book, to);
                        saveSettings();
                        for (const t of S.tabs) for (const p of t.history) if (p.book === book) p.book = to;
                        render();
                        layer.toast(`Renamed to ${to}`);
                    } catch (e) { layer.toast(e.message); }
                },
            }), { icon: 'edit' }));
            if (fromPage) {
                sh.append(layer.opt('Duplicate', async () => {
                    layer.close();
                    const to = await library.duplicate(book);
                    copyBookSettings(settings, book, to);
                    saveSettings();
                    openIn({ type: 'book', book: to }, { newTab: true });
                    layer.toast(`Made ${to}`);
                }, { icon: 'copy' }));
            }
            sh.append(layer.opt('Move to folder', () => bookFolderSheet(f => { setBookFolder(settings, book, f); saveSettings(); render(); }), { icon: 'move', val: bookFolderOf(settings, book) || 'No folder' }));
            sh.append(layer.opt('Export', () => { layer.close(); library.exportBook(book); layer.toast(`${book}.json exported`); }, { icon: 'code' }));
            sh.append(layer.opt('Snapshots', () => snapshotsSheet(book), { icon: 'snap', val: '›' }));
            sh.append(layer.opt('Delete', () => { layer.close(); deleteBooks([book]); }, { icon: 'trash', danger: true }));
        });
    }

    function entryMenu(book, uid, { onPage = false, heroTab = null } = {}) {
        const ht = heroTab ? H.tabs[H.active] : null;
        const data = library.peek(book);
        const e = data?.entries[uid];
        if (!e) return;
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

    return {
        show, hide, toggle, isOpen, refresh, host, back, openBook,
        /** For the in-ST checks. */
        get state() { return S; },
    };
}

