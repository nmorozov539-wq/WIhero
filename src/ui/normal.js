// Normal mode's views (LAYOUT "Normal mode"): Home, the book page with its bottom bar and selection, search, and
// the entry page. Moved out of app.js; it reaches the app only through the context given to it.
import {
    MIXED, PARAM_LIST, bookFolderOf, bookSettings, cardKey, commonValue, compareText, configOf, groupEntries, idOf, paramSummary,
    bookTokens, paramText, paramValue, promptOrder, rekeyEntry, tokenGuess, tokensText, search, setBookFolder, setFolder, setParam, strategyOf, titleOf,
} from './data.js';
import { bookEditor } from './pieces.js';
import { trackerContext } from './tracker-ui.js';
import { btn, el, html, keyed, longPress, pressable, swEl } from './dom.js';
import { ic, setIcon } from './icons.js';
import { closedText, logicLines } from './logic-text.js';
import { keywordClashes } from './clashes.js';
import { editParam, paramRow, renderEntryPage, strategyColor } from './entry-page.js';
import { perf } from './perf.js';
import { entryStatus } from '../engine/turn.js';
import { isObject } from '../engine/util.js';

/**
 * @param {object} A The app's context (destructured below): its state, the library and hooks, and the app
 *   functions the views call (menus, sheets, deleting, opening pages).
 */
/** ST's Order parameter: where an entry goes in the prompt. */
const ORDER_PARAM = PARAM_LIST.find(p => p.field === 'order');

export function createNormal(A) {
    const {
        H, S, back, bookFolderSheet, bookMenu, countInto, ctx, dataSheet, deleteBooks, deleteEntries, entriesShown,
        entryFolder, entryMenu, folderSheet, hiddenIn, homePlus, hooks, importBook, layer, leave, library, linkText,
        linksSheet, loadingNote, main, modelOf, need, newEntry, newEntryFolder, offHint, openIn, page, problemsOf, warningsOf, hasLogic, render, renderTabs,
        saveSettings, settings, shadow, showOnCanvas, onCanvas, sortBy, switchMode, tab, up, visibleNames, wiSettingsSheet,
    } = A;

    // ---------------------------------------------------------------- Home
    function renderHome() {
        const v = el('div', 'view');
        main.append(v);
        const names = visibleNames();
        const tiles = settings.homeView === 'tiles';
        const books = list => {
            if (!tiles) {
                const rowAt = perf.begin('rowMount');
                for (const n of list) v.append(bookRow(n));
                perf.end(rowAt);
                return;
            }
            const g = el('div', 'ptiles');
            const rowAt = perf.begin('rowMount');
            for (const n of list) g.append(bookTile(n));
            perf.end(rowAt);
            if (list.length) v.append(g);
        };
        if (S.select) v.append(selHead(names, 'books'));
        else {
            const h = el('div', 'head');
            // List or tiles, the phone's own choice (desktop keeps its own under settings.desk).
            const toTiles = !tiles;
            h.append(el('h1', '', 'World Info'),
                btn('round flat', ic(toTiles ? 'grid' : 'rows'), () => { settings.homeView = toTiles ? 'tiles' : 'list'; saveSettings(); render(); }, toTiles ? 'Show books as tiles' : 'Show books as a list'),
                btn('round flat', ic('gear'), wiSettingsSheet, 'World Info settings'));
            v.append(h);
        }
        // A folder shows while it holds a book shown here, or nothing at all (a new folder, #40).
        const folders = Object.keys(settings.bookFolders).filter(f => !settings.bookFolders[f].length || settings.bookFolders[f].some(n => names.includes(n))).sort((a, b) => compareText(a, b));
        const loose = names.filter(n => !bookFolderOf(settings, n));
        v.append(el('div', 'section', 'Books'));
        books(loose);
        for (const f of folders) {
            const list = settings.bookFolders[f].filter(n => names.includes(n)).sort((a, b) => compareText(a, b));
            const key = `home:${f}`;
            const open = !S.collapsed.has(key);
            v.append(sectionHead(`${f} · ${list.length}`, open, () => { open ? S.collapsed.add(key) : S.collapsed.delete(key); render(); }, S.select ? list : null));
            if (open) books(list);
        }
        if (!names.length) v.append(el('div', 'empty-note', 'No books yet. Tap + to make the first one.'));
    }

    /** Entry count and status badges, shared by a book's row and its tile. */
    function bookMeta(name) {
        const m = el('div', 'm');
        const data = library.peek(name);
        const count = el('span', '', data ? `${entriesShown(name, data).length} entries` : '…');
        if (!data) countInto(name, count);
        m.append(count);
        const global = library.isGlobal(name);
        const lt = linkText(name);
        if (library.unsaved?.(name)) { const u = el('span', 'badge u', 'Not saved'); u.title = 'Saving failed. Your edits are kept here; the next change tries again'; m.append(u); }
        if (global) m.append(el('span', 'badge g', 'Global'));
        if (lt) { const l = el('span', 'badge l'); setIcon(l, 'chain', 's'); l.append(lt); m.append(l); }
        if (!global && !lt) { const o = el('span', 'badge o', 'Off'); o.title = 'No chat uses it. Open the book to use it in a chat or make it global'; m.append(o); }
        return m;
    }

    /** Tap, long press and select mode, the same on a row and a tile. */
    function bookPress(node, name) {
        node.dataset.book = name;
        if (S.select) { node.setAttribute('role', 'checkbox'); node.setAttribute('aria-checked', String(!!S.select.has(name))); }
        pressable(node, () => {
            if (S.select) { toggleSel(name); return; }
            if (settings.openInHero) { S.hero.book = name; switchMode(); return; }
            openIn({ type: 'book', book: name });
        }, S.select ? null : () => openIn({ type: 'book', book: name }, { newTab: true, background: true }));
    }

    function bookRow(name) {
        // In select mode a tap selects the row: it lights up and its book icon becomes a check mark (#42).
        const picked = !!S.select?.has(name);
        const it = el('div', `item${picked ? ' sel' : ''}`);
        const i = el('div', 'ic');
        setIcon(i, picked ? 'check' : 'book');
        const tx = el('div', 'txt');
        tx.append(el('div', 't', name), bookMeta(name));
        it.append(i, tx);
        if (!S.select) it.append(btn('more', ic('more'), () => bookMenu(name, { fromHome: true }), `${name} actions`));
        bookPress(it, name);
        perf.count('rowMounts');
        return it;
    }

    /** Home's tile view on phones: two to a row, the name on up to two lines, then the count and badges. */
    function bookTile(name) {
        const picked = !!S.select?.has(name);
        const t = el('div', `ptile${picked ? ' sel' : ''}`);
        const top = el('div', 'pt');
        const i = el('div', 'ic');
        setIcon(i, picked ? 'check' : 'book');
        top.append(i);
        if (!S.select) top.append(btn('more', ic('more'), e => { e.stopPropagation(); bookMenu(name, { fromHome: true }); }, `${name} actions`));
        t.append(top, el('div', 't', name), bookMeta(name));
        bookPress(t, name);
        perf.count('rowMounts');
        return t;
    }

    // ---------------------------------------------------------------- book page
    /**
     * The book page. A retained `.view` from the same page is reconciled: its header, chips, group heads and rows are
     * updated in place, and rows are keyed by uid, so a refresh keeps every row node and its listeners (N1a). A new
     * page gets a new view and only its rows are mounted.
     */
    function renderBook(p, view = null) {
        const v = view ?? el('div', 'view');
        if (!view) main.append(v);
        const book = p.book;
        const data = need(book);
        const lost = !library.names().includes(book) && !data;
        if (lost || !data) {
            keyed(v, [noteItem('empty', lost ? 'This book was deleted or renamed.' : loadingNote(book))], item => item.make());
            return;
        }
        const model = modelOf(book, data);
        const all = entriesShown(book, data);
        const shown = all.filter(e => S.showOff || !e.disable);
        const items = [];
        if (S.select) items.push(selectHeadItem(shown.map(e => e.uid)));
        else {
            items.push(bookHeadItem(book), bookChipsItem(book, all));
            const off = offHint(book);
            if (off) items.push({ key: 'off', make: () => off });
        }

        const groups = groupEntries(shown, sortBy(), e => entryFolder(book, e));
        for (const f of bookSettings(settings, book).folderList ?? []) if (!groups.some(([g]) => g === f)) groups.push([f, []]);
        groups.sort(([a], [b]) => (a !== '') - (b !== '') || compareText(a, b));
        for (const [g, list] of groups) {
            const key = `${book}:folder:${g}`;
            const open = !S.collapsed.has(key);
            if (g) {
                items.push(groupHeadItem(book, g, `${g} · ${list.length}`, key, open));
                if (!open) continue;
            } else if (groups.length > 1) items.push(noteItem('nofolder', 'No folder', 'section'));
            for (const e of list) items.push(entryItem(book, e.uid, model));
        }
        if (!shown.length) items.push(noteItem('empty', all.length ? 'Every entry is off, and off entries are hidden (☰ menu).' : 'No entries yet. Tap + to write the first one.'));
        const rowAt = view ? null : perf.begin('rowMount');
        keyed(v, items, item => item.make());
        perf.end(rowAt);
    }

    /** An empty note, or the "No folder" divider: one text line keyed like the other book-page children. */
    function noteItem(key, text, cls = 'empty-note') {
        return {
            key,
            make: () => el('div', cls, text),
            update: n => { n.textContent = text; },
        };
    }

    /** The book's header (Back and its name): updated in place, so its menu listener and focus survive a draw. */
    function bookHeadItem(book) {
        return {
            key: 'head',
            make() {
                const h = el('div', 'head');
                const bn = el('button', 'bkname');
                bn.type = 'button';
                bn.append(el('h1', '', book), el('span', 'car', '▾'));
                bn.addEventListener('click', () => bookMenu(book, { fromPage: true }));
                h.append(bn);
                return h;
            },
            update(h) {
                const wantBack = tab().history.length > 1;
                let backBtn = h.querySelector(':scope > [aria-label="Back"]');
                if (wantBack && !backBtn) h.prepend(btn('round flat', ic('back'), back, 'Back'));
                else if (!wantBack) backBtn?.remove();
                const bn = h.querySelector(':scope > .bkname');
                bn.querySelector('h1').textContent = book;
                bn.querySelector('.car').textContent = '▾';
            },
        };
    }

    /** Global, Links and the entry/token count: their text, class and aria update without replacing the chips. */
    function bookChipsItem(book, all) {
        const toggleGlobal = () => {
            const global = library.isGlobal(book);
            library.setGlobal(book, !global);
            layer.toast(!global ? `${book} is active everywhere` : `${book} is no longer global`);
            render();
        };
        return {
            key: 'chips',
            make() {
                const chips = el('div', 'bkchips');
                chips.append(
                    btn('chip2', html`<i class="dot"></i><span>Global</span>`, toggleGlobal, 'Active globally'),
                    btn('chip2', html`${ic('chain', 's')}<span></span>`, () => linksSheet(book), 'Links'),
                    el('span', 'bksize'),
                );
                return chips;
            },
            update(chips) {
                const global = library.isGlobal(book);
                const g = chips.children[0];
                const lk = chips.children[1];
                g.classList.toggle('on', global);
                g.setAttribute('aria-pressed', String(global));
                lk.querySelector('span').textContent = linkText(book) || 'Not linked';
                chips.children[2].textContent = `${all.length} ${all.length === 1 ? 'entry' : 'entries'} · ${tokensText(bookTokens(all))}`;
            },
        };
    }

    /** Selection's own header: kept as a node, its buttons rebuilt for the current selection. */
    function selectHeadItem(uids) {
        return {
            key: 'selhead',
            make: () => el('div', 'selhead'),
            update: h => h.replaceChildren(...selHead(uids, 'entries').childNodes),
        };
    }

    /**
     * A folder's group head. Its fold, select-all and add listener read the current state at event time; the label,
     * open class, aria and checkbox are updated on each draw.
     */
    function groupHeadItem(book, folder, text, key, open) {
        const uidsNow = () => {
            const data = library.peek(book);
            if (!data) return [];
            return entriesShown(book, data).filter(e => (S.showOff || !e.disable) && entryFolder(book, e) === folder).map(e => e.uid);
        };
        const toggle = () => {
            if (S.collapsed.has(key)) S.collapsed.delete(key); else S.collapsed.add(key);
            render();
        };
        return {
            key: `head:${key}`,
            make() {
                const s = el('div', 'section');
                const b = btn('', html`${ic('right')}<span></span>`, toggle);
                b.querySelector('span').textContent = text;
                s.append(b);
                return s;
            },
            update(s) {
                let c = s.querySelector(':scope > .check');
                if (S.select) {
                    if (!c) {
                        c = check(true);
                        c.setAttribute('role', 'checkbox');
                        c.addEventListener('click', () => {
                            const uids = uidsNow();
                            const all = uids.length && uids.every(x => S.select.has(x));
                            for (const x of uids) all ? S.select.delete(x) : S.select.add(x);
                            render();
                        });
                        s.prepend(c);
                    }
                    const uids = uidsNow();
                    const all = uids.length && uids.every(x => S.select.has(x));
                    c.classList.toggle('on', all);
                    if (all) setIcon(c, 'check'); else c.replaceChildren();
                    c.setAttribute('aria-label', `Select ${text}`);
                } else c?.remove();
                const b = s.querySelector(':scope > button');
                b.classList.toggle('open', open);
                b.setAttribute('aria-expanded', String(open));
                b.querySelector('span').textContent = text;
                let add = s.querySelector(':scope > .add');
                if (!S.select) {
                    if (!add) { add = btn('add', ic('plus', 's'), () => newEntry(book, folder), `New entry in ${folder}`); s.append(add); }
                } else add?.remove();
            },
        };
    }

    function entryItem(book, uid, model) {
        return {
            key: `entry:${uid}`,
            make: () => entryRow(book, uid),
            update: it => updateEntryRow(it, book, uid, model),
        };
    }

    /** A row's fixed shell. It keeps this node and its listeners; updateEntryRow fills in everything that changes. */
    function entryRow(book, uid) {
        const it = el('div', 'item ent');
        it.dataset.uid = uid;
        const i = el('div', 'ic');
        const tx = el('div', 'txt');
        const t = el('div', 't');
        t.append(el('span', 'nm'));
        tx.append(t, el('div', 'm'));
        it.append(i, tx);
        // The row resolves the entry at event time: a title, key words, folder or even the entry can change while
        // this node stays mounted.
        const openRow = () => {
            if (!library.peek(book)?.entries?.[uid]) return;
            if (S.select) { toggleSel(uid); return; }
            openIn({ type: 'entry', book, uid });
        };
        pressable(it, openRow, () => {
            if (S.select) { toggleSel(uid); return; }
            if (!library.peek(book)?.entries?.[uid]) return;
            openIn({ type: 'entry', book, uid }, { newTab: true, background: true });
        });
        perf.count('rowMounts');
        return it;
    }

    /** Brings a retained row's title, keys, stripe, marks, extras, switch and selection up to date. */
    function updateEntryRow(it, book, uid, model) {
        const e = library.peek(book)?.entries?.[uid];
        if (!e) return;
        const picked = !!S.select?.has(uid);
        for (const cls of [...it.classList]) if (cls.startsWith('st-')) it.classList.remove(cls);
        it.classList.add(`st-${strategyOf(e)}`);
        it.classList.toggle('sel', picked);
        if (S.select) {
            it.setAttribute('role', 'checkbox');
            it.setAttribute('aria-checked', String(picked));
        } else {
            it.removeAttribute('role');
            it.removeAttribute('aria-checked');
        }
        // Just the strategy stripe (no icon: it was the same on every row), and the check mark in selection.
        const box = it.querySelector(':scope > .ic');
        if (picked) { if (!box.firstChild) setIcon(box, 'check'); }
        else box.replaceChildren();
        const tx = it.querySelector(':scope > .txt');
        const t = tx.querySelector(':scope > .t');
        t.querySelector(':scope > .nm').textContent = titleOf(e);
        const logic = hasLogic(e, model.byStKey.get(`${book}.${uid}`));
        let ldot = t.querySelector(':scope > .ldot');
        if (logic) {
            if (!ldot) {
                ldot = el('i', 'ldot');
                t.insertBefore(ldot, t.querySelector(':scope > .bang'));
            }
            ldot.title = 'Has story logic';
        } else ldot?.remove();
        const problem = problemsOf(model, uid, book).length > 0;
        let bang = t.querySelector(':scope > .bang');
        if (problem) {
            if (!bang) { bang = el('span', 'bang', '!'); t.append(bang); }
            bang.title = 'This entry has a problem';
        } else bang?.remove();
        tx.querySelector(':scope > .m').textContent = e.constant ? 'Permanent' : `${(e.key ?? []).join(', ') || 'No key words'}${e.vectorized ? ' · vectorized' : ''}`;
        const firstOf = (...selectors) => {
            for (const sel of selectors) { const n = it.querySelector(`:scope > ${sel}`); if (n) return n; }
            return null;
        };
        // Prompt order sort: the Order parameter on the row, tap to change it.
        const wantOrder = !S.select && sortBy() === 'prompt';
        let ordb = it.querySelector(':scope > .ordb');
        if (wantOrder) {
            if (!ordb) {
                ordb = btn('ordb', '', () => orderPress(book, uid));
                it.insertBefore(ordb, firstOf('.tokn', '.switch', '.more'));
            }
            ordb.textContent = String(promptOrder(e));
            ordb.setAttribute('aria-label', `Order ${promptOrder(e)}: where ${titleOf(e)} goes in the prompt`);
        } else ordb?.remove();
        // Largest first: each row's rough size.
        const wantSize = !S.select && sortBy() === 'size';
        let tokn = it.querySelector(':scope > .tokn');
        if (wantSize) {
            if (!tokn) { tokn = el('span', 'tokn'); it.insertBefore(tokn, firstOf('.switch', '.more')); }
            tokn.textContent = `${tokenGuess(e.content)} tk`;
        } else tokn?.remove();
        const wantSwitch = !S.select;
        let sw = it.querySelector(':scope > .switch');
        if (wantSwitch) {
            if (!sw) {
                sw = swEl(false, on => library.change(book, d => {
                    const cur = d.entries?.[uid];
                    if (cur) cur.disable = !on;
                }), 'On');
                it.insertBefore(sw, firstOf('.more'));
            }
            sw.classList.toggle('on', !e.disable);
            sw.setAttribute('aria-checked', String(!e.disable));
            sw.setAttribute('aria-label', `${titleOf(e)} on`);
        } else sw?.remove();
        let more = it.querySelector(':scope > .more');
        if (wantSwitch) {
            if (!more) { more = btn('more', ic('more'), () => entryMenu(book, uid), `${titleOf(e)} actions`); it.append(more); }
            more.setAttribute('aria-label', `${titleOf(e)} actions`);
        } else more?.remove();
    }

    /** The Order button's form reads the entry again when it opens, so a retained row never edits a stale copy. */
    function orderPress(book, uid) {
        const e = library.peek(book)?.entries?.[uid];
        if (!e) return;
        layer.askText({
            title: `Order: ${titleOf(e)}`, value: String(promptOrder(e)), type: 'number',
            check: v => (Number.isInteger(Number(v)) && v.trim() !== '' ? null : 'A whole number'),
            done: v => library.change(book, d => setParam(d, uid, ORDER_PARAM, Number(v))),
        });
    }

    /**
     * New entry defaults (#43): a sheet from the menu under the book's name, not a row among the entries. Each row
     * is one of the entry page's parameters; changed ones are marked.
     */
    function defaultsSheet(book) {
        const draw = () => layer.sheet('New entry defaults', sh => {
            const defaults = bookSettings(settings, book).defaults ??= {};
            const fake = { ...defaults, extensions: defaults.by ? { wihero: { by: defaults.by } } : undefined };
            const box = el('div', 'defaults');
            sh.append(box);
            for (const p of PARAM_LIST) {
                if (p.when && !p.when(fake)) continue;
                const value = paramValue(fake, p);
                box.append(paramRow(p, paramText(fake, p), value !== p.def, () => editParam(layer, p, value, x => {
                    if (x === p.def || x === null) delete defaults[p.field]; else defaults[p.field] = x;
                    saveSettings();
                    draw();
                })));
            }
        }, { help: 'What a new entry in this book starts with.' });
        draw();
    }

    /** One line summing up a book's new entry defaults, for its menu. */
    const defaultsSummary = book => {
        const defaults = bookSettings(settings, book).defaults ?? {};
        return paramSummary({ ...defaults, extensions: defaults.by ? { wihero: { by: defaults.by } } : undefined });
    };

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
        if (on) setIcon(c, 'check');
        return c;
    }

    // ---------------------------------------------------------------- bottom bar, selection
    /**
     * The phone's bottom bar (#40): a search field filling the left half, + in the exact middle, then new folder and select spread evenly over the right half. The field opens
     * search with the cursor in it, the same search as before.
     */
    function bottomBar(p) {
        const bb = el('nav', 'bottombar');
        const book = p.type === 'book' ? p.book : null;
        const sf = btn('bsearch', html`${ic('search', 's')}<span>Search</span>`, () => { S.search = { query: '' }; render(); }, 'Search');
        bb.append(sf);
        bb.append(btn('bplus', ic('plus'), () => (book ? newEntry(book) : homePlus()), book ? 'New entry' : 'New book or import'));
        const right = el('div', 'bright');
        right.append(btn('', ic('folder'), () => (book ? newEntryFolder(book) : newBookFolder()), 'New folder'));
        right.append(btn('', ic('select'), () => { S.select = new Set(); render(); }, 'Select'));
        bb.append(right);
        return bb;
    }

    /** A new, empty book folder on Home; books go in with Select, then Move. */
    function newBookFolder() {
        layer.askText({
            title: 'New folder', placeholder: 'Folder name', ok: 'Create',
            check: f => (Object.hasOwn(settings.bookFolders, f.trim()) ? 'There is a folder with that name' : null),
            done: f => {
                const name = f.trim();
                if (!name) return;
                settings.bookFolders[name] ??= [];
                saveSettings();
                render();
                layer.toast(`${name} made. Select books and Move them in`);
            },
        });
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
                setIcon(i, h.kind === 'entry' ? 'entry' : h.kind === 'book' ? 'book' : 'folder');
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
                perf.count('rowMounts');
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
        const entryAt = perf.begin('entryPage');
        renderEntryPage(into, {
            entry: e,
            bookName: book,
            folder: entryFolder(book, e),
            layer,
            ui: new Proxy(S.ui, { set: (t, k, v) => { t[k] = v; if (k === 'condition') p.condition = v; return true; } }),
            problems: problemsOf(model, e.uid, book).map(i => i.message.replace(/^./, ch => ch.toUpperCase())),
            warnings: warningsOf(model, e.uid, book).map(i => i.message.replace(/^./, ch => ch.toUpperCase())),
            // Keyword clash marking can be turned off (☰ menu, Display); the ☰ menu's Keyword clashes row stays.
            clash: settings.markClashes === false ? null : (cl => key => cl.of(e.uid, key))(keywordClashes(data, hiddenIn(book), library.bookVersion(book))),
            lines,
            incoming: [...incoming],
            closed,
            fresh: !!p.fresh && !e.comment,
            change: (fn, quiet) => library.change(book, d => fn(d.entries[p.uid]), { quiet }),
            setParam: (param, value) => library.change(book, d => applyParam(book, d, p.uid, param, value)),
            up: nav?.up ?? up,
            hero: !!nav,
            showOnCanvas: () => showOnCanvas(book, cardKey(e)),
            onCanvas: nav ? onCanvas(book, cardKey(e)) : false,
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
        perf.end(entryAt);
    }

    return { applyParam, bottomBar, bulkEdit, check, defaultsSheet, defaultsSummary, renderBook, renderEntry, renderHome, renderSearch, selBar };
}
