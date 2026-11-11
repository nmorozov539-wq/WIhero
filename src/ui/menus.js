// The sheets and menus (LAYOUT "Sheets and toasts", "⌄ menu"): the ⌄ menu, book and entry menus, snapshots,
// folders, links, problems, colors and World Info settings. Moved out of app.js; it reaches the app only through
// the context given to it.
import { el, issueText, swEl } from './dom.js';
import {
    SORT_NAMES, bookFolderOf, bookSettings, cardKey, copyBookSettings, duplicateEntry, entriesOf, entryAsText, moveEntry,
    renameBookSettings, setBookFolder, setFolder, titleOf,
} from './data.js';
import { IMPORTED, defaultSnapshotName } from './snapshots.js';
import { keywordClashes } from './clashes.js';
import { deadBranches } from '../engine/dead.js';

/** The color modes (D22), as [value, label]. */
const COLOR_MODES = [['standard', 'Standard'], ['red-green', 'Red-green safe'], ['blue-yellow', 'Blue-yellow safe']];

/**
 * @param {object} A The app's context: { H, S, back, check, deleteBooks, deleteEntries, deskSettings, entryFolder, heroMenu, hiddenIn, inspect, layer, leave, library, main, modeButton, modelOf, openIn, page, render, saveSettings, settings, showOnCanvas, snapshots, sortBy, tab, toggle, visibleNames }.
 */
export function createMenus(A) {
    const {
        H, S, back, check, defaultsSheet, defaultsSummary, deleteBooks, deleteEntries, deskSettings, entryFolder, heroMenu, hiddenIn, inspect, layer, leave, library, main, modeButton, modelOf, newEntry, openIn, page, render, saveSettings, settings, showOnCanvas, snapshots, sortBy, tab, toggle, visibleNames,
    } = A;

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
                    checkRows(sh, p.book, data);
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
            switchRow(sh, 'Mark keyword clashes', settings.markClashes !== false, v => { settings.markClashes = v; saveSettings(); render(); },
                { sub: 'Key words that fire more than one entry: outlined, with an "also fires" line, and counted on the canvas' });
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

    /** The ⌄ menu's "Keyword clashes (n) ›" and "Dead branches (n) ›" rows, when the book has any. */
    function checkRows(sh, book, data) {
        const n = keywordClashes(data, hiddenIn(book)).groups.length;
        if (n) sh.append(layer.opt(`Keyword clashes (${n})`, () => clashesSheet(book), { val: '›' }));
        const d = deadOf(book, data).length;
        if (d) sh.append(layer.opt(`Dead branches (${d})`, () => deadSheet(book), { val: '›' }));
    }

    const deadOf = (book, data) => deadBranches(modelOf(book, data), entriesOf(data).map(e => ({ ...e, world: book })));

    /**
     * The book's checks for the chip on the Hero canvas: dead branches, and keyword clashes unless their marking is
     * turned off (settings.markClashes).
     */
    function checkCounts(book, data) {
        return {
            dead: deadOf(book, data).length,
            clashes: settings.markClashes === false ? 0 : keywordClashes(data, hiddenIn(book)).groups.length,
        };
    }

    /** The chip's tap: the one sheet when only one kind is found, else both rows to pick from. */
    function checksSheet(book) {
        const data = library.peek(book);
        if (!data) return;
        const { dead, clashes } = checkCounts(book, data);
        if (dead && !clashes) { deadSheet(book); return; }
        if (clashes && !dead) { clashesSheet(book); return; }
        layer.sheet('Checks', sh => checkRows(sh, book, data));
    }

    /** What the book alone says can never happen: entries that can never fire, gate rows and masks that can never open. */
    function deadSheet(book) {
        const data = library.peek(book);
        if (!data) return;
        const found = deadOf(book, data).sort((a, b) => Number(b.dead) - Number(a.dead));
        layer.sheet(`Dead branches (${found.length})`, sh => {
            if (!found.length) sh.append(el('div', 'lbl', 'Everything in this book can happen.'));
            for (const f of found) {
                const uid = Number(f.stKey.slice(f.stKey.lastIndexOf('.') + 1));
                const why = f.reasons.join('; ');
                sh.append(layer.opt(f.label, () => {
                    layer.close();
                    const e = data.entries[uid];
                    if (!e) return;
                    if (S.mode === 'hero') { H.active = 'canvas'; showOnCanvas(book, cardKey(e)); inspect(book, cardKey(e)); } else openIn({ type: 'entry', book, uid });
                }, { sub: f.dead ? `Can never fire: ${why}` : why.replace(/^./, c => c.toUpperCase()), dot: f.dead ? 'var(--bad)' : 'var(--warn)' }));
            }
        }, { help: 'Read from the book alone, without any chat. Red: the entry can never fire. Yellow: it can, but one of its gate rows or masks never will.' });
    }

    /** Every key word that fires two or more entries, with those entries; a tap opens one. */
    function clashesSheet(book) {
        const data = library.peek(book);
        if (!data) return;
        const { groups } = keywordClashes(data, hiddenIn(book));
        const open = uid => {
            layer.close();
            const e = data.entries[uid];
            if (!e) return;
            if (S.mode === 'hero') { H.active = 'canvas'; showOnCanvas(book, cardKey(e)); inspect(book, cardKey(e)); } else openIn({ type: 'entry', book, uid });
        };
        layer.sheet(`Keyword clashes (${groups.length})`, sh => {
            if (!groups.length) sh.append(el('div', 'lbl', 'No key word fires more than one entry.'));
            for (const g of groups) {
                sh.append(el('div', 'lbl', `“${g.word}”`));
                for (const uid of g.uids) sh.append(layer.opt(titleOf(data.entries[uid]), () => open(uid), { sub: (data.entries[uid].key ?? []).join(', ') }));
            }
        }, { help: 'A key word fires every entry that has it, and a longer key fires the entries of the words inside it ("old mill" fires Mill too). Sometimes that is what you want.' });
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
                sh.append(layer.opt('New entry defaults', () => defaultsSheet(book), { icon: 'gear', sub: defaultsSummary(book) || undefined, val: '›' }));
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
            if (!ht) sh.append(layer.opt('New entry below', () => { layer.close(); newEntry(book, entryFolder(book, e), uid); }, { icon: 'plus' }));
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
            if (d.newBelow) sh.append(layer.opt('New entry below', () => { layer.close(); d.newBelow(); }, { icon: 'plus' }));
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

    return { bookFolderSheet, bookMenu, checkCounts, checkRows, checksSheet, clashesSheet, deadSheet, duplicateBook, entryMenu, folderSheet, linksSheet, moveToBookSheet, newEntryFolder, openMenu, problemsSheet, renameBook, snapshotsSheet, switchRow, wiSettingsSheet };
}
