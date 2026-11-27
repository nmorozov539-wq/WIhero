// Hero mode's entry panel (LAYOUT "Entry panel"): every entry of the book, greetings and Moments first, with a dot
// that places it on the canvas or finds it; a dot or a desktop row dragged onto the canvas places it there.
// Moved out of app.js; it reaches the app only through the context given to it.
import { btn, el, html, pressable } from './dom.js';
import { ic } from './icons.js';
import { explainNode } from './explain-meta.js';
import { bookSettings, cardKey, setFolder, sortEntries, strategyOf, titleOf } from './data.js';
import { CH } from './canvas-graph.js';
import { momentName } from './canvas-graph.js';
import { canvasMemory } from './canvas.js';
import { resizer } from './desk.js';

/**
 * @param {object} A The app's context: { S, H, main, root, layer, library, settings, saveSettings, render, canvas()
 *   (the mounted canvas or null), listShown, deskSettings, deskColumns, createEntry, entriesShown, momentsOf, sortBy,
 *   entryFolder, chatGreetings, linkText, showOnCanvas, inspect, openHeroTab, bookPicker, deleteEntries, folderSheet,
 *   bulkEdit(book, uids), clashCount(book, data), clashesSheet(book) }.
 * @returns {{ heroPanel(book, data), panelState() }} panelState shows the panel open or closed as H.panel says.
 */
export function createHeroPanel(A) {
    const {
        S, H, main, root, layer, library, settings, saveSettings, render, canvas, listShown, deskSettings, deskColumns,
        createEntry, entriesShown, momentsOf, sortBy, entryFolder, chatGreetings, linkText, showOnCanvas, onCanvas, inspect, openHeroTab, bookPicker, heroBookMenu, deleteEntries,
        folderSheet, bulkEdit, clashCount, clashesSheet,
    } = A;
    let shell = null;
    let panelState = () => {};

    /**
     * Builds the panel's shell once for a book and layout: the button, the aside, its header (search, new entry,
     * select), the list and its scroll listener, the selection bar, and the footer or tool row. The per-draw data
     * lives on the returned shell and the handlers read it there.
     */
    function makeShell(book, desk) {
        const st = { book, desk, data: null, view: null, shown: [], fold: null, clash: null };
        let filled = false;

        const pb = desk
            ? btn('panelBtn', ic(listShown() ? 'left' : 'panel'), () => { H.dlist = !listShown(); render(); }, listShown() ? 'Hide the entry list' : 'Show the entry list')
            : btn('panelBtn', ic('panel'), () => { H.panel = !H.panel; panelState(); }, 'Entries');
        pb.dataset.retained = '1';
        const p = el('aside', desk ? 'panel dock' : 'panel');
        p.dataset.retained = '1';
        st.pb = pb;
        st.p = p;
        if (desk) {
            const grip = resizer(() => deskSettings().heroListW ?? 250, w => { deskSettings().heroListW = w; deskColumns(); }, { min: 200, max: 420, def: 250, side: 'right', onEnd: () => saveSettings() });
            explainNode(grip, 'shell.panel.resize');
            p.append(grip);
        }

        const ph = el('div', 'phead');
        const q = el('input');
        q.placeholder = 'Search entries';
        q.setAttribute('aria-label', 'Search entries');
        explainNode(q, 'blocked.search', { title: 'Search entries' });
        q.addEventListener('input', () => { H.q = q.value; fill(); });
        const plus = btn('round flat', ic('plus'), () => layer.askText({
            title: 'New entry', placeholder: 'Entry name', ok: 'Create',
            // Made, not placed: it waits in the panel with a hollow dot until it is placed.
            done: name => { createEntry(book, name); H.panel = true; H.q = ''; render(); layer.toast(`${name} made. Drag or tap its dot to place it`); },
        }), 'New entry');
        explainNode(plus, 'shell.panel.newEntry');
        ph.append(q);
        if (desk) ph.append(plus);
        // Select (Features 1): pick entries in the list to place, move, turn on or off, or edit together.
        // Toggled in place: a full draw would rebuild the panel button too, which then jumps.
        const sb = btn(`round flat${H.psel ? ' on' : ''}`, ic('select'), () => setSelecting(!H.psel), H.psel ? 'Leave selection' : 'Select entries');
        explainNode(sb, 'shell.panel.select', { title: 'Select entries' });
        const setSelecting = on => {
            if (!on && H.psel) canvas()?.setPicked(new Set(), true);
            H.psel = on ? new Set() : null;
            sb.classList.toggle('on', on);
            sb.setAttribute('aria-label', on ? 'Leave selection' : 'Select entries');
            sb.title = on ? 'Leave selection' : 'Select entries';
            if (filled) fill();
        };
        if (desk) ph.append(sb);
        p.append(ph);
        st.q = q;
        st.sb = sb;

        const list = el('div', 'plist');
        p.append(list);
        st.list = list;
        // The list keeps its place across draws, so placing entries one by one doesn't send it back to the top.
        list.addEventListener('scroll', () => { H.pscroll = list.scrollTop; }, { passive: true });
        const picked = () => [...(H.psel ?? [])].filter(u => st.data.entries[u]);
        const keysOf = uids => uids.map(u => cardKey(st.data.entries[u]));
        // Desktop and phone alike: the selected entries that are on the canvas light up there.
        const light = () => { if (H.psel) canvas()?.setPicked(new Set(keysOf(picked()).filter(k => st.view?.ids?.has(k))), true); };
        /** Puts entries on the canvas: at a point (one under another, from there), or each beside its partner. */
        const placeMany = (uids, at = null) => {
            const mem = canvasMemory(bookSettings(settings, book));
            keysOf(uids).forEach((key, i) => {
                const c = { ...(mem.cards[key] ?? {}), placed: true };
                if (at) Object.assign(c, { x: at.x, y: at.y + i * (CH + 24) }); else if (!st.view?.ids?.has(key)) { delete c.x; delete c.y; }
                delete c.ports;
                mem.cards[key] = c;
            });
            saveSettings();
            H.panel = false;
            H.psel = null; // done: the next tap on a row opens it again (Features 1, owner's test)
            render();
            const cv = canvas();
            if (cv && uids.length > 1) { cv.setPicked(new Set(keysOf(uids)), true); if (!at) cv.fit(); }
            else if (cv && !at) cv.centerOn(keysOf(uids)[0]);
            layer.toast(uids.length === 1 ? `${titleOf(st.data.entries[uids[0]])} placed` : `${uids.length} entries placed. Drag any of them to move them together`);
        };
        // Dragging a dot out of the panel places the card where it is dropped (or moves it there). The panel slides
        // away once the drag starts, so the whole canvas is a drop target; dropping on the red × cancels.
        const dropped = new WeakSet();
        const dragged = ev => { if (!dropped.has(ev.currentTarget)) return false; dropped.delete(ev.currentTarget); return true; };
        const dotDrag = (dot, key, title, uid = null) => {
            // A selected row drags every selected entry with it.
            // The dragged entry lands where it is dropped, the others under it in list order.
            const many = () => (uid != null && H.psel?.has(uid) && H.psel.size > 1 ? [uid, ...picked().filter(u => u !== uid)] : null);
            let tail = []; // the other picked entries' ghosts, under the first
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
                    const all = many();
                    ghost = el('div', 'dragghost', all ? `${title} +${all.length - 1}` : title);
                    tail = (all ?? []).slice(1).map(u => el('div', 'dragghost real tail', titleOf(st.data.entries[u])));
                    cancel = el('div', 'dropcancel');
                    cancel.innerHTML = ic('x');
                    cancel.setAttribute('aria-label', 'Drop here to cancel');
                    root.append(cancel, ...tail, ghost);
                    p.classList.add('closed', 'dragging');
                }
                const r = root.getBoundingClientRect();
                // Over the canvas the ghost is the card as it will land: its size at this zoom, on the grid (Features 3).
                const at = canvas()?.pointAt(ev.clientX, ev.clientY);
                const box = at && canvas().screenRect(at);
                ghost.classList.toggle('real', !!box);
                if (box) {
                    const size = { width: `${box.width}px`, height: `${box.height}px`, fontSize: `${Math.max(8, 13 * box.scale)}px` };
                    Object.assign(ghost.style, { transform: `translate(${box.left - r.left}px, ${box.top - r.top}px)`, ...size });
                    if (tail.length) ghost.textContent = title;
                    // A group shows every card, one under another, as they will land (placeMany's column).
                    tail.forEach((t, i) => Object.assign(t.style, { display: '', transform: `translate(${box.left - r.left}px, ${box.top - r.top + (i + 1) * (CH + 24) * box.scale}px)`, ...size }));
                } else {
                    Object.assign(ghost.style, { transform: `translate(${ev.clientX - r.left}px, ${ev.clientY - r.top}px)`, width: '', height: '', fontSize: '' });
                    if (tail.length) ghost.textContent = `${title} +${tail.length}`;
                    for (const t of tail) t.style.display = 'none';
                }
                const off = overCancel(ev);
                cancel.classList.toggle('over', off);
                for (const g of [ghost, ...tail]) g.classList.toggle('off', off);
            });
            const finish = (ev, drop) => {
                const g = ghost;
                const off = overCancel(ev);
                start = null;
                ghost = null;
                if (!g) return;
                g.remove();
                for (const t of tail) t.remove();
                tail = [];
                cancel.remove();
                cancel = null;
                dropped.add(dot);
                p.classList.remove('dragging');
                const at = drop && !off ? canvas()?.pointAt(ev.clientX, ev.clientY) : null;
                if (!at) { panelState(); return; }
                const all = many();
                if (all) { placeMany(all, at); return; }
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
            const top = list.scrollTop;
            list.innerHTML = '';
            const on = st.view?.ids ?? new Set();
            const needle = H.q.trim().toLowerCase();
            // Folders as a tree (Features 2): Places/Town sits inside Places.
            const tree = { path: '', kids: new Map(), entries: [], n: 0 };
            const shownEntries = [];
            for (const e of sortEntries(entriesShown(book, st.data), sortBy())) {
                if (needle && !titleOf(e).toLowerCase().includes(needle)) continue;
                shownEntries.push(e);
                let node = tree;
                node.n++;
                for (const part of entryFolder(book, e).split('/').filter(Boolean)) {
                    const path = node.path ? `${node.path}/${part}` : part;
                    if (!node.kids.has(part)) node.kids.set(part, { path, kids: new Map(), entries: [], n: 0 });
                    node = node.kids.get(part);
                    node.n++;
                }
                node.entries.push(e);
            }
            // The open chat's character's greetings (BUILD_SPEC 15.4), placed with the dot like entries. First, as the story
            // starts from them.
            const greets = chatGreetings(st.data).filter(g => !needle || g.title.toLowerCase().includes(needle) || g.text.toLowerCase().includes(needle));
            if (greets.length) {
                const open = !H.closedFolders.has('\u0000greetings');
                const hd = btn(`phdr${open ? ' open' : ''}`, html`${ic('right')}<span>Greetings</span><small></small>`, () => { open ? H.closedFolders.add('\u0000greetings') : H.closedFolders.delete('\u0000greetings'); fill(); });
                explainNode(hd, 'panel.folder', { title: 'Greetings' });
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
                        explainNode(gd, 'shell.panel.dot', { title: placed ? `Show ${g.title} on the canvas` : `Place ${g.title} on the canvas` });
                        if (desk) { dotDrag(r, g.key, g.title); r.classList.toggle('on', H.insp?.key === g.key); } else dotDrag(gd, g.key, g.title);
                        r.append(gd);
                        r.addEventListener('click', ev => { if (desk && dragged(ev)) return; inspect(book, g.key); });
                        explainNode(r, 'shell.panel.row', { title: g.title, text: desk ? `Inspects ${g.title} on the canvas. Nothing is changed.` : `Opens ${g.title} in a tab of its own. Nothing is changed.` });
                        box.append(r);
                    }
                    list.append(box);
                }
            }
            // The book's Moments (CONCEPTS 3.13), under the greetings: the only list they are in.
            const moments = sortEntries(momentsOf(book, st.data), 'az').filter(e => !needle || titleOf(e).toLowerCase().includes(needle) || (e.key ?? []).some(k => String(k).toLowerCase().includes(needle)));
            if (moments.length) {
                const open = !H.closedFolders.has('\u0000moments');
                const hd = btn(`phdr${open ? ' open' : ''}`, html`${ic('right')}<span>Moments</span><small></small>`, () => { open ? H.closedFolders.add('\u0000moments') : H.closedFolders.delete('\u0000moments'); fill(); });
                explainNode(hd, 'panel.folder', { title: 'Moments' });
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
                        if (canvas()?.view?.m?.byId(key)?.problem) r.append(el('span', 'pbang', '!'));
                        const placed = on.has(key);
                        const place = () => { if (!placed) { canvasMemory(bookSettings(settings, book)).cards[key] = { placed: true }; saveSettings(); } showOnCanvas(book, key); };
                        const gd = btn(`dotc${placed ? ' in' : ''}`, html`<i></i>`, ev => { ev.stopPropagation(); if (!dragged(ev)) place(); }, placed ? `Show ${momentName(e)} on the canvas` : `Place ${momentName(e)} on the canvas`);
                        explainNode(gd, 'shell.panel.dot', { title: placed ? `Show ${momentName(e)} on the canvas` : `Place ${momentName(e)} on the canvas` });
                        if (desk) { dotDrag(r, key, momentName(e)); r.classList.toggle('on', H.insp?.key === key); } else dotDrag(gd, key, momentName(e));
                        r.append(gd);
                        r.addEventListener('click', ev => { if (desk && dragged(ev)) return; if (placed || desk) inspect(book, key); else place(); });
                        const canOpen = placed || desk;
                        explainNode(r, canOpen ? 'shell.panel.row' : 'shell.panel.dot', canOpen
                            ? { title: momentName(e), text: desk ? `Inspects ${momentName(e)} on the canvas. Nothing is changed.` : `Opens ${momentName(e)} in a tab of its own. Nothing is changed.` }
                            : { title: momentName(e), text: `Places ${momentName(e)} on the canvas.` });
                        box.append(r);
                    }
                    list.append(box);
                }
            }
            if (!tree.n) list.append(el('div', 'pnone', needle ? 'Nothing matches.' : 'No entries yet. Tap + to make one.'));
            const folderRows = (node, box) => {
                for (const [name, kid] of [...node.kids].sort(([a], [b]) => a.localeCompare(b))) {
                    const f = kid.path;
                    const open = !H.closedFolders.has(f) || !!needle;
                    const hd = btn(`phdr${open ? ' open' : ''}`, html`${ic('right')}<span></span><small></small>`, () => { H.closedFolders.has(f) ? H.closedFolders.delete(f) : H.closedFolders.add(f); fill(); });
                    explainNode(hd, 'panel.folder', { title: name });
                    hd.querySelector('span').textContent = name;
                    hd.querySelector('small').textContent = kid.n;
                    box.append(hd);
                    if (!open) continue;
                    const inner = el('div', 'pgrp');
                    box.append(inner);
                    folderRows(kid, inner);
                }
                entryRows(node.entries, box);
            };
            const entryRows = (entries, box) => {
                for (const e of entries) {
                    const key = cardKey(e);
                    const r = el('div', `prow st-${strategyOf(e)}`);
                    r.dataset.key = key;
                    if (H.psel) {
                        // Selecting: a tap picks the row; its dot still drags, carrying every picked entry with it.
                        const on = H.psel.has(e.uid);
                        r.classList.add('selmode');
                        r.classList.toggle('sel', on);
                        r.setAttribute('role', 'checkbox');
                        r.setAttribute('aria-checked', String(on));
                        const ck = el('span', 'pck');
                        ck.innerHTML = on ? ic('check', 's') : '';
                        r.append(ck);
                    }
                    r.append(el('span', 'nm', titleOf(e)));
                    const model = canvas()?.view?.m;
                    if (model?.byId(key)?.problem) { const b = el('span', 'pbang', '!'); b.title = 'This entry has a problem'; r.append(b); }
                    const placed = on.has(key);
                    const place = () => { if (!placed) { canvasMemory(bookSettings(settings, book)).cards[key] = { placed: true }; saveSettings(); } showOnCanvas(book, key); };
                    const d = btn(`dotc${placed ? ' in' : ''}`, html`<i></i>`, ev => { ev.stopPropagation(); if (!dragged(ev)) place(); },
                        placed ? `Show ${titleOf(e)} on the canvas` : `Place ${titleOf(e)} on the canvas`);
                    explainNode(d, 'shell.panel.dot', { title: placed ? `Show ${titleOf(e)} on the canvas` : `Place ${titleOf(e)} on the canvas` });
                    r.append(d);
                    const rowMenu = () => layer.sheet(titleOf(e), sh => {
                        sh.append(layer.opt('Open entry', () => { layer.close(); openHeroTab(book, e.uid); }, { icon: 'tab', val: desk ? 'Double-click' : undefined, explain: { key: 'inspector.readEntry', title: titleOf(e) } }));
                        if (placed || desk) sh.append(layer.opt('Inspect', () => { layer.close(); inspect(book, key); }, { icon: 'eye', val: desk ? 'Click' : undefined, explain: { key: 'nav.open', title: 'Inspect', text: 'Opens this entry in the inspector. Nothing is changed.' } }));
                        sh.append(layer.opt('Delete', () => {
                            layer.close();
                            if (H.insp?.key === key) H.insp = null;
                            deleteEntries(book, [e.uid]);
                        }, { icon: 'trash', danger: true, explain: { key: 'blocked.command', title: 'Delete', text: 'Deletes this entry.' } }));
                    }, { help: desk ? null : 'Or drag its dot onto the canvas to place it where you drop it.' });
                    if (H.psel) {
                        const toggle = () => { H.psel.has(e.uid) ? H.psel.delete(e.uid) : H.psel.add(e.uid); fill(); light(); };
                        dotDrag(desk ? r : d, key, titleOf(e), e.uid);
                        r.addEventListener('click', ev => { if (desk && dragged(ev)) return; toggle(); });
                    } else if (desk) {
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
                    explainNode(r, H.psel ? 'blocked.selection' : 'shell.panel.row', H.psel
                        ? { title: titleOf(e), text: 'Picks this entry for a bulk action.' }
                        : { title: titleOf(e), text: desk ? `Inspects ${titleOf(e)} on the canvas. Nothing is changed.` : `Opens ${titleOf(e)} in a tab of its own. Nothing is changed.` });
                    box.append(r);
                }
            };
            folderRows(tree, list);
            st.shown = shownEntries;
            // The retained list clears and refills in place: keep the scroll place it had.
            list.scrollTop = top || (H.pscroll ?? 0);
            selBar();
        };
        // The selection's actions, at the foot of the list: the same as Normal mode's, plus Place.
        const bar = el('div', 'pselbar');
        const selBar = () => {
            bar.innerHTML = '';
            bar.hidden = !H.psel;
            if (!H.psel) return;
            const uids = picked();
            const head = el('div', 'pselhead');
            const every = st.shown.length && st.shown.every(e => H.psel.has(e.uid));
            const all = btn('', every ? 'None' : 'All', () => {
                H.psel = every ? new Set() : new Set(st.shown.map(e => e.uid));
                fill();
                light();
            });
            explainNode(all, 'blocked.selection', { title: every ? 'None' : 'All', text: 'Picks or unpicks every visible entry.' });
            head.append(el('span', 'cnt', `${uids.length} selected`), all);
            const acts = el('div', 'pselacts');
            const act = (icon, label, fn) => {
                const b = btn('', html`${ic(icon)}<span>${label}</span>`, fn);
                b.disabled = !uids.length;
                explainNode(b, 'blocked.command', { title: label, text: `${label} changes the selected entries or the canvas.` });
                acts.append(b);
            };
            act('canvas', 'Place', () => placeMany(uids));
            act('move', 'Move', () => folderSheet(book, null, f => {
                for (const u of uids) if (st.data.entries[u]) setFolder(settings, book, st.data.entries[u], f);
                saveSettings();
                H.psel = null;
                render();
            }));
            act('on', 'On', () => library.change(book, d => { for (const u of uids) if (d.entries[u]) d.entries[u].disable = false; }));
            act('off', 'Off', () => library.change(book, d => { for (const u of uids) if (d.entries[u]) d.entries[u].disable = true; }));
            act('edit', 'Edit…', () => bulkEdit(book, uids));
            bar.append(head, acts);
        };
        p.append(bar);

        if (desk) {
            // The footer: the book's links and how many of its entries are on the canvas.
            const picker = btn('panelbook', html`${ic('book', 's')}<span></span>${ic('down', 's')}`, () => bookPicker(), 'Switch book');
            explainNode(picker, 'shell.panel.book', { title: 'Switch book' });
            const prow = el('div', 'panelbookrow');
            const more = btn('panelmore', ic('more', 's'), () => heroBookMenu(book), 'Book actions');
            explainNode(more, 'shell.panel.bookMenu', { title: 'Book actions' });
            more.title = 'Book actions';
            prow.append(picker, more);
            p.append(prow);
            const ft = el('div', 'pfoot');
            const links = el('span', 'plinks');
            const count = el('span', 'pcount');
            ft.append(links, count);
            p.append(ft);
            st.picker = picker;
            st.links = links;
            st.count = count;
        } else {
            // Phone: a tool row over the footer, as in Obsidian's file list: Select · New entry · fold or unfold every
            // folder (only when the book has folders). New folder lives in Move's sheet, Sort by in the ☰ menu.
            const folders = () => {
                const all = new Set(settings.books?.[book]?.folderList ?? []);
                for (const e of entriesShown(book, st.data)) { const f = entryFolder(book, e); if (f) all.add(f); }
                for (const f of [...all]) { const parts = f.split('/'); for (let i = 1; i < parts.length; i++) all.add(parts.slice(0, i).join('/')); }
                return all;
            };
            st.folders = folders;
            const tools = el('div', 'ptools');
            tools.append(sb, plus);
            tools.addEventListener('contextmenu', e => { const b = e.target.closest('button'); if (b) { e.preventDefault(); layer.toast(b.getAttribute('aria-label')); } });
            p.append(tools);
            // The footer: the book's name opens the books menu, ⋮ this book's menu; a quiet line says where it is active.
            const br = el('div', 'bookrow');
            const bp = btn('bookpick', html`<b><span></span>${ic('down', 's')}</b><small></small>`, () => bookPicker(), 'Books');
            explainNode(bp, 'shell.panel.book', { title: 'Books' });
            const more = btn('round flat', ic('more'), () => heroBookMenu(book), 'Book actions');
            explainNode(more, 'shell.panel.bookMenu', { title: 'Book actions' });
            br.append(bp, more);
            p.append(br);
            st.bp = bp;
        }

        st.fill = fill;
        return st;
    }

    /** Brings the stood-in shell's labels, classes and lists up to the current draw. */
    function paint(st, book, data) {
        const desk = st.desk;
        const p = st.p;
        const pb = st.pb;
        st.data = data;
        st.view = canvas()?.view;
        const on = st.view?.ids ?? new Set();
        const clashes = clashCount(book, data);

        if (desk) {
            const shown = listShown();
            pb.innerHTML = ic(shown ? 'left' : 'panel');
            pb.classList.remove('open');
            pb.setAttribute('aria-label', shown ? 'Hide the entry list' : 'Show the entry list');
            pb.title = shown ? 'Hide the entry list' : 'Show the entry list';
            explainNode(pb, 'shell.panel', { title: shown ? 'Hide the entry list' : 'Show the entry list' });
            st.q.value = H.q;
            st.sb.classList.toggle('on', !!H.psel);
            st.sb.setAttribute('aria-label', H.psel ? 'Leave selection' : 'Select entries');
            st.sb.title = H.psel ? 'Leave selection' : 'Select entries';
            if (!shown) {
                p.remove();
                main.append(pb);
                panelState = () => {};
                return;
            }
            panelState = () => { st.fill(); p.classList.remove('closed'); };
            main.append(pb, p);
            st.picker.querySelector('span').textContent = book;
            st.picker.title = book;
            const lt = linkText(book);
            const g = library.isGlobal(book);
            st.links.innerHTML = ic(g ? 'book' : 'chain', 's');
            st.links.append(g ? 'Global' : lt || 'Not linked');
            const listed = entriesShown(book, data);
            st.count.textContent = `${listed.filter(e => on.has(cardKey(e))).length} of ${listed.length} placed`;
        } else {
            explainNode(pb, 'shell.panel', { title: 'Entries' });
            st.q.value = H.q;
            st.sb.classList.toggle('on', !!H.psel);
            st.sb.setAttribute('aria-label', H.psel ? 'Leave selection' : 'Select entries');
            st.sb.title = H.psel ? 'Leave selection' : 'Select entries';
            panelState = () => {
                if (H.panel) st.fill();
                p.classList.toggle('closed', !H.panel);
                pb.classList.toggle('open', H.panel);
                pb.innerHTML = H.panel ? ic('left') : ic('panel');
                pb.setAttribute('aria-label', H.panel ? 'Close the entry panel' : 'Entries');
                p.inert = !H.panel;
            };
            main.append(pb, p);
            const fs = st.folders();
            if (fs.size) {
                let fold = st.fold;
                if (!fold) {
                    const anyOpen = () => [...st.folders()].some(f => !H.closedFolders.has(f));
                    const label = () => (anyOpen() ? 'Fold all folders' : 'Unfold all folders');
                    fold = btn('', ic(anyOpen() ? 'foldAll' : 'unfoldAll'), () => {
                        const open = [...st.folders()].some(f => !H.closedFolders.has(f));
                        if (open) for (const f of st.folders()) H.closedFolders.add(f); else for (const f of st.folders()) H.closedFolders.delete(f);
                        fold.innerHTML = ic(open ? 'unfoldAll' : 'foldAll');
                        fold.setAttribute('aria-label', open ? 'Unfold all folders' : 'Fold all folders');
                        if (H.panel) st.fill();
                    }, label());
                    explainNode(fold, 'nav.disclosure', { title: label() });
                    st.fold = fold;
                }
                const anyOpen = () => [...st.folders()].some(f => !H.closedFolders.has(f));
                const label = () => (anyOpen() ? 'Fold all folders' : 'Unfold all folders');
                fold.innerHTML = ic(anyOpen() ? 'foldAll' : 'unfoldAll');
                fold.setAttribute('aria-label', label());
                explainNode(fold, 'nav.disclosure', { title: label() });
                if (!fold.parentNode) st.p.querySelector(':scope > .ptools').append(fold);
            } else st.fold?.remove();
            const lt = linkText(book);
            const listed = entriesShown(book, data);
            const placed = listed.filter(e => on.has(cardKey(e))).length;
            st.bp.querySelector('b span').textContent = book;
            st.bp.querySelector('small').textContent = `${library.isGlobal(book) ? 'Global' : lt ? `Linked to ${lt}` : 'Not linked'} · ${placed} of ${listed.length} placed`;
        }

        const list = st.list;
        if (clashes) {
            if (!st.clash) {
                st.clash = btn('pclash', html`${ic('alert', 's')}<span></span>${ic('right', 's')}`, () => clashesSheet(book), 'Keyword clashes');
                explainNode(st.clash, 'shell.panel.clashes', { title: 'Keyword clashes' });
            }
            st.clash.querySelector('span').textContent = `${clashes} keyword clash${clashes === 1 ? '' : 'es'}`;
            if (st.clash.nextSibling !== list) st.p.insertBefore(st.clash, list);
        } else if (st.clash) {
            st.clash.remove();
            st.clash = null;
        }
        panelState();
    }

    function heroPanel(book, data) {
        const desk = S.desk;
        // A selection and a scroll place belong to one book.
        if (H.pbook !== book) { H.pbook = book; H.psel = null; H.pscroll = 0; }
        if (shell && (shell.book !== book || shell.desk !== desk)) {
            shell.pb.remove();
            shell.p.remove();
            shell = null;
        }
        if (!shell) shell = makeShell(book, desk);
        paint(shell, book, data);
    }

    /** Terminal teardown: drops the retained panel button and aside. */
    function dispose() {
        if (shell) {
            shell.pb.remove();
            shell.p.remove();
            shell = null;
        }
    }

    return { heroPanel, panelState: () => panelState(), dispose };
}
