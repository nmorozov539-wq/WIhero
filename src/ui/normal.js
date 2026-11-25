// Normal mode's views (LAYOUT "Normal mode"): Home, the book page with its bottom bar and selection, search, and
// the entry page. Moved out of app.js; it reaches the app only through the context given to it.
import {
    MIXED, PARAM_LIST, bookFolderOf, bookSettings, cardKey, commonValue, compareText, configOf, groupEntries, idOf, paramSummary,
    bookTokens, paramText, paramValue, promptOrder, rekeyEntry, tokenGuess, tokensText, search, setBookFolder, setFolder, setParam, strategyOf, titleOf,
} from './data.js';
import { bookEditor } from './pieces.js';
import { trackerContext } from './tracker-ui.js';
import { btn, delegatePress, el, html, keyed, longPress, swEl } from './dom.js';
import { ic, setIcon } from './icons.js';
import { closedText, logicLines } from './logic-text.js';
import { keywordClashes } from './clashes.js';
import { editParam, paramRow, renderEntryPage, strategyColor } from './entry-page.js';
import { perf } from './perf.js';
import { entryStatus } from '../engine/turn.js';
import { isObject } from '../engine/util.js';
import { createListWindow, WIN_LIMIT } from './window.js';

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

    // One set of gesture listeners for every Home and book row (N2). The rows only carry a marker; the book or
    // entry is read from the row's dataset when the event happens, so a retained row never holds a stale handler.
    delegatePress(main, resolvePress);

    /** The gesture handlers for a marked row, resolved fresh at each event from its dataset. */
    function resolvePress(node) {
        if (node.dataset.press === 'book') {
            const book = node.dataset.book;
            if (!book) return null;
            return {
                onTap: () => {
                    if (S.select) { toggleSel(book); return; }
                    if (settings.openInHero) { S.hero.book = book; switchMode(); return; }
                    openIn({ type: 'book', book });
                },
                onLong: () => {
                    if (S.select) return;
                    openIn({ type: 'book', book }, { newTab: true, background: true });
                },
            };
        }
        if (node.dataset.press === 'entry') {
            const book = node.dataset.book;
            const uid = Number(node.dataset.uid);
            if (!book || !Number.isFinite(uid)) return null;
            const entry = () => library.peek(book)?.entries?.[uid];
            return {
                onTap: () => {
                    if (!entry()) return;
                    if (S.select) { toggleSel(uid); return; }
                    openIn({ type: 'entry', book, uid });
                },
                onLong: () => {
                    if (S.select) { toggleSel(uid); return; }
                    if (!entry()) return;
                    openIn({ type: 'entry', book, uid }, { newTab: true, background: true });
                },
            };
        }
        if (node.dataset.press === 'search') {
            const kind = node.dataset.kind;
            const book = node.dataset.book;
            const uid = Number(node.dataset.uid);
            const folder = node.dataset.folder;
            if (kind === 'entry' && book && Number.isFinite(uid)) {
                return {
                    onTap: () => openIn({ type: 'entry', book, uid }, { newTab: true }),
                    onLong: () => openIn({ type: 'entry', book, uid }, { newTab: true, background: true }),
                };
            }
            if (kind === 'book' && book) {
                return {
                    onTap: () => openIn({ type: 'book', book }, { newTab: true }),
                    onLong: () => openIn({ type: 'book', book }, { newTab: true, background: true }),
                };
            }
            if (kind === 'folder' && book && folder) {
                return {
                    onTap: () => { S.collapsed.delete(`${book}:folder:${folder}`); openIn({ type: 'book', book }, { newTab: true }); },
                };
            }
            if (kind === 'folder' && !book && folder) {
                return {
                    onTap: () => { S.collapsed.delete(`home:${folder}`); S.search = null; S.active = S.tabs[0].id; S.tabs[0].history = [{ type: 'home' }]; render(); },
                };
            }
            return null;
        }
        return null;
    }

    // ---------------------------------------------------------------- Home
    /**
     * Home, reconciled into a retained `.view` (N1b). The header, folder heads, rows and tiles are keyed, so a draw
     * for the same page keeps their nodes and listeners. Rows key by book name and tiles by book name inside a keyed
     * grid; switching between list and tiles uses different keys, so those nodes are rebuilt.
     */
    function renderHome(view = null) {
        const v = view ?? el('div', 'view');
        if (!view) main.append(v);
        const names = visibleNames();
        const tiles = settings.homeView === 'tiles';
        const items = [];
        if (S.select) {
            items.push({
                key: 'selhead',
                make: () => el('div', 'selhead'),
                update: h => h.replaceChildren(...selHead(names, 'books').childNodes),
            });
        } else items.push(homeHeadItem(tiles));
        items.push(noteItem('books-label', 'Books', 'section'));
        // A folder shows while it holds a book shown here, or nothing at all (a new folder, #40).
        const folders = Object.keys(settings.bookFolders).filter(f => !settings.bookFolders[f].length || settings.bookFolders[f].some(n => names.includes(n))).sort((a, b) => compareText(a, b));
        const loose = names.filter(n => !bookFolderOf(settings, n));
        homeBooks(items, loose, tiles, 'loose');
        for (const f of folders) {
            const list = settings.bookFolders[f].filter(n => names.includes(n)).sort((a, b) => compareText(a, b));
            const key = `home:${f}`;
            const open = !S.collapsed.has(key);
            items.push(homeFolderHeadItem(f, `${f} · ${list.length}`, open));
            if (open) homeBooks(items, list, tiles, `folder:${f}`);
        }
        if (!names.length) items.push(noteItem('home-empty', 'No books yet. Tap + to make the first one.'));
        const rowAt = perf.begin('rowMount');
        keyed(v, items, item => item.make());
        perf.end(rowAt);
    }

    /** Adds a list's rows, or one keyed tile grid for it. A different view type uses different keys, so it replaces. */
    function homeBooks(items, list, tiles, scope) {
        if (!tiles) {
            for (const n of list) items.push(bookRowItem(n));
            return;
        }
        if (!list.length) return;
        items.push({
            key: `tiles:${scope}`,
            make: () => el('div', 'ptiles'),
            update: g => keyed(g, list.map(n => bookTileItem(n)), item => item.make()),
        });
    }

    function bookRowItem(name) {
        return { key: `row:${name}`, make: () => bookRow(name), update: it => updateBookRow(it, name) };
    }

    function bookTileItem(name) {
        return { key: `tile:${name}`, make: () => bookTile(name), update: t => updateBookTile(t, name) };
    }

    /** Home's header: kept, with its title and the list/tiles button's icon and label updated in place. */
    function homeHeadItem(tiles) {
        // List or tiles, the phone's own choice (desktop keeps its own under settings.desk), read at click time.
        const toggle = () => {
            settings.homeView = settings.homeView === 'tiles' ? 'list' : 'tiles';
            saveSettings();
            render();
        };
        return {
            key: 'head',
            make() {
                const h = el('div', 'head');
                const viewBtn = btn('round flat', '', toggle, 'Show books as tiles');
                paintIcon(viewBtn, tiles ? 'rows' : 'grid');
                h.append(el('h1', '', 'World Info'), viewBtn, btn('round flat', ic('gear'), wiSettingsSheet, 'World Info settings'));
                return h;
            },
            update(h) {
                h.querySelector(':scope > h1').textContent = 'World Info';
                const viewBtn = h.querySelector(':scope > button');
                paintIcon(viewBtn, tiles ? 'rows' : 'grid');
                viewBtn.setAttribute('aria-label', tiles ? 'Show books as a list' : 'Show books as tiles');
            },
        };
    }

    /** A folder's head on Home. Folding and select-all read the current folder and selection at event time. */
    function homeFolderHeadItem(folder, text, open) {
        const key = `home:${folder}`;
        const current = () => (settings.bookFolders[folder] ?? []).filter(n => visibleNames().includes(n)).sort((a, b) => compareText(a, b));
        const toggle = () => {
            if (S.collapsed.has(key)) S.collapsed.delete(key); else S.collapsed.add(key);
            render();
        };
        return {
            key: `folder:${folder}`,
            make() {
                const s = el('div', 'section');
                s.append(btn('', html`${ic('right')}<span></span>`, toggle));
                return s;
            },
            update(s) {
                let c = s.querySelector(':scope > .check');
                if (S.select) {
                    if (!c) {
                        c = check(true);
                        c.setAttribute('role', 'checkbox');
                        c.addEventListener('click', () => {
                            if (!S.select) return;
                            const list = current();
                            const all = list.length && list.every(x => S.select.has(x));
                            for (const x of list) all ? S.select.delete(x) : S.select.add(x);
                            render();
                        });
                        s.prepend(c);
                    }
                    const list = current();
                    const all = list.length && list.every(x => S.select.has(x));
                    c.classList.toggle('on', all);
                    if (all) setIcon(c, 'check'); else c.replaceChildren();
                    c.setAttribute('aria-label', `Select ${folder}`);
                } else c?.remove();
                const b = s.querySelector(':scope > button');
                b.querySelector('span').textContent = text;
                b.classList.toggle('open', open);
                b.setAttribute('aria-expanded', String(open));
            },
        };
    }

    /** Entry count and status badges, shared by a book's row and its tile. */
    function bookMeta(name) {
        const m = el('div', 'm');
        const data = library.peek(name);
        const count = el('span', '', data ? `${entriesShown(name, data).length} entries` : '…');
        if (!data) countInto(name, count);
        m.append(count);
        updateBookMeta(m, name);
        return m;
    }

    /**
     * Count and badges on a retained row/tile. The count span is written only when the book is loaded here; until
     * then `countInto` owns its text, so a draw cannot put "…" back over a count that just arrived.
     */
    function updateBookMeta(m, name) {
        const count = m.querySelector(':scope > span:not(.badge)');
        const data = library.peek(name);
        if (data) count.textContent = `${entriesShown(name, data).length} entries`;
        const global = library.isGlobal(name);
        const lt = linkText(name);
        const want = [];
        if (library.unsaved?.(name)) want.push({ cls: 'u', text: 'Not saved', title: 'Saving failed. Your edits are kept here; the next change tries again' });
        if (global) want.push({ cls: 'g', text: 'Global' });
        if (lt) want.push({ cls: 'l', text: lt, icon: 'chain' });
        if (!global && !lt) want.push({ cls: 'o', text: 'Off', title: 'No chat uses it. Open the book to use it in a chat or make it global' });
        const have = new Map();
        for (const n of [...m.querySelectorAll(':scope > .badge')]) {
            const cls = [...n.classList].find(c => c !== 'badge');
            if (!cls || have.has(cls)) n.remove();
            else have.set(cls, n);
        }
        let at = count;
        for (const b of want) {
            let n = have.get(b.cls);
            if (!n) {
                n = el('span', `badge ${b.cls}`);
                if (b.icon) { setIcon(n, b.icon, 's'); n.append(el('span')); }
            }
            if (b.icon) n.querySelector(':scope > span').textContent = b.text;
            else n.textContent = b.text;
            if (b.title) n.title = b.title; else n.removeAttribute('title');
            at.after(n);
            at = n;
        }
        for (const [cls, n] of have) if (!want.some(b => b.cls === cls)) n.remove();
    }

    /** The book icon, or its check mark in select mode, replaced only when it changes. */
    function paintBookIcon(box, picked) {
        paintIcon(box, picked ? 'check' : 'book');
    }

    function paintIcon(node, name, cls = '') {
        const want = `${name}:${cls}`;
        if (node.dataset.icon === want) return;
        node.dataset.icon = want;
        setIcon(node, name, cls);
    }

    /** Marks a book row or tile for the delegated gestures and paints its current selection state. */
    function bookPress(node, name) {
        node.dataset.press = 'book';
        node.dataset.book = name;
        paintBookPress(node, name);
    }

    /** Selection's row/tile state, in place: the `sel` class and its checkbox role. */
    function paintBookPress(node, name) {
        const picked = !!S.select?.has(name);
        node.classList.toggle('sel', picked);
        if (S.select) {
            node.setAttribute('role', 'checkbox');
            node.setAttribute('aria-checked', String(picked));
        } else {
            node.removeAttribute('role');
            node.removeAttribute('aria-checked');
        }
        return picked;
    }

    function bookRow(name) {
        const it = el('div', 'item');
        const tx = el('div', 'txt');
        tx.append(el('div', 't'), bookMeta(name));
        it.append(el('div', 'ic'), tx);
        bookPress(it, name);
        perf.count('rowMounts');
        return it;
    }

    function updateBookRow(it, name) {
        const picked = paintBookPress(it, name);
        paintBookIcon(it.querySelector(':scope > .ic'), picked);
        it.querySelector(':scope > .txt > .t').textContent = name;
        updateBookMeta(it.querySelector(':scope > .txt > .m'), name);
        let more = it.querySelector(':scope > .more');
        if (S.select) { more?.remove(); return; }
        if (!more) {
            more = btn('more', ic('more'), () => bookMenu(name, { fromHome: true }), `${name} actions`);
            it.append(more);
        }
        more.setAttribute('aria-label', `${name} actions`);
    }

    /** Home's tile view on phones: two to a row, the name on up to two lines, then the count and badges. */
    function bookTile(name) {
        const t = el('div', 'ptile');
        const top = el('div', 'pt');
        top.append(el('div', 'ic'));
        t.append(top, el('div', 't'), bookMeta(name));
        bookPress(t, name);
        perf.count('rowMounts');
        return t;
    }

    function updateBookTile(t, name) {
        const picked = paintBookPress(t, name);
        paintBookIcon(t.querySelector(':scope > .pt > .ic'), picked);
        t.querySelector(':scope > .t').textContent = name;
        updateBookMeta(t.querySelector(':scope > .m'), name);
        const top = t.querySelector(':scope > .pt');
        let more = top.querySelector(':scope > .more');
        if (S.select) { more?.remove(); return; }
        if (!more) {
            more = btn('more', ic('more'), e => { e.stopPropagation(); bookMenu(name, { fromHome: true }); }, `${name} actions`);
            top.append(more);
        }
        more.setAttribute('aria-label', `${name} actions`);
    }

    // ---------------------------------------------------------------- book page
    // Windowed book list (N4a). The header, chips and selection head stay mounted; the flat group-head/row/note list
    // is materialized only around the viewport, with a spacer for each skipped run. `src/ui/window.js` owns the range
    // maths, the height cache and the focused-row pin; the estimates here are a 54 px entry row (the CSS min-height),
    // a 44 px folder head and a 96 px note. Books of 200 shown entries or fewer keep every row, as before.
    const bookWindows = new WeakMap();

    /** The mounted-height cache and window state for one retained book `.view`. */
    function bookWindow(v) {
        let win = bookWindows.get(v);
        if (!win) {
            win = createListWindow(v, { defaultHeight: 54 });
            bookWindows.set(v, win);
        }
        return win;
    }

    /** Forgets the window (a loading/empty page): the next book list starts from the whole body again. */
    function resetBookWindow(v) {
        bookWindows.get(v)?.reset();
    }

    /**
     * Draws the book page. A retained `.view` from the same page is reconciled: its header, chips, group heads and rows
     * are updated in place, and rows are keyed by uid, so a refresh keeps every row node and its listeners (N1a). A new
     * page gets a new view and only its window of rows is mounted (N4a).
     */
    function renderBook(p, view = null) {
        const v = view ?? el('div', 'view');
        if (!view) main.append(v);
        const book = p.book;
        const data = need(book);
        const lost = !library.names().includes(book) && !data;
        if (lost || !data) {
            resetBookWindow(v);
            keyed(v, [noteItem('empty', lost ? 'This book was deleted or renamed.' : loadingNote(book))], item => item.make());
            return;
        }
        const model = modelOf(book, data);
        const all = entriesShown(book, data);
        const shown = all.filter(e => S.showOff || !e.disable);
        const prefix = [];
        if (S.select) prefix.push(selectHeadItem(shown.map(e => e.uid)));
        else {
            prefix.push(bookHeadItem(book), bookChipsItem(book, all));
            const off = offHint(book);
            if (off) prefix.push({ key: 'off', make: () => off });
        }

        const body = [];
        const groups = groupEntries(shown, sortBy(), e => entryFolder(book, e));
        for (const f of bookSettings(settings, book).folderList ?? []) if (!groups.some(([g]) => g === f)) groups.push([f, []]);
        groups.sort(([a], [b]) => (a !== '') - (b !== '') || compareText(a, b));
        for (const [g, list] of groups) {
            const key = `${book}:folder:${g}`;
            const open = !S.collapsed.has(key);
            if (g) {
                body.push(groupHeadItem(book, g, `${g} · ${list.length}`, key, open));
                if (!open) continue;
            } else if (groups.length > 1) body.push(noteItem('nofolder', 'No folder', 'section'));
            for (const e of list) body.push(entryItem(book, e.uid, model));
        }
        if (!shown.length) body.push(noteItem('empty', all.length ? 'Every entry is off, and off entries are hidden (☰ menu).' : 'No entries yet. Tap + to write the first one.'));

        const rowAt = view ? null : perf.begin('rowMount');
        bookWindow(v).paint(prefix, body, body.length > WIN_LIMIT);
        perf.end(rowAt);
    }

    /** An empty note, or the "No folder" divider: one text line keyed like the other book-page children. */
    function noteItem(key, text, cls = 'empty-note') {
        return {
            key,
            est: cls === 'empty-note' ? 96 : 44,
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
            est: 44,
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
            est: 54,
            make: () => entryRow(book, uid),
            update: it => updateEntryRow(it, book, uid, model),
        };
    }

    /** A row's fixed shell. It keeps this node; updateEntryRow fills in everything that changes. */
    function entryRow(book, uid) {
        const it = el('div', 'item ent');
        it.dataset.press = 'entry';
        it.dataset.book = book;
        it.dataset.uid = uid;
        const i = el('div', 'ic');
        const tx = el('div', 'txt');
        const t = el('div', 't');
        t.append(el('span', 'nm'));
        tx.append(t, el('div', 'm'));
        it.append(i, tx);
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
                it.dataset.press = 'search';
                it.dataset.kind = h.kind;
                if (h.book) it.dataset.book = h.book;
                if (h.kind === 'entry') it.dataset.uid = h.entry.uid;
                if (h.folder) it.dataset.folder = h.folder;
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
