// Hero mode's entry panel (LAYOUT "Entry panel"): every entry of the book, greetings and Moments first, with a dot
// that places it on the canvas or finds it; a dot or a desktop row dragged onto the canvas places it there.
// Moved out of app.js; it reaches the app only through the context given to it.
import { btn, el, html, pressable } from './dom.js';
import { ic } from './icons.js';
import { bookSettings, cardKey, sortEntries, strategyOf, titleOf } from './data.js';
import { momentName } from './canvas-graph.js';
import { canvasMemory } from './canvas.js';
import { resizer } from './desk.js';

/**
 * @param {object} A The app's context: { S, H, main, root, layer, library, settings, saveSettings, render, canvas()
 *   (the mounted canvas or null), listShown, deskSettings, deskColumns, createEntry, entriesShown, momentsOf, sortBy,
 *   entryFolder, chatGreetings, linkText, showOnCanvas, inspect, openHeroTab, bookPicker, deleteEntries }.
 * @returns {{ heroPanel(book, data), panelState() }} panelState shows the panel open or closed as H.panel says.
 */
export function createHeroPanel(A) {
    const {
        S, H, main, root, layer, library, settings, saveSettings, render, canvas, listShown, deskSettings, deskColumns,
        createEntry, entriesShown, momentsOf, sortBy, entryFolder, chatGreetings, linkText, showOnCanvas, inspect, openHeroTab, bookPicker, deleteEntries,
    } = A;
    let panelState = () => {};

    function heroPanel(book, data) {
        const desk = S.desk;
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
        p.append(ph);
        const list = el('div', 'plist');
        p.append(list);
        const view = canvas().view;
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
                const at = drop && !off ? canvas()?.pointAt(ev.clientX, ev.clientY) : null;
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
            filled = true;
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
            if (!groups.size) list.append(el('div', 'pnone', needle ? 'Nothing matches.' : 'No entries yet. Tap + to make one.'));
            for (const f of [...groups.keys()].sort((a, b) => (a === '') - (b === '') || a.localeCompare(b))) {
                let box = list;
                if (f) {
                    const open = !H.closedFolders.has(f);
                    const hd = btn(`phdr${open ? ' open' : ''}`, html`${ic('right')}<span></span><small></small>`, () => { open ? H.closedFolders.add(f) : H.closedFolders.delete(f); fill(); });
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
                    if (desk) {
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
            }
        };
        if (desk) {
            // The footer: the book's links and how many of its entries are on the canvas.
            const picker = btn('panelbook', html`${ic('book', 's')}<span></span>${ic('down', 's')}`, () => bookPicker(), 'Switch book');
            picker.querySelector('span').textContent = book;
            picker.title = book;
            p.append(picker);
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
        const br = el('div', 'bookrow');
        const bp = btn('bookpick', html`<b><span></span>${ic('down', 's')}</b><span class="bchips"></span>`, () => bookPicker(), 'Switch book');
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

    return { heroPanel, panelState: () => panelState() };
}
