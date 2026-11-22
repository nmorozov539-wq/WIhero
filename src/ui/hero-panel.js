// Hero mode's entry panel (LAYOUT "Entry panel"): every entry of the book, greetings and Moments first, with a dot
// that places it on the canvas or finds it; a dot or a desktop row dragged onto the canvas places it there.
// Moved out of app.js; it reaches the app only through the context given to it.
import { btn, el, html, pressable } from './dom.js';
import { ic } from './icons.js';
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
        createEntry, entriesShown, momentsOf, sortBy, entryFolder, chatGreetings, linkText, showOnCanvas, inspect, openHeroTab, bookPicker, heroBookMenu, deleteEntries,
        folderSheet, bulkEdit, clashCount, clashesSheet,
    } = A;
    let panelState = () => {};

    function heroPanel(book, data) {
        const desk = S.desk;
        // A selection and a scroll place belong to one book.
        if (H.pbook !== book) { H.pbook = book; H.psel = null; H.pscroll = 0; }
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
        // Select (Features 1): pick entries in the list to place, move, turn on or off, or edit together.
        // Toggled in place: a full draw would rebuild the panel button too, which then jumps.
        const sb = btn(`round flat${H.psel ? ' on' : ''}`, ic('select'), () => setSelecting(!H.psel), H.psel ? 'Leave selection' : 'Select entries');
        const setSelecting = on => {
            if (!on && H.psel) canvas()?.setPicked(new Set(), true);
            H.psel = on ? new Set() : null;
            sb.classList.toggle('on', on);
            sb.setAttribute('aria-label', on ? 'Leave selection' : 'Select entries');
            sb.title = on ? 'Leave selection' : 'Select entries';
            if (filled) fill();
        };
        ph.append(sb);
        p.append(ph);
        // Keyword clashes are about key words, so they live here with the entries, not on the canvas (Features 8).
        const clashes = clashCount(book, data);
        if (clashes) {
            const cb = btn('pclash', html`${ic('alert', 's')}<span></span>${ic('right', 's')}`, () => clashesSheet(book), 'Keyword clashes');
            cb.querySelector('span').textContent = `${clashes} keyword clash${clashes === 1 ? '' : 'es'}`;
            p.append(cb);
        }
        const list = el('div', 'plist');
        p.append(list);
        // The list keeps its place across draws, so placing entries one by one doesn't send it back to the top.
        list.addEventListener('scroll', () => { H.pscroll = list.scrollTop; }, { passive: true });
        const picked = () => [...(H.psel ?? [])].filter(u => data.entries[u]);
        const keysOf = uids => uids.map(u => cardKey(data.entries[u]));
        // Desktop and phone alike: the selected entries that are on the canvas light up there.
        const light = () => { if (H.psel) canvas()?.setPicked(new Set(keysOf(picked()).filter(k => view?.ids?.has(k))), true); };
        /** Puts entries on the canvas: at a point (one under another, from there), or each beside its partner. */
        const placeMany = (uids, at = null) => {
            const mem = canvasMemory(bookSettings(settings, book));
            keysOf(uids).forEach((key, i) => {
                const c = { ...(mem.cards[key] ?? {}), placed: true };
                if (at) Object.assign(c, { x: at.x, y: at.y + i * (CH + 24) }); else if (!view?.ids?.has(key)) { delete c.x; delete c.y; }
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
            layer.toast(uids.length === 1 ? `${titleOf(data.entries[uids[0]])} placed` : `${uids.length} entries placed. Drag any of them to move them together`);
        };
        const view = canvas().view;
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
                    tail = (all ?? []).slice(1).map(u => el('div', 'dragghost real tail', titleOf(data.entries[u])));
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
            list.innerHTML = '';
            const on = view?.ids ?? new Set();
            const needle = H.q.trim().toLowerCase();
            // Folders as a tree (Features 2): Places/Town sits inside Places.
            const tree = { path: '', kids: new Map(), entries: [], n: 0 };
            const shownEntries = [];
            for (const e of sortEntries(entriesShown(book, data), sortBy())) {
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
                        if (canvas()?.view?.m?.byId(key)?.problem) r.append(el('span', 'pbang', '!'));
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
            if (!tree.n) list.append(el('div', 'pnone', needle ? 'Nothing matches.' : 'No entries yet. Tap + to make one.'));
            const folderRows = (node, box) => {
                for (const [name, kid] of [...node.kids].sort(([a], [b]) => a.localeCompare(b))) {
                    const f = kid.path;
                    const open = !H.closedFolders.has(f) || !!needle;
                    const hd = btn(`phdr${open ? ' open' : ''}`, html`${ic('right')}<span></span><small></small>`, () => { H.closedFolders.has(f) ? H.closedFolders.delete(f) : H.closedFolders.add(f); fill(); });
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
                    r.append(d);
                    const rowMenu = () => layer.sheet(titleOf(e), sh => {
                        sh.append(layer.opt('Open entry', () => { layer.close(); openHeroTab(book, e.uid); }, { icon: 'tab', val: desk ? 'Double-click' : undefined }));
                        sh.append(layer.opt(placed ? 'Show on canvas' : 'Place on canvas', () => { layer.close(); place(); }, { icon: 'canvas' }));
                        if (placed || desk) sh.append(layer.opt('Inspect', () => { layer.close(); inspect(book, key); }, { icon: 'eye', val: desk ? 'Click' : undefined }));
                        sh.append(layer.opt('Delete', () => {
                            layer.close();
                            if (H.insp?.key === key) H.insp = null;
                            deleteEntries(book, [e.uid]);
                        }, { icon: 'trash', danger: true }));
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
                    box.append(r);
                }
            };
            folderRows(tree, list);
            shown = shownEntries;
            if (!scrolled) { scrolled = true; list.scrollTop = H.pscroll ?? 0; }
            selBar();
        };
        let shown = [];
        let scrolled = false;
        // The selection's actions, at the foot of the list: the same as Normal mode's, plus Place.
        const bar = el('div', 'pselbar');
        const selBar = () => {
            bar.innerHTML = '';
            bar.hidden = !H.psel;
            if (!H.psel) return;
            const uids = picked();
            const head = el('div', 'pselhead');
            const every = shown.length && shown.every(e => H.psel.has(e.uid));
            head.append(el('span', 'cnt', `${uids.length} selected`), btn('', every ? 'None' : 'All', () => {
                H.psel = every ? new Set() : new Set(shown.map(e => e.uid));
                fill();
                light();
            }));
            const acts = el('div', 'pselacts');
            const act = (icon, label, fn) => { const b = btn('', html`${ic(icon)}<span>${label}</span>`, fn); b.disabled = !uids.length; acts.append(b); };
            act('canvas', 'Place', () => placeMany(uids));
            act('move', 'Move', () => folderSheet(book, null, f => {
                for (const u of uids) if (data.entries[u]) setFolder(settings, book, data.entries[u], f);
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
        light();
        if (desk) {
            // The footer: the book's links and how many of its entries are on the canvas.
            const picker = btn('panelbook', html`${ic('book', 's')}<span></span>${ic('down', 's')}`, () => bookPicker(), 'Switch book');
            picker.querySelector('span').textContent = book;
            picker.title = book;
            const prow = el('div', 'panelbookrow');
            const more = btn('panelmore', ic('more', 's'), () => heroBookMenu(book), 'Book actions');
            more.title = 'Book actions';
            prow.append(picker, more);
            p.append(prow);
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
        // The footer: the book's name opens the books menu, ⋮ this book's menu; a quiet line says where it is active.
        const br = el('div', 'bookrow');
        const bp = btn('bookpick', html`<b><span></span>${ic('down', 's')}</b><small></small>`, () => bookPicker(), 'Books');
        bp.querySelector('b span').textContent = book;
        const lt = linkText(book);
        const listed = entriesShown(book, data);
        const placed = listed.filter(e => (view?.ids ?? new Set()).has(cardKey(e))).length;
        bp.querySelector('small').textContent = `${library.isGlobal(book) ? 'Global' : lt ? `Linked to ${lt}` : 'Not linked'} · ${placed} of ${listed.length} placed`;
        br.append(bp, btn('round flat', ic('more'), () => heroBookMenu(book), 'Book actions'));
        p.append(br);
        panelState();
    }

    return { heroPanel, panelState: () => panelState() };
}
