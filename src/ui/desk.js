// Normal mode on desktop (LAYOUT "Desktop: normal mode"): the tab row with book and entry tabs, Home as tiles or
// a list, a book as two panes (its entries on the left, one entry, the bulk pane or Book settings on the right),
// Ctrl/Shift-click selection instead of a selection mode, the search overlay and the keys. Phones never get here.
// Everything it needs from the app comes in `A` (see app.js deskApi).
import { btn, el, swEl } from './dom.js';
import { ic } from './icons.js';
import {
    MIXED, PARAM_LIST, bookFolderOf, bookSettings, commonValue, duplicateEntry, entriesOf, groupEntries, paramValue, search,
    setBookFolder, setFolder, strategyOf, titleOf,
} from './data.js';
import { paramGrid, strategyColor } from './entry-page.js';

const LIST_W = { def: 270, min: 200, max: 460 };
const NARROW = 640;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dateText = t => {
    if (!t) return '';
    const d = new Date(t);
    const days = Math.floor((Date.now() - t) / 86400000);
    if (days < 1 && d.getDate() === new Date().getDate()) return 'today';
    if (days < 2) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
};

/** A drag handle on a column's edge: drag to resize between min and max, double-click to reset. */
export function resizer(get, set, { min, max, def, side = 'right', onEnd }) {
    const h = el('div', `colresize ${side}`);
    h.setAttribute('role', 'separator');
    h.setAttribute('aria-label', 'Drag to resize, double-click to reset');
    h.title = 'Drag to resize, double-click to reset';
    let x0 = null;
    let w0 = 0;
    h.addEventListener('pointerdown', e => { if (e.button) return; e.preventDefault(); x0 = e.clientX; w0 = get(); h.setPointerCapture(e.pointerId); h.classList.add('on'); });
    h.addEventListener('pointermove', e => {
        if (x0 === null) return;
        const dx = (e.clientX - x0) * (side === 'right' ? 1 : -1);
        set(Math.max(min, Math.min(max, Math.round(w0 + dx))), false);
    });
    const end = () => { if (x0 === null) return; x0 = null; h.classList.remove('on'); onEnd?.(); };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
    h.addEventListener('dblclick', () => { set(def, true); onEnd?.(); });
    return h;
}

export function deskNormal(A) {
    const { S, settings, library, layer, main } = A;
    const desk = () => (settings.desk ??= {});
    const save = () => A.saveSettings();

    // ---------------------------------------------------------------- tabs
    const pageOf = t => t.history.at(-1);
    const tabLabel = p => {
        if (p.type === 'home') return 'Home';
        if (p.type === 'book') return p.book;
        const e = library.peek(p.book)?.entries[p.uid];
        return e ? (e.comment || 'New entry') : 'Entry';
    };
    /** Opens a book in a tab: an empty (+) tab takes it, else a new tab next to this one. */
    function openBook(book, { sel = null, background = false, here = false } = {}) {
        const t = A.tab();
        const p = { type: 'book', book, sel, anchor: sel };
        if (here || t.fresh) { A.leave(); t.history = [p]; delete t.fresh; S.active = t.id; } else {
            const n = { id: A.nextTabId(), history: [p] };
            S.tabs.splice(S.tabs.indexOf(t) + 1, 0, n);
            if (background) { A.renderTabs(); layer.toast(`${book} opened in a background tab`); return; }
            S.active = n.id;
        }
        S.select = null;
        S.search = null;
        A.render();
    }
    /** An entry in its own tab (LAYOUT "Tab row"). */
    function openEntryTab(book, uid, { background = false } = {}) {
        const t = A.tab();
        const n = { id: A.nextTabId(), history: [{ type: 'entry', book, uid }] };
        S.tabs.splice(S.tabs.indexOf(t) + 1, 0, n);
        if (background) { A.renderTabs(); layer.toast('Opened in a background tab'); return; }
        S.active = n.id;
        S.search = null;
        A.render();
    }
    /** Shows an entry in the book tab it belongs to (opening one if needed), selected. */
    function showInBook(book, uid) {
        const t = S.tabs.find(x => !x.home && pageOf(x).type === 'book' && pageOf(x).book === book);
        if (t) { S.active = t.id; Object.assign(pageOf(t), { sel: uid, anchor: uid, pane: null, select: null, listOpen: false }); S.select = null; A.render(); return; }
        openBook(book, { sel: uid });
    }

    let dragTab = null;
    function renderTabs(strip, tabbar) {
        for (const t of S.tabs) {
            const p = pageOf(t);
            const active = t.id === S.active;
            const b = el('button', `tab${active ? ' active' : ''}${t.home ? ' fixed' : ''}`);
            b.type = 'button';
            b.dataset.tab = t.id;
            if (t.home) {
                b.innerHTML = ic('home');
                b.setAttribute('aria-label', 'Home');
                b.title = 'Home';
            } else {
                if (p.type === 'entry') {
                    const e = library.peek(p.book)?.entries[p.uid];
                    if (e) { const d = el('i', 'sd'); d.style.background = strategyColor(e); b.append(d); }
                } else if (p.type === 'book') b.insertAdjacentHTML('beforeend', ic('book', 's tbi'));
                b.append(el('span', 'name', tabLabel(p)));
                b.title = tabLabel(p);
                const x = el('span', 'x');
                x.innerHTML = ic('x');
                x.setAttribute('role', 'button');
                x.setAttribute('aria-label', 'Close tab');
                x.addEventListener('click', e => { e.stopPropagation(); A.closeTab(t.id); });
                b.append(x);
                b.draggable = true;
                b.addEventListener('dragstart', e => { dragTab = t.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', tabLabel(p)); });
                b.addEventListener('dragend', () => { dragTab = null; });
                b.addEventListener('dragover', e => { if (dragTab && dragTab !== t.id) { e.preventDefault(); b.classList.add('dropping'); } });
                b.addEventListener('dragleave', () => b.classList.remove('dropping'));
                b.addEventListener('drop', e => {
                    e.preventDefault();
                    const from = S.tabs.findIndex(x => x.id === dragTab);
                    if (from < 0) return;
                    const [moved] = S.tabs.splice(from, 1);
                    S.tabs.splice(S.tabs.findIndex(x => x.id === t.id) + (from <= S.tabs.findIndex(x => x.id === t.id) ? 1 : 0), 0, moved);
                    A.renderTabs();
                });
                // Middle-click closes.
                b.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); A.closeTab(t.id); } });
                b.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
                b.addEventListener('contextmenu', e => { e.preventDefault(); tabMenu(t); });
            }
            b.addEventListener('click', () => {
                if (t.home && active) return;
                if (t.home) t.history = [{ type: 'home' }];
                if (S.active !== t.id) { A.leave(); S.active = t.id; S.select = null; S.search = null; A.render(); }
            });
            strip.append(b);
        }
        const plus = btn('tadd', ic('plus', 's'), () => A.newTab(), 'New tab');
        plus.title = 'New tab';
        strip.append(plus);
        strip.ondblclick = e => { if (e.target === strip) A.newTab(); };
        const right = el('div', 'tright');
        const sb = btn('tsearch', `${ic('search', 's')}<span>Search</span><kbd>Ctrl K</kbd>`, () => openSearch(), 'Search (Ctrl K)');
        // Widen (LAYOUT "Size and place"): the space between ST's side panels, remembered.
        const wide = desk().normalWide === true;
        const wb = btn('iconbtn', ic(wide ? 'drawer' : 'fit'), () => { desk().normalWide = !wide; save(); A.render(); }, wide ? 'Drawer size' : 'Widen');
        wb.title = wide ? 'Drawer size' : 'Widen';
        right.append(sb, wb, btn('iconbtn', ic('x'), () => A.hide(), 'Close WI Hero'));
        tabbar.append(right);
    }
    function tabMenu(t) {
        layer.sheet(null, sh => {
            sh.append(layer.opt('Close tab', () => { layer.close(); A.closeTab(t.id); }, { icon: 'x' }));
            sh.append(layer.opt('Close other tabs', () => { layer.close(); S.tabs = S.tabs.filter(x => x.home || x.id === t.id); S.active = t.id; A.render(); }));
            sh.append(layer.opt('Close tabs to the right', () => {
                layer.close();
                const i = S.tabs.indexOf(t);
                S.tabs = S.tabs.slice(0, i + 1);
                if (!S.tabs.some(x => x.id === S.active)) S.active = t.id;
                A.render();
            }));
            sh.append(layer.opt('Duplicate tab', () => {
                layer.close();
                const n = { id: A.nextTabId(), history: [structuredClone({ ...pageOf(t), select: undefined })] };
                S.tabs.splice(S.tabs.indexOf(t) + 1, 0, n);
                S.active = n.id;
                A.render();
            }, { icon: 'copy' }));
        });
    }

    // ---------------------------------------------------------------- render
    function render() {
        const p = A.page();
        main.innerHTML = '';
        // The page's name: Hero's three-column grid (and anything else keyed on it) must not outlive Hero.
        main.dataset.page = `desk:${p.type}`;
        if (p.type === 'home') renderHome();
        else if (p.type === 'book') renderBook(p);
        else renderEntryTab(p);
        if (S.search) renderSearch();
    }

    // ---------------------------------------------------------------- Home
    function renderHome() {
        const v = el('div', 'view dhome');
        main.append(v);
        const names = A.visibleNames();
        const q = (S.homeQ ?? '').trim().toLowerCase();
        const shown = names.filter(n => !q || n.toLowerCase().includes(q) || bookFolderOf(settings, n).toLowerCase().includes(q));
        const view = desk().homeView === 'list' ? 'list' : 'tiles';
        const sel = S.select instanceof Set && S.selectOf === 'books' ? S.select : null;
        const selected = sel?.size ? sel : null;

        const h = el('div', 'dhead');
        if (selected) {
            h.classList.add('selbar2');
            h.append(btn('iconbtn', ic('x'), clearSel, 'Clear the selection'), el('b', 'cnt', `${selected.size} selected`));
            h.append(el('span', 'sp'));
            h.append(btn('dbtn', `${ic('move', 's')}<span>Move to folder</span>`, () => A.bookFolderSheet(f => { for (const n of selected) setBookFolder(settings, n, f); save(); clearSel(); })));
            h.append(btn('dbtn', `${ic('code', 's')}<span>Export</span>`, async () => { for (const n of selected) await library.exportBook(n); layer.toast(`Exported ${plural(selected.size, 'book')}`); }));
            h.append(btn('dbtn', 'Select all', () => { S.select = new Set(shown); A.render(); }));
            h.append(btn('dbtn danger', `${ic('trash', 's')}<span>Delete</span>`, () => { const list = [...selected]; clearSel(); A.deleteBooks(list); }));
        } else {
            h.append(el('h1', '', 'World Info'));
            const f = el('input', 'dfilter');
            f.placeholder = 'Filter books';
            f.setAttribute('aria-label', 'Filter books');
            f.dataset.slash = '1';
            f.value = S.homeQ ?? '';
            f.addEventListener('input', () => { S.homeQ = f.value; const pos = f.selectionStart; A.render(); const n = main.querySelector('.dfilter'); n?.focus(); n?.setSelectionRange(pos, pos); });
            h.append(f, el('span', 'sp'));
            const seg = el('div', 'dseg');
            seg.setAttribute('role', 'radiogroup');
            seg.setAttribute('aria-label', 'View');
            for (const [k, label, icon] of [['list', 'List', 'entry'], ['tiles', 'Tiles', 'select']]) {
                const b = btn(view === k ? 'on' : '', `${ic(icon, 's')}<span>${label}</span>`, () => { desk().homeView = k; save(); A.render(); });
                b.setAttribute('role', 'radio');
                b.setAttribute('aria-checked', String(view === k));
                seg.append(b);
            }
            h.append(seg);
            h.append(btn('dbtn', `${ic('folder', 's')}<span>New folder</span>`, newBookFolder));
            h.append(btn('dbtn pri', `${ic('plus', 's')}<span>New book</span>`, () => A.newBook(), 'New book (Alt N)'));
            const gear = btn('iconbtn', ic('gear'), A.wiSettingsSheet, 'World Info settings');
            gear.title = 'World Info settings';
            h.append(gear);
        }
        v.append(h);

        // Folders first, in name order; "Not in a folder" last. Empty folders still show, as drop targets.
        const folders = Object.keys(settings.bookFolders).sort((a, b) => a.localeCompare(b));
        const groups = folders.map(f => [f, settings.bookFolders[f].filter(n => shown.includes(n))]).filter(([, list]) => list.length || !q);
        const loose = shown.filter(n => !bookFolderOf(settings, n));
        if (groups.length) groups.push(['', loose]); else groups.push([null, loose]);
        const order = shown; // for Shift ranges
        const body = el('div', view === 'list' ? 'dlist' : 'dtiles-wrap');
        v.append(body);
        let table = null;
        if (view === 'list') {
            table = el('div', 'dtable');
            table.setAttribute('role', 'table');
            const hr = el('div', 'drow dth');
            hr.append(el('span', 'c0'));
            const sortBy = S.homeSort ?? { key: 'name', dir: 1 };
            for (const [k, label] of [['name', 'Name'], ['active', 'Active'], ['entries', 'Entries'], ['edited', 'Edited']]) {
                const b = btn(`c-${k}${sortBy.key === k ? ' on' : ''}`, '', () => { S.homeSort = { key: k, dir: sortBy.key === k ? -sortBy.dir : 1 }; A.render(); });
                b.textContent = label + (sortBy.key === k ? (sortBy.dir > 0 ? ' ↑' : ' ↓') : '');
                hr.append(b);
            }
            hr.append(el('span', 'c-more'));
            table.append(hr);
            body.append(table);
        }
        const sorted = list => {
            if (view !== 'list') return list;
            const s = S.homeSort ?? { key: 'name', dir: 1 };
            const val = n => (s.key === 'entries' ? (library.peek(n) ? A.entriesShown(n, library.peek(n)).length : -1)
                : s.key === 'edited' ? (library.edited?.(n) ?? 0) : s.key === 'active' ? (library.isGlobal(n) ? 2 : A.linkText(n) ? 1 : 0) : n.toLowerCase());
            return [...list].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * s.dir);
        };
        for (const [f, list] of groups) {
            const key = `home:${f ?? ''}`;
            const open = !S.collapsed.has(key);
            const target = table ?? body;
            if (f !== null) {
                const fh = btn(`dfolder${open ? ' open' : ''}`, `${ic('right', 's')}<span></span><small></small>`, () => { open ? S.collapsed.add(key) : S.collapsed.delete(key); A.render(); });
                fh.querySelector('span').textContent = f || 'Not in a folder';
                fh.querySelector('small').textContent = list.length;
                fh.setAttribute('aria-expanded', String(open));
                dropTarget(fh, name => { setBookFolder(settings, name, f); save(); A.render(); layer.toast(f ? `Moved to ${f}` : 'Taken out of its folder'); });
                if (table) { const r = el('div', 'drow dgroup'); r.append(fh); target.append(r); } else target.append(fh);
            }
            if (!open) continue;
            if (table) for (const n of sorted(list)) target.append(bookRow(n, sel, order));
            else {
                const grid = el('div', 'dtiles');
                for (const n of list) grid.append(bookTile(n, sel, order));
                if (!list.length) grid.append(el('div', 'dempty', f ? 'Drag books here.' : 'Every book is in a folder.'));
                target.append(grid);
            }
        }
        if (!names.length) v.append(el('div', 'empty-note', 'No books yet. Click New book to make the first one.'));
        else if (!shown.length) v.append(el('div', 'empty-note', 'No book matches the filter.'));
    }
    const clearSel = () => { S.select = null; S.selectOf = null; A.render(); };
    function newBookFolder() {
        layer.askText({
            title: 'New folder', placeholder: 'Folder name', ok: 'Create',
            check: n => (settings.bookFolders[n] ? 'There is a folder with that name' : null),
            done: n => { settings.bookFolders[n] = []; save(); A.render(); },
        });
    }
    function dropTarget(node, drop) {
        node.addEventListener('dragover', e => { if (dragBooks) { e.preventDefault(); node.classList.add('dropping'); } });
        node.addEventListener('dragleave', () => node.classList.remove('dropping'));
        node.addEventListener('drop', e => { e.preventDefault(); node.classList.remove('dropping'); const list = dragBooks; dragBooks = null; for (const n of list ?? []) drop(n); });
    }
    let dragBooks = null;
    /** Click, Ctrl/middle-click, Shift-click, right-click and drag on a book (tile or row). */
    function bookGestures(node, name, sel, order) {
        node.dataset.book = name;
        node.tabIndex = 0;
        node.draggable = true;
        node.addEventListener('dragstart', e => { dragBooks = sel?.has(name) ? [...sel] : [name]; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', name); });
        node.addEventListener('dragend', () => { dragBooks = null; });
        node.addEventListener('click', e => {
            if (e.target.closest('.dcheck, .more')) return;
            if (e.shiftKey && sel?.size) { rangeSelect(name, order); return; }
            if (e.shiftKey) { toggleBook(name); return; }
            if (e.ctrlKey || e.metaKey) { openFromHome(name, true); return; }
            if (sel?.size) { toggleBook(name); return; }
            openFromHome(name, false);
        });
        node.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); openFromHome(name, true); } });
        node.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
        node.addEventListener('keydown', e => { if (e.key === 'Enter') openFromHome(name, e.ctrlKey); else if (e.key === ' ') { e.preventDefault(); toggleBook(name); } });
        node.addEventListener('contextmenu', e => { e.preventDefault(); bookMenu(name); });
    }
    function openFromHome(name, background) {
        if (settings.openInHero && !background) { A.openHero(name); return; }
        openBook(name, { background });
    }
    function toggleBook(name) {
        if (!(S.select instanceof Set) || S.selectOf !== 'books') { S.select = new Set(); S.selectOf = 'books'; }
        S.select.has(name) ? S.select.delete(name) : S.select.add(name);
        S.anchorBook = name;
        A.render();
    }
    function rangeSelect(name, order) {
        const a = order.indexOf(S.anchorBook ?? name);
        const b = order.indexOf(name);
        for (const n of order.slice(Math.min(a, b), Math.max(a, b) + 1)) S.select.add(n);
        A.render();
    }
    function check(on, fn, label) {
        const c = btn(`dcheck${on ? ' on' : ''}`, on ? ic('check') : '', e => { e.stopPropagation(); fn(); }, label);
        c.setAttribute('role', 'checkbox');
        c.setAttribute('aria-checked', String(on));
        return c;
    }
    function statusChips(name) {
        const out = [];
        const global = library.isGlobal(name);
        const lt = A.linkText(name);
        if (global) out.push(el('span', 'badge g', 'Global'));
        if (lt) { const l = el('span', 'badge l'); l.innerHTML = ic('chain', 's'); l.append(lt); out.push(l); }
        if (!global && !lt) out.push(el('span', 'badge o', 'Off'));
        return out;
    }
    function countSpan(name) {
        const data = library.peek(name);
        const s = el('span', 'cnt', data ? plural(A.entriesShown(name, data).length, 'entry', 'entries') : '…');
        if (!data) A.countInto(name, s);
        return s;
    }
    function bookTile(name, sel, order) {
        const on = !!sel?.has(name);
        const t = el('div', `tile${on ? ' sel' : ''}`);
        t.setAttribute('role', 'button');
        const top = el('div', 'tt');
        top.insertAdjacentHTML('beforeend', ic('book', 's'));
        top.append(el('b', '', name));
        t.append(top);
        const chips = el('div', 'tchips');
        chips.append(...statusChips(name));
        t.append(chips);
        const m = el('div', 'tm');
        m.append(countSpan(name));
        const ed = library.edited?.(name);
        if (ed) m.append(el('span', '', `Edited ${dateText(ed)}`));
        t.append(m);
        t.append(check(on, () => toggleBook(name), `Select ${name}`));
        t.append(btn('more', ic('more', 's'), e => { e.stopPropagation(); bookMenu(name, e.currentTarget); }, `${name} actions`));
        bookGestures(t, name, sel, order);
        return t;
    }
    function bookRow(name, sel, order) {
        const on = !!sel?.has(name);
        const r = el('div', `drow dbook${on ? ' sel' : ''}`);
        r.setAttribute('role', 'row');
        const c0 = el('span', 'c0');
        c0.append(check(on, () => toggleBook(name), `Select ${name}`));
        const nm = el('span', 'c-name');
        nm.insertAdjacentHTML('beforeend', ic('book', 's'));
        nm.append(el('b', '', name));
        const act = el('span', 'c-active');
        act.append(...statusChips(name));
        const n = el('span', 'c-entries');
        const data = library.peek(name);
        n.textContent = data ? String(A.entriesShown(name, data).length) : '…';
        if (!data) A.countInto(name, n, d => String(d));
        r.append(c0, nm, act, n, el('span', 'c-edited', dateText(library.edited?.(name)) || '–'));
        const more = el('span', 'c-more');
        more.append(btn('more', ic('more', 's'), e => { e.stopPropagation(); bookMenu(name, e.currentTarget); }, `${name} actions`));
        r.append(more);
        bookGestures(r, name, sel, order);
        return r;
    }
    function bookMenu(name, at) {
        layer.sheet(null, sh => {
            sh.append(layer.opt('Open', () => { layer.close(); openBook(name); }, { icon: 'tab' }));
            sh.append(layer.opt('Open in background tab', () => { layer.close(); openBook(name, { background: true }); }, { val: 'Ctrl-click' }));
            const g = library.isGlobal(name);
            sh.append(layer.opt(g ? 'Make not global' : 'Make global', () => { layer.close(); library.setGlobal(name, !g); A.render(); layer.toast(g ? `${name} is no longer global` : `${name} is active everywhere`); }));
            sh.append(el('div', 'div'));
            sh.append(layer.opt('Rename', () => A.renameBook(name), { icon: 'edit' }));
            sh.append(layer.opt('Move to folder', () => A.bookFolderSheet(f => { setBookFolder(settings, name, f); save(); A.render(); }), { icon: 'move', val: bookFolderOf(settings, name) || 'No folder' }));
            sh.append(layer.opt('Export', () => { layer.close(); library.exportBook(name); layer.toast(`${name}.json exported`); }, { icon: 'code' }));
            sh.append(layer.opt('Snapshots', () => A.snapshotsSheet(name), { icon: 'snap', val: '›' }));
            sh.append(el('div', 'div'));
            sh.append(layer.opt('Delete', () => { layer.close(); A.deleteBooks([name]); }, { icon: 'trash', danger: true }));
        }, { at });
    }

    // ---------------------------------------------------------------- Book: two panes
    const listW = () => Math.max(LIST_W.min, Math.min(LIST_W.max, desk().listW ?? LIST_W.def));
    const narrow = () => (A.root.clientWidth || 9999) < NARROW;

    function renderBook(p) {
        const data = A.need(p.book);
        const wrap = el('div', 'bk');
        main.append(wrap);
        if (!library.names().includes(p.book) && !data) { wrap.append(el('div', 'empty-note', 'This book was deleted or renamed.')); return; }
        if (!data) { wrap.append(el('div', 'empty-note', 'Loading…')); return; }
        const book = p.book;
        const model = A.modelOf(book, data);
        const all = A.entriesShown(book, data);
        if (p.sel != null && !data.entries[p.sel]) p.sel = null;
        if (p.select) for (const u of [...p.select]) if (!data.entries[u] || A.hiddenIn(book).has(u)) p.select.delete(u);
        const isNarrow = narrow();
        // A narrow drawer works like the phone: the list fills the book, an entry fills it with ← back to the list.
        // With nothing picked yet there is no entry to show, so the list shows.
        if (isNarrow && p.sel == null && !p.pane && !(p.select?.size > 1)) p.listOpen = true;
        const listPage = isNarrow && !!p.listOpen;
        wrap.classList.toggle('narrow', isNarrow);
        wrap.classList.toggle('lpage', listPage);
        wrap.style.setProperty('--lw', `${listW()}px`);

        const left = el('aside', 'bl');
        wrap.append(left);
        if (!isNarrow) {
            wrap.append(resizer(listW, (w, done) => { desk().listW = w; wrap.style.setProperty('--lw', `${w}px`); if (done) save(); }, { ...LIST_W, onEnd: save }));
        }
        const right = el('section', 'br');
        wrap.append(right);
        bookList(left, p, book, data, model, all);
        if (p.pane === 'settings') bookSettingsPane(right, p, book, data);
        else if (p.select?.size > 1) bulkPane(right, p, book, data);
        else if (p.sel != null) entryPane(right, p, book, data, all);
        else {
            const v = el('div', 'view');
            v.append(el('div', 'dpick', all.length ? 'Pick an entry on the left, or press Alt N for a new one.' : 'No entries yet. Click + to write the first one.'));
            right.append(v);
        }
    }

    /** The entries in the order the left pane shows them (folders as they are open). */
    function listOrder(book, data, shown) {
        const groups = groupEntries(shown, A.sortBy(), e => A.entryFolder(book, e));
        groups.sort(([a], [b]) => (a !== '') - (b !== '') || a.localeCompare(b));
        const out = [];
        for (const [g, list] of groups) if (!g || !S.collapsed.has(`${book}:folder:${g}`)) out.push(...list.map(e => e.uid));
        return out;
    }

    function bookList(left, p, book, data, model, all) {
        const head = el('div', 'blhead');
        const bn = btn('bkname2', `${ic('book', 's')}<b></b>${ic('down', 's')}`, e => bookPageMenu(p, book, e.currentTarget), 'Book menu');
        bn.querySelector('b').textContent = book;
        head.append(bn);
        const st = el('div', 'blstat');
        const global = library.isGlobal(book);
        const g = btn(`chip2 sm${global ? ' on' : ''}`, `<i class="dot"></i><span>${global ? 'Global' : 'Not global'}</span>`, () => {
            library.setGlobal(book, !global);
            layer.toast(!global ? `${book} is active everywhere` : `${book} is no longer global`);
            A.render();
        }, 'Active globally');
        g.setAttribute('aria-pressed', String(global));
        const lk = btn('chip2 sm', `${ic('chain', 's')}<span></span>`, e => linksMenu(book, e.currentTarget), 'Links');
        lk.querySelector('span').textContent = A.linkText(book) || 'Not linked';
        st.append(g, lk);
        head.append(st, el('div', 'blcount', plural(all.length, 'entry', 'entries')));
        left.append(head);

        const fr = el('div', 'blfilter');
        const f = el('input');
        f.placeholder = 'Filter entries  /';
        f.setAttribute('aria-label', 'Filter entries');
        f.dataset.slash = '1';
        f.value = p.q ?? '';
        f.addEventListener('input', () => { p.q = f.value; fill(); });
        f.addEventListener('keydown', e => { if (e.key === 'ArrowDown') { e.preventDefault(); list.focus(); move(1, false); } });
        const add = btn('lbtn', ic('plus', 's'), () => newEntry(p, book), 'New entry (Alt N)');
        add.title = 'New entry (Alt N)';
        fr.append(f, add);
        left.append(fr);

        const list = el('div', 'bllist');
        list.tabIndex = 0;
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', `Entries of ${book}`);
        list.setAttribute('aria-multiselectable', 'true');
        left.append(list);
        let order = [];
        const shownNow = () => {
            const q = (p.q ?? '').trim().toLowerCase();
            return all.filter(e => (S.showOff || !e.disable || e.uid === p.sel) && (!q || titleOf(e).toLowerCase().includes(q) || (e.key ?? []).some(k => k.toLowerCase().includes(q))));
        };
        function fill() {
            list.innerHTML = '';
            const shown = shownNow();
            const groups = groupEntries(shown, A.sortBy(), e => A.entryFolder(book, e));
            for (const fl of bookSettings(settings, book).folderList ?? []) if (!groups.some(([x]) => x === fl)) groups.push([fl, []]);
            groups.sort(([a], [b]) => (a !== '') - (b !== '') || a.localeCompare(b));
            order = [];
            for (const [grp, items] of groups) {
                const key = `${book}:folder:${grp}`;
                const open = !S.collapsed.has(key);
                if (grp) {
                    const fh = el('div', `blfold${open ? ' open' : ''}`);
                    const t = btn('ft', `${ic('right', 's')}<span></span><small></small>`, () => { open ? S.collapsed.add(key) : S.collapsed.delete(key); fill(); });
                    t.querySelector('span').textContent = grp;
                    t.querySelector('small').textContent = items.length;
                    t.setAttribute('aria-expanded', String(open));
                    fh.append(t, btn('fadd', ic('plus', 's'), () => newEntry(p, book, grp), `New entry in ${grp}`));
                    entryDrop(fh, book, grp, p);
                    list.append(fh);
                    if (!open) continue;
                }
                for (const e of items) { order.push(e.uid); list.append(entryRow(p, book, e, model)); }
            }
            if (!shown.length) list.append(el('div', 'blnone', all.length ? (p.q ? 'Nothing matches.' : 'Every entry is off, and off entries are hidden (⌄ menu).') : 'No entries yet.'));
            // Drop on the empty list: No folder.
            entryDrop(list, book, '', p, true);
        }
        fill();
        list.addEventListener('keydown', e => listKeys(e, p, book, () => order));
        const move = (d, extend) => moveSel(p, book, order, d, extend);

        const foot = el('div', 'blfoot');
        if (narrow() && p.select?.size > 1) foot.append(btn('linkish selgo', `${p.select.size} selected ›`, () => { p.listOpen = false; A.render(); }));
        foot.append(btn('linkish', `${ic('gear', 's')} Book settings`, () => { p.pane = 'settings'; p.select = null; if (narrow()) p.listOpen = false; A.render(); }));
        const blocking = model.issues.filter(i => !i.warning && i.blocking !== false && i.stKey?.startsWith(`${book}.`));
        if (model.issues.length) {
            const first = blocking[0] ?? model.issues[0];
            const b = btn(`linkish probs${blocking.length ? '' : ' warn'}`, `${ic('alert', 's')} ${plural(model.issues.length, 'problem')}`, () => {
                const uid = first.stKey ? Number(first.stKey.slice(first.stKey.lastIndexOf('.') + 1)) : null;
                if (uid !== null && data.entries[uid]) { select(p, uid); return; }
                A.problemsSheet(book);
            });
            b.addEventListener('contextmenu', e => { e.preventDefault(); A.problemsSheet(book); });
            b.title = 'Click for the first one, right-click for the list';
            foot.append(b);
        }
        left.append(foot);
    }

    function entryRow(p, book, e, model) {
        const multi = p.select?.size > 1;
        const on = multi ? p.select.has(e.uid) : p.sel === e.uid;
        const r = el('div', `brow st-${strategyOf(e)}${on ? ' on' : ''}${e.disable ? ' off' : ''}`);
        r.dataset.uid = e.uid;
        r.setAttribute('role', 'option');
        r.setAttribute('aria-selected', String(on));
        r.draggable = true;
        r.append(el('span', 'nm', titleOf(e)));
        r.append(el('span', 'kw', e.constant ? 'always on' : e.vectorized ? 'by meaning' : (e.key ?? []).join(', ')));
        const node = model.byStKey.get(`${book}.${e.uid}`);
        if (node && (A.hasLogic?.(e) ?? true)) { const d = el('i', 'ldot'); d.title = 'Has story logic'; r.append(d); }
        if (A.problemsOf(model, e.uid, book).length) { const b = el('span', 'bang2', '!'); b.title = 'This entry has a problem'; r.append(b); }
        const sw = swEl(!e.disable, v => library.change(book, d => { d.entries[e.uid].disable = !v; }), `${titleOf(e)} on`);
        sw.classList.add('sm');
        r.append(sw, btn('more', ic('more', 's'), ev => { ev.stopPropagation(); entryMenu(p, book, e.uid, ev.currentTarget); }, `${titleOf(e)} actions`));
        r.addEventListener('click', ev => {
            if (ev.target.closest('button')) return;
            if (ev.ctrlKey || ev.metaKey) { toggleSel(p, e.uid); return; }
            if (ev.shiftKey) { rangeSel(p, book, e.uid); return; }
            select(p, e.uid);
        });
        r.addEventListener('dblclick', ev => { if (!ev.target.closest('button')) openEntryTab(book, e.uid); });
        r.addEventListener('auxclick', ev => { if (ev.button === 1) { ev.preventDefault(); openEntryTab(book, e.uid, { background: true }); } });
        r.addEventListener('mousedown', ev => { if (ev.button === 1) ev.preventDefault(); });
        r.addEventListener('contextmenu', ev => { ev.preventDefault(); entryMenu(p, book, e.uid); });
        r.addEventListener('dragstart', ev => {
            dragEntries = { book, uids: p.select?.has(e.uid) ? [...p.select] : [e.uid] };
            ev.dataTransfer.effectAllowed = 'move';
            ev.dataTransfer.setData('text/plain', titleOf(e));
        });
        r.addEventListener('dragend', () => { dragEntries = null; });
        return r;
    }
    let dragEntries = null;
    function entryDrop(node, book, folder, p, onlySelf = false) {
        node.addEventListener('dragover', e => {
            if (!dragEntries || dragEntries.book !== book || (onlySelf && e.target !== node && !e.target.classList?.contains('blnone'))) return;
            e.preventDefault();
            node.classList.add('dropping');
        });
        node.addEventListener('dragleave', () => node.classList.remove('dropping'));
        node.addEventListener('drop', e => {
            node.classList.remove('dropping');
            if (!dragEntries || dragEntries.book !== book) return;
            e.preventDefault();
            e.stopPropagation();
            const data = library.peek(book);
            for (const u of dragEntries.uids) if (data.entries[u]) setFolder(settings, book, data.entries[u], folder);
            dragEntries = null;
            save();
            A.render();
            layer.toast(folder ? `Moved to ${folder}` : 'Moved to No folder');
        });
    }

    function select(p, uid, { focusTitle = false } = {}) {
        if (p.sel !== uid) A.leaveEntry?.(p);
        p.sel = uid;
        p.anchor = uid;
        p.select = null;
        p.pane = null;
        if (narrow()) p.listOpen = false;
        A.render();
        reveal(uid);
        if (focusTitle) setTimeout(() => main.querySelector('.br .en h1')?.focus(), 0);
    }
    const reveal = uid => requestAnimationFrame(() => main.querySelector(`.brow[data-uid="${uid}"]`)?.scrollIntoView({ block: 'nearest' }));
    function toggleSel(p, uid) {
        const s = p.select ?? new Set(p.sel != null ? [p.sel] : []);
        s.has(uid) ? s.delete(uid) : s.add(uid);
        p.select = s;
        p.anchor = uid;
        if (s.size === 1) { p.sel = [...s][0]; } else if (!s.size) { p.select = null; }
        p.pane = null;
        A.render();
    }
    function rangeSel(p, book, uid) {
        const data = library.peek(book);
        const order = listOrder(book, data, A.entriesShown(book, data).filter(e => S.showOff || !e.disable));
        const a = order.indexOf(p.anchor ?? p.sel ?? uid);
        const b = order.indexOf(uid);
        p.select = new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1));
        if (p.select.size === 1) { p.sel = uid; p.select = null; }
        p.pane = null;
        A.render();
    }
    function moveSel(p, book, order, d, extend) {
        if (!order.length) return;
        const cur = p.focus ?? p.sel ?? order[0];
        let i = order.indexOf(cur);
        i = i < 0 ? 0 : Math.max(0, Math.min(order.length - 1, i + d));
        const uid = order[i];
        if (extend) {
            const a = order.indexOf(p.anchor ?? cur);
            p.select = new Set(order.slice(Math.min(a, i), Math.max(a, i) + 1));
            p.focus = uid;
            if (p.select.size === 1) { p.sel = uid; p.select = null; }
            A.render();
        } else { p.focus = null; select(p, uid); }
        requestAnimationFrame(() => main.querySelector('.bllist')?.focus({ preventScroll: true }));
        reveal(uid);
    }
    function listKeys(e, p, book, order) {
        const uids = p.select?.size ? [...p.select] : p.sel != null ? [p.sel] : [];
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); moveSel(p, book, order(), e.key === 'ArrowDown' ? 1 : -1, e.shiftKey); } else if (e.key === ' ' && uids.length) {
            e.preventDefault();
            const data = library.peek(book);
            const on = uids.some(u => data.entries[u]?.disable);
            library.change(book, d => { for (const u of uids) if (d.entries[u]) d.entries[u].disable = !on; });
        } else if (e.key === 'Enter' && p.sel != null) { e.preventDefault(); main.querySelector('.br .en h1')?.focus(); } else if ((e.key === 'Delete' || e.key === 'Backspace') && uids.length) {
            e.preventDefault();
            deleteSome(p, book, uids);
        }
    }
    function deleteSome(p, book, uids) {
        const data = library.peek(book);
        const order = listOrder(book, data, A.entriesShown(book, data));
        const after = order.filter(u => !uids.includes(u));
        const i = order.indexOf(uids[0]);
        p.select = null;
        p.sel = after[Math.min(Math.max(0, i), after.length - 1)] ?? null;
        A.deleteEntries(book, uids);
    }

    function newEntry(p, book, folder = '') {
        const x = A.createEntryIn(book, folder);
        if (!x) return;
        p.sel = x.uid;
        p.anchor = x.uid;
        p.select = null;
        p.pane = null;
        p.fresh = x.uid;
        if (narrow()) p.listOpen = false;
        A.render();
        reveal(x.uid);
        setTimeout(() => main.querySelector('.br .en h1')?.focus(), 30);
    }

    function bookPageMenu(p, book, at) {
        layer.sheet(null, sh => {
            sh.append(layer.opt('Open in Hero mode', () => { layer.close(); A.openHero(book); }, { icon: 'canvas' }));
            sh.append(layer.opt('Book settings', () => { layer.close(); p.pane = 'settings'; p.select = null; A.render(); }, { icon: 'gear' }));
            sh.append(el('div', 'div'));
            sh.append(layer.opt('New folder…', () => A.newEntryFolder(book), { icon: 'folder' }));
            sh.append(layer.opt('Rename', () => A.renameBook(book), { icon: 'edit' }));
            sh.append(layer.opt('Duplicate', () => { layer.close(); A.duplicateBook(book); }, { icon: 'copy' }));
            sh.append(layer.opt('Move to folder', () => A.bookFolderSheet(f => { setBookFolder(settings, book, f); save(); A.render(); }), { icon: 'move', val: bookFolderOf(settings, book) || 'No folder' }));
            sh.append(layer.opt('Export', () => { layer.close(); library.exportBook(book); layer.toast(`${book}.json exported`); }, { icon: 'code' }));
            sh.append(layer.opt('Snapshots', () => A.snapshotsSheet(book), { icon: 'snap', val: '›' }));
            sh.append(el('div', 'div'));
            sh.append(layer.opt('Delete book', () => { layer.close(); A.deleteBooks([book]); }, { icon: 'trash', danger: true }));
        }, { at });
    }
    function linksMenu(book, at) {
        layer.sheet(null, sh => {
            const links = library.links(book);
            if (!links.length) sh.append(el('p', 'help', 'Not linked to any character or chat.'));
            for (const l of links) {
                sh.append(layer.opt(l.name, async () => {
                    layer.close();
                    try { await library.unlink(book, l); layer.toast(`Unlinked from ${l.name}`); } catch (e) { layer.toast(e.message); }
                    A.render();
                }, { val: 'Unlink', icon: l.kind === 'chat' ? 'entry' : 'user' }));
            }
            if (library.chatOpen() && library.chatBook() !== book) sh.append(layer.opt('Link to this chat', async () => { layer.close(); await library.linkChat(book); A.render(); }, { icon: 'plus' }));
            if (A.canLinkCharacter?.(book)) sh.append(layer.opt('Link to the character', async () => { layer.close(); await A.linkCharacter(book); A.render(); }, { icon: 'user' }));
        }, { at });
    }

    /** Right-click or ⋯ on an entry row; with several selected, for all of them. */
    function entryMenu(p, book, uid, at) {
        const many = p.select?.size > 1 && p.select.has(uid) ? [...p.select] : null;
        if (!many) { A.entryMenu(book, uid, { desk: { at, openTab: () => openEntryTab(book, uid), afterDelete: () => deleteSome(p, book, [uid]) } }); return; }
        layer.sheet(null, sh => bulkActions(sh, p, book, many, true), { at });
    }
    function bulkActions(box, p, book, uids, asMenu) {
        const data = library.peek(book);
        const opt = (label, fn, o = {}) => box.append(asMenu ? layer.opt(label, () => { layer.close(); fn(); }, o) : btn(`dbtn${o.danger ? ' danger' : ''}`, `${o.icon ? ic(o.icon, 's') : ''}<span>${label}</span>`, fn));
        if (asMenu) opt('Open in new tabs', () => { for (const u of uids) openEntryTab(book, u, { background: true }); }, { icon: 'tab' });
        opt('Turn on', () => library.change(book, d => { for (const u of uids) if (d.entries[u]) d.entries[u].disable = false; }), { icon: 'on' });
        opt('Turn off', () => library.change(book, d => { for (const u of uids) if (d.entries[u]) d.entries[u].disable = true; }), { icon: 'off' });
        opt('Duplicate', () => duplicateSome(p, book, uids), { icon: 'copy' });
        const moveFolder = () => A.folderSheet(book, null, f => { for (const u of uids) if (data.entries[u]) setFolder(settings, book, data.entries[u], f); save(); A.render(); });
        const moveBook = () => A.moveToBookSheet(book, uids, () => { p.select = null; p.sel = null; });
        if (asMenu) { box.append(layer.opt('Move to folder', moveFolder, { icon: 'folder' })); box.append(layer.opt('Move to another book', moveBook, { icon: 'move' })); } else {
            opt('Move to folder', moveFolder, { icon: 'folder' });
            opt('Move to another book', moveBook, { icon: 'move' });
        }
        opt('Delete', () => deleteSome(p, book, uids), { icon: 'trash', danger: true });
    }
    function duplicateSome(p, book, uids) {
        const made = [];
        library.change(book, d => {
            for (const u of uids) {
                if (!d.entries[u]) continue;
                const copy = duplicateEntry(d, u);
                const f = A.entryFolder(book, d.entries[u]);
                if (f) setFolder(settings, book, copy, f);
                made.push(copy.uid);
            }
        });
        save();
        if (made.length === 1) select(p, made[0]); else { p.select = new Set(made); A.render(); }
        layer.toast(made.length === 1 ? `Made ${titleOf(library.peek(book).entries[made[0]])}` : `Made ${made.length} copies`);
    }

    // ---------------------------------------------------------------- right pane
    function entryPane(right, p, book, data, all) {
        const order = listOrder(book, data, all.filter(e => S.showOff || !e.disable || e.uid === p.sel));
        const i = order.indexOf(p.sel);
        const go = uid => () => select(p, uid);
        const e = data.entries[p.sel];
        const folder = A.entryFolder(book, e);
        A.renderEntryInto(right, { type: 'entry', book, uid: p.sel, fresh: p.fresh === p.sel }, {
            desk: {
                crumbs: [{ label: book }, ...(folder ? folder.split('/').map(f => ({ label: f })) : [])],
                prev: i > 0 ? go(order[i - 1]) : null,
                next: i >= 0 && i < order.length - 1 ? go(order[i + 1]) : null,
                panel: narrow() ? () => { p.listOpen = true; A.render(); } : null,
            },
            menu: () => entryMenu(p, book, p.sel),
        });
    }

    function renderEntryTab(p) {
        const data = A.need(p.book);
        const e = data?.entries[p.uid];
        const folder = e ? A.entryFolder(p.book, e) : '';
        A.renderEntryInto(main, p, {
            desk: {
                crumbs: [{ label: p.book, go: () => showInBook(p.book, p.uid) }, ...(folder ? folder.split('/').map(f => ({ label: f })) : [])],
                showOnCanvas: null,
            },
            menu: () => A.entryMenu(p.book, p.uid, { onPage: true, desk: { openTab: null, inBook: () => showInBook(p.book, p.uid) } }),
        });
    }

    /** A narrow drawer's ← back to the entry list. */
    const toList = p => { const b = btn('lbtn', ic('back', 's'), () => { p.listOpen = true; A.render(); }, 'Back to the entries'); b.title = 'Entries'; return b; };

    function bulkPane(right, p, book, data) {
        const uids = [...p.select].filter(u => data.entries[u]);
        const list = uids.map(u => data.entries[u]);
        const v = el('div', 'view bulk');
        right.append(v);
        if (narrow()) { const top = el('div', 'en-line'); top.append(toList(p)); v.append(top); }
        const box = el('div', 'en');
        v.append(box);
        box.append(el('h1', 'bh', `${list.length} entries selected`));
        box.append(el('p', 'bnames', list.map(titleOf).join(', ')));
        const acts = el('div', 'bacts');
        bulkActions(acts, p, book, uids, false);
        box.append(acts);
        // Edit together: rows where they differ say Mixed; only changed rows are applied.
        const draft = (p.draft && p.draftFor === uids.join(',')) ? p.draft : (p.draft = new Map(), p.draftFor = uids.join(','), p.draft);
        box.append(el('h2', 'bh2', 'Edit together'));
        const valueOf = q => (draft.has(q.field) ? draft.get(q.field) : commonValue(list, q));
        box.append(paramGrid(list[0], (q, x) => { draft.set(q.field, x); A.render(); }, {
            value: q => { const x = valueOf(q); return x === MIXED ? null : x; },
            mixed: q => valueOf(q) === MIXED,
            changed: q => draft.has(q.field),
            when: q => !q.when || list.every(q.when),
        }));
        const apply = btn('dbtn pri', `Apply to ${list.length} entries`, () => {
            const changes = [...draft.entries()];
            library.change(book, d => { for (const u of uids) for (const [field, x] of changes) if (d.entries[u]) A.applyParam(book, d, u, PARAM_LIST.find(q => q.field === field), x); });
            draft.clear();
            layer.toast(`Applied to ${list.length} entries`);
        });
        apply.disabled = !draft.size;
        const ar = el('div', 'bacts');
        ar.append(apply);
        if (draft.size) ar.append(btn('dbtn', 'Reset', () => { draft.clear(); A.render(); }));
        box.append(ar);
    }

    function bookSettingsPane(right, p, book, data) {
        const v = el('div', 'view');
        right.append(v);
        const top = el('div', 'en-line');
        if (narrow()) top.append(toList(p));
        const cr = el('div', 'crumbs');
        cr.insertAdjacentHTML('beforeend', ic('book', 's'));
        cr.append(el('span', 'crumb', book), el('span', 'sl', '/'), el('span', 'crumb', 'Book settings'));
        top.append(cr, btn('lbtn', ic('x', 's'), () => { p.pane = null; A.render(); }, 'Close Book settings'));
        v.append(top);
        const box = el('div', 'en bset');
        v.append(box);
        box.append(el('h1', '', 'Book settings'));
        box.append(el('div', 'plbl', 'Where it is active'));
        const gr = el('div', 'srow');
        const global = library.isGlobal(book);
        gr.append(el('span', 'grow', 'Active globally'), swEl(global, on => { library.setGlobal(book, on); A.render(); }, 'Active globally'));
        box.append(gr);
        for (const l of library.links(book)) {
            const r = el('div', 'srow');
            r.insertAdjacentHTML('beforeend', ic(l.kind === 'chat' ? 'entry' : 'user', 's'));
            r.append(el('span', 'grow', l.name), btn('dbtn', 'Unlink', async () => { try { await library.unlink(book, l); layer.toast(`Unlinked from ${l.name}`); } catch (e) { layer.toast(e.message); } A.render(); }));
            box.append(r);
        }
        if (library.chatOpen() && library.chatBook() !== book) box.append(btn('linkish', `${ic('plus', 's')} Link to this chat`, async () => { await library.linkChat(book); A.render(); }));
        box.append(el('div', 'plbl', 'New entry defaults'));
        box.append(el('p', 'help0', 'What new entries in this book start with.'));
        const defaults = bookSettings(settings, book).defaults ??= {};
        const fake = { ...defaults, extensions: defaults.by ? { wihero: { by: defaults.by } } : undefined };
        box.append(paramGrid(fake, (q, x) => {
            if (x === q.def || x === null) delete defaults[q.field]; else defaults[q.field] = x;
            save();
            A.render();
        }, { value: q => paramValue(fake, q) }));
        const acts = el('div', 'bacts');
        acts.append(
            btn('dbtn', `${ic('code', 's')}<span>Export</span>`, () => { library.exportBook(book); layer.toast(`${book}.json exported`); }),
            btn('dbtn', `${ic('snap', 's')}<span>Snapshots</span>`, () => A.snapshotsSheet(book)),
            btn('dbtn', `${ic('copy', 's')}<span>Duplicate</span>`, () => A.duplicateBook(book)),
            btn('dbtn danger', `${ic('trash', 's')}<span>Delete book</span>`, () => A.deleteBooks([book])),
        );
        box.append(acts);
        void data;
    }

    // ---------------------------------------------------------------- search overlay (Ctrl K)
    function openSearch() { S.search = { query: S.search?.query ?? '', at: 0 }; A.render(); }
    function renderSearch() {
        const ov = el('div', 'dsearch');
        const scrim = el('div', 'dscrim');
        scrim.addEventListener('click', () => { S.search = null; A.render(); });
        const box = el('div', 'dsbox');
        const bar = el('div', 'dsbar');
        bar.insertAdjacentHTML('beforeend', ic('search', 's'));
        const input = el('input');
        input.placeholder = 'Search books, folders, entries and key words';
        input.setAttribute('aria-label', 'Search');
        input.value = S.search.query;
        bar.append(input, el('kbd', '', 'Esc'));
        const res = el('div', 'dsres');
        res.setAttribute('role', 'listbox');
        box.append(bar, res);
        ov.append(scrim, box);
        main.append(ov);
        const names = A.visibleNames();
        for (const n of names) A.need(n, { open: false });
        const hero = S.mode === 'hero';
        const cur = hero ? A.heroBook() : A.page().book;
        let hits = [];
        const open = (h, background) => {
            if (hero) { S.search = null; A.heroOpen(h, background); return; }
            if (h.kind === 'entry') {
                if (background) { openEntryTab(h.book, h.entry.uid, { background: true }); return; }
                S.search = null;
                if (h.book === cur && A.page().type === 'book') select(A.page(), h.entry.uid); else showInBook(h.book, h.entry.uid);
            } else if (h.kind === 'book') { S.search = null; openBook(h.book, { background }); } else if (h.book) {
                S.collapsed.delete(`${h.book}:folder:${h.folder}`);
                S.search = null;
                openBook(h.book, { background });
            } else { S.collapsed.delete(`home:${h.folder}`); S.search = null; S.active = S.tabs[0].id; S.tabs[0].history = [{ type: 'home' }]; A.render(); }
        };
        const mark = () => res.querySelectorAll('.dsr').forEach((n, i) => { n.classList.toggle('at', i === S.search.at); if (i === S.search.at) n.scrollIntoView({ block: 'nearest' }); });
        const run = () => {
            S.search.query = input.value;
            res.innerHTML = '';
            const books = names.map(n => ({ name: n, folder: bookFolderOf(settings, n), entries: library.peek(n) ? A.entriesShown(n, library.peek(n)) : [], folderOf: e => A.entryFolder(n, e) }));
            hits = input.value.trim() ? search(books, input.value, cur).slice(0, 60) : [];
            if (!input.value.trim()) { res.append(el('div', 'dsnone', cur ? 'Type to search every book. Entries of this book come first.' : 'Type to search every book. Books come first.')); return; }
            if (!hits.length) { res.append(el('div', 'dsnone', 'Nothing found.')); return; }
            S.search.at = Math.min(S.search.at ?? 0, hits.length - 1);
            hits.forEach((h, i) => {
                const r = el('div', `dsr${h.kind === 'entry' ? ` st-${strategyOf(h.entry)}` : ''}`);
                r.setAttribute('role', 'option');
                r.insertAdjacentHTML('beforeend', ic(h.kind === 'entry' ? 'entry' : h.kind === 'book' ? 'book' : 'folder', 's'));
                const title = h.kind === 'entry' ? titleOf(h.entry) : h.kind === 'book' ? h.book : h.folder;
                const meta = h.kind === 'entry' ? `${h.book}${A.entryFolder(h.book, h.entry) ? ` · ${A.entryFolder(h.book, h.entry)}` : ''}${h.entry.key?.length ? ` · ${h.entry.key.join(', ')}` : ''}`
                    : h.kind === 'book' ? 'Book' : h.book ? `Folder in ${h.book}` : 'Book folder';
                r.append(el('b', '', title), el('small', '', meta));
                r.addEventListener('mousemove', () => { if (S.search.at !== i) { S.search.at = i; mark(); } });
                r.addEventListener('click', e => open(h, e.ctrlKey || e.metaKey));
                r.addEventListener('auxclick', e => { if (e.button === 1) open(h, true); });
                res.append(r);
            });
            mark();
        };
        input.addEventListener('input', () => { S.search.at = 0; run(); });
        input.addEventListener('keydown', e => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); S.search.at = Math.max(0, Math.min(hits.length - 1, (S.search.at ?? 0) + (e.key === 'ArrowDown' ? 1 : -1))); mark(); } else if (e.key === 'Enter' && hits[S.search.at ?? 0]) { e.preventDefault(); open(hits[S.search.at ?? 0], e.ctrlKey || e.metaKey); }
        });
        run();
        setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 0);
    }

    // ---------------------------------------------------------------- keys (LAYOUT "Keys")
    /** Returns true when the key was WI Hero's. */
    function key(e) {
        const p = A.page();
        const typing = A.typing();
        if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { openSearch(); return true; }
        if (e.altKey && !e.ctrlKey && e.key.toLowerCase() === 'n') {
            if (p.type === 'home') A.newBook(); else if (p.type === 'book') newEntry(p, p.book);
            return true;
        }
        if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && p.type === 'book') {
            const data = library.peek(p.book);
            if (!data) return false;
            const order = listOrder(p.book, data, A.entriesShown(p.book, data).filter(x => S.showOff || !x.disable || x.uid === p.sel));
            const i = order.indexOf(p.sel);
            const j = i < 0 ? 0 : i + (e.key === 'ArrowDown' ? 1 : -1);
            if (order[j] !== undefined) select(p, order[j]);
            return true;
        }
        if (typing || S.search || layer.isOpen()) return false;
        if (e.key === '/') { const f = main.querySelector('[data-slash]'); if (f) { f.focus(); f.select?.(); return true; } }
        if (p.type === 'home') {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { S.select = new Set(A.visibleNames()); S.selectOf = 'books'; A.render(); return true; }
            if ((e.key === 'Delete') && S.selectOf === 'books' && S.select?.size) { const list = [...S.select]; clearSel(); A.deleteBooks(list); return true; }
        }
        if (p.type === 'book') {
            const uids = p.select?.size ? [...p.select] : p.sel != null ? [p.sel] : [];
            const inList = !!A.shadow.activeElement?.closest?.('.bl');
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && uids.length && inList) { duplicateSome(p, p.book, uids); return true; }
        }
        return false;
    }

    /** Escape and Back on desktop: menu or search, then a selection, then the text box, then close (LAYOUT "Keys"). */
    function back() {
        if (layer.isOpen()) { layer.close(); return true; }
        if (S.search) { S.search = null; A.render(); return true; }
        const p = A.page();
        if (p.type === 'book' && p.select?.size > 1) { p.select = null; A.render(); return true; }
        if (p.type === 'book' && p.pane) { p.pane = null; A.render(); return true; }
        if (S.selectOf === 'books' && S.select?.size) { clearSel(); return true; }
        if (A.typing()) { A.shadow.activeElement?.blur(); return true; }
        A.hide();
        return false;
    }

    return { render, renderTabs, back, key, openBook, openEntryTab, showInBook, openSearch, renderSearch };
}
