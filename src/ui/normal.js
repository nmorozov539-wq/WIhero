// Normal mode's views (LAYOUT "Normal mode"): Home, the book page with its bottom bar and selection, search, and
// the entry page. Moved out of app.js; it reaches the app only through the context given to it.
import {
    MIXED, PARAM_LIST, bookFolderOf, bookSettings, cardKey, commonValue, configOf, groupEntries, idOf, paramSummary,
    paramText, paramValue, rekeyEntry, search, setBookFolder, setFolder, setParam, strategyOf, titleOf,
} from './data.js';
import { bookEditor } from './pieces.js';
import { trackerContext } from './tracker-ui.js';
import { btn, el, html, longPress, pressable, swEl } from './dom.js';
import { ic } from './icons.js';
import { closedText, logicLines } from './logic-text.js';
import { keywordClashes } from './clashes.js';
import { editParam, paramRow, renderEntryPage, strategyColor } from './entry-page.js';
import { entryStatus } from '../engine/turn.js';
import { isObject } from '../engine/util.js';

/**
 * @param {object} A The app's context (destructured below): its state, the library and hooks, and the app
 *   functions the views call (menus, sheets, deleting, opening pages).
 */
export function createNormal(A) {
    const {
        H, S, back, bookFolderSheet, bookMenu, countInto, ctx, dataSheet, deleteBooks, deleteEntries, entriesShown,
        entryFolder, entryMenu, folderSheet, hiddenIn, homePlus, hooks, importBook, layer, leave, library, linkText,
        linksSheet, loadingNote, main, modelOf, need, newEntry, offHint, openIn, page, problemsOf, warningsOf, hasLogic, render, renderTabs,
        saveSettings, settings, shadow, showOnCanvas, sortBy, switchMode, tab, up, visibleNames, wiSettingsSheet,
    } = A;

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
        if (hasLogic(e, model.byStKey.get(`${book}.${e.uid}`))) { const d = el('i', 'ldot'); d.title = 'Has story logic'; t.append(d); }
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
            // Import has nothing to do with the selection: it lives under + (New book or Import) (#41).
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
            warnings: warningsOf(model, e.uid, book).map(i => i.message.replace(/^./, ch => ch.toUpperCase())),
            clash: (cl => key => cl.of(e.uid, key))(keywordClashes(data, hiddenIn(book))),
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
            tracker: node?.key ? trackerContext({ book, node, model, hooks, ctx, layer, editBook: fn => library.change(book, d => fn(bookEditor(d), d)), after: () => render(), toast: t => layer.toast(t) }) : null,
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

    return { applyParam, bottomBar, check, renderBook, renderEntry, renderHome, renderSearch, selBar };
}
