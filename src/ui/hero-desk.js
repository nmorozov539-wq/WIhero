// Hero mode on desktop (LAYOUT "Desktop: Hero mode"): three columns (entry list, canvas, inspector), the canvas's
// mouse (card menu, picking, drag between columns) and keys, and Back. Moved out of app.js; it reaches the app only
// through the context given to it.
import { BAR } from './piecebar.js';
import { LR } from './canvas-graph.js';
import { addLink } from './links.js';
import { addToList, askNote, packsOf } from './pieces.js';
import { isMoment } from '../engine/model.js';
import { bookSettings, cardKey, configOf, isBlank, removeEntry, setFolder, sortEntries, titleOf } from './data.js';
import { btn, el } from './dom.js';
import { ic } from './icons.js';
import { canvasMemory } from './canvas.js';
import { resizer } from './desk.js';
import { strategyColor } from './entry-page.js';

/**
 * @param {object} A The app's context (destructured below): its state, the library, and the Hero mode functions
 *   the desktop layout calls (inspector, piece bar, explain mode).
 *   canvas() reads the app's current canvas.
 */
export function createHeroDesk(A) {
    const {
        H, S, barAct, barApi, barLinkMenu, chatGreetings, createEntry, dataSheet, deskSettings, dropPiece, entriesShown, hide,
        inspect, inspectorFor, layer, leave, library, main, modelOf, nodeOf, openHeroTab, openStrip, packSheet,
        placePicker, render, saveSettings, settings, shadow, showOnCanvas, sortBy, startExplain, stopExplain, typing,
        canvas,
    } = A;

    /** The entry list shows when asked; else as the size has it (widened: shown, drawer size: hidden). */
    const listShown = () => H.dlist ?? (deskSettings().heroWide !== false);
    /** The inspector shows unless hidden; in a narrow drawer it starts hidden, so the canvas keeps some room. */
    const inspShown = () => H.dinsp ?? (deskSettings().heroInsp !== false && (deskSettings().heroWide !== false || (main.clientWidth || 9999) >= 800));
    function deskColumns() {
        main.style.setProperty('--lw', listShown() ? `${deskSettings().heroListW ?? 250}px` : '0px');
        main.style.setProperty('--iw', inspShown() ? `${deskSettings().heroInspW ?? 320}px` : '0px');
    }

    function tidyNow() {
        const undo = canvas()?.tidy();
        if (undo) layer.toast('Tidied', { action: ['Undo', () => { undo(); layer.toast('Layout put back'); }] });
    }

    /** Takes the selected cards off the canvas; a card with links stays, and the toast says so. */
    function takeOffPicked(keys = canvas()?.picked() ?? []) {
        const book = H.book;
        const view = canvas()?.view;
        if (!book || !view || !keys.length) return;
        const mem = canvasMemory(bookSettings(settings, book));
        const linked = k => view.g.edges.some(x => x.from === k || x.to === k) || (view.m.byId(k)?.packs.length ?? 0) > 0;
        const off = keys.filter(k => !linked(k) && mem.cards[k]?.placed);
        const stay = keys.filter(k => linked(k));
        for (const k of off) delete mem.cards[k];
        if (off.length) { saveSettings(); H.insp = null; canvas().setPicked(new Set(), true); render(); }
        const nm = k => view.m.byId(k)?.title ?? 'It';
        if (stay.length) layer.toast(stay.length === 1 ? `${nm(stay[0])} stays: it has links. Remove them first` : `${stay.length} cards stay: they have links`);
        else if (off.length) layer.toast(off.length === 1 ? `${nm(off[0])} taken off the canvas` : `${off.length} cards taken off the canvas`);
    }

    /** Shows or hides the inspector column; on a wide window the choice is kept. */
    function setInsp(v) {
        H.dinsp = v;
        if (deskSettings().heroWide !== false) { deskSettings().heroInsp = v; saveSettings(); H.dinsp = null; }
    }

    /** What the canvas does with a mouse on desktop: left to right, link drags, menus, selection. */
    function deskCanvas(book, data) {
        return {
            desk: true,
            dir: LR,
            tools: box => {
                box.append(btn('', ic('tidy'), () => tidyNow(), 'Tidy layout (T)'));
                const t = btn('itoggle', ic('drawer'), () => { setInsp(!inspShown()); render(); }, 'Show or hide the inspector');
                t.title = 'Show or hide the inspector';
                box.append(t);
                for (const b of box.querySelectorAll('button')) b.title ||= b.getAttribute('aria-label') ?? '';
            },
            link: (kind, from, to) => {
                const x = barApi(book);
                const src = nodeOf(book, from);
                const dst = nodeOf(book, to);
                if (!src || !dst) return;
                if (kind === 'ride' && (src.t !== 'entry' || dst.t !== 'entry')) { layer.toast('Glue goes between entries.'); return; }
                const piece = { open: 'opens', close: 'closes', ride: 'glue' }[kind];
                openStrip(book, { piece, isNew: true, snap: x.snapshot(), dirty: false, note: null, src, dst: null, ...(kind === 'ride' ? { mode: 'ride' } : {}) });
                H.bar.loosePick?.(dst);
            },
            // A click on a card shows it in the inspector, opening the inspector if it was hidden (#4).
            open: (key, piece) => { if (!inspShown()) setInsp(true); inspect(book, key, piece); },
            openText: key => { if (!inspShown()) setInsp(true); inspect(book, key, null, { tab: 'text' }); },
            onPick: keys => {
                H.pick = keys;
                if (keys.length === 1) { if (!inspShown()) setInsp(true); inspect(book, keys[0]); return; }
                H.insp = null;
                heroInspector(book, data);
            },
            cardMenu: key => cardMenu(book, data, key),
            lasso: {
                entries: keys => keys.map(k => nodeOf(book, k)).filter(x => x?.t === 'entry').map(x => x.uid),
                packs: () => packsOf(data),
                pack: (uids, name) => {
                    if (barAct(book, ed => { for (const u of uids) ed.update(u, c => { c.packs = addToList(Array.isArray(c.packs) ? c.packs : [], name); }); })) layer.toast(`${uids.length} ${uids.length === 1 ? 'entry' : 'entries'} packed into #${name}`);
                },
            },
            linkMenu: (l, shaped) => barLinkMenu(book, l, shaped),
            emptyMenu: at => placePicker(book, data, at),
        };
    }

    function cardMenu(book, data, key) {
        const end = nodeOf(book, key);
        if (!end) return;
        if (end.t === 'pack') { packSheet(book, data, end.name); return; }
        const e = end.t === 'entry' ? data.entries[end.uid] : null;
        const title = e ? titleOf(e) : chatGreetings(data).find(g => g.key === key)?.title ?? 'Greeting';
        const view = canvas()?.view;
        const linked = view?.g.edges.some(x => x.from === key || x.to === key) || (view?.m.byId(key)?.packs.length ?? 0) > 0;
        layer.sheet(title, sh => {
            sh.append(layer.opt('Inspect', () => { layer.close(); inspect(book, key); }, { icon: 'eye', val: 'Click' }));
            if (e) {
                sh.append(layer.opt('Open entry', () => { layer.close(); openHeroTab(book, e.uid); }, { icon: 'tab', val: 'New tab' }));
                sh.append(layer.opt('Edit text', () => { layer.close(); inspect(book, key, null, { tab: 'text' }); }, { icon: 'edit', val: 'Double-click' }));
            }
            sh.append(el('div', 'lbl', 'Add piece'));
            for (const p of BAR) sh.append(layer.opt(p.label, () => { layer.close(); dropPiece(book, p.k, { card: key }); }, { dot: `var(--p-${p.c})`, val: p.key }));
            if (e && !isMoment(e)) {
                const note = configOf(e)?.note;
                sh.append(layer.opt(note ? 'Edit note' : 'Add note', () => { layer.close(); askNote(layer, library, book, e.uid, note); }, { icon: 'edit', sub: note || 'Only for you: never sent to the model' }));
            }
            if (e) sh.append(layer.opt('Data', () => { layer.close(); dataSheet(e); }, { icon: 'code' }));
            sh.append(layer.opt('Take off canvas', () => { layer.close(); takeOffPicked([key]); }, { icon: 'trash', val: linked ? 'Remove its links first' : 'Del', cls: linked ? 'muted' : undefined }));
        });
    }

    /** The right column: the card's inspector, the selected cards, or the book. */
    function heroInspector(book, data) {
        main.querySelector('.hinsp')?.remove();
        main.querySelector('.insp')?.remove();
        deskColumns();
        if (!inspShown()) return;
        const col = el('aside', 'hinsp');
        main.append(col);
        col.append(resizer(() => deskSettings().heroInspW ?? 320, w => { deskSettings().heroInspW = w; deskColumns(); }, { min: 260, max: 560, def: 320, side: 'left', onEnd: () => saveSettings() }));
        if (H.insp?.book === book) {
            inspectorFor(book, data, col);
            if (H.insp) return;
        }
        const picked = (canvas()?.picked() ?? []).filter(k => nodeOf(book, k));
        if (picked.length > 1) groupPane(col, book, data, picked);
        else bookPane(col, book, data);
    }

    function bookPane(col, book, data) {
        const sh = el('div', 'insp book');
        const body = el('div', 'ibody');
        sh.append(body);
        col.append(sh);
        const head = el('div', 'ihead');
        head.append(el('h2', '', book));
        body.append(head);
        const issues = modelOf(book, data).issues;
        body.append(el('div', 'lbl', 'Problems'));
        if (!issues.length) body.append(el('p', 'help', 'No problems in this book.'));
        for (const i of [...issues.filter(x => !x.warning), ...issues.filter(x => x.warning)]) {
            const uid = i.stKey ? Number(i.stKey.slice(i.stKey.lastIndexOf('.') + 1)) : null;
            body.append(layer.opt(i.label, () => {
                const x = uid === null ? null : data.entries[uid];
                if (x) { showOnCanvas(book, cardKey(x)); inspect(book, cardKey(x)); }
            }, { sub: i.message, dot: i.warning ? 'var(--warn)' : 'var(--bad)' }));
        }
        body.append(el('div', 'lbl', 'Links'));
        const lg = el('div', 'ilegend');
        for (const [v, label, dashed] of [['open', 'Opens: waits for, then opens'], ['close', 'Closes', true], ['glue', 'Glue: rides along'], ['mask', 'Masks (stacked cards)'], ['pack', 'Pack frame', true]]) {
            const r = el('span');
            r.style.color = `var(--p-${v})`;
            r.append(el('i', dashed ? 'd' : ''), el('span', '', label));
            lg.append(r);
        }
        body.append(lg);
        body.append(el('div', 'lbl', 'Mouse'));
        body.append(el('p', 'help', 'Rest the pointer on a card to see its links. Click to inspect, double-click to edit its text. Drag a card to move it, drag empty space to pan, Shift-drag to select several. The wheel zooms. Drag a colored port or a handle under a card onto another card to link them. Right-click a card or the canvas for more.'));
    }

    function groupPane(col, book, data, keys) {
        const ends = keys.map(k => nodeOf(book, k));
        const uids = ends.filter(x => x?.t === 'entry').map(x => x.uid);
        const names = keys.map(k => canvas()?.view?.m.byId(k)?.title ?? k);
        const sh = el('div', 'insp group');
        const body = el('div', 'ibody');
        sh.append(body);
        col.append(sh);
        const head = el('div', 'ihead');
        head.append(el('h2', '', `${keys.length} cards selected`), btn('round flat', ic('x'), () => { canvas()?.setPicked(new Set()); }, 'Clear the selection'));
        body.append(head);
        body.append(el('p', 'help', `${names.join(', ')}. Drag any of them to move them together.`));
        const act = (label, icon, fn) => body.append(layer.opt(label, fn, { icon }));
        act('Pack into…', 'tag', () => layer.sheet('Pack into', s2 => {
            const pack = name => {
                layer.close();
                if (barAct(book, ed => { for (const u of uids) ed.update(u, c => { c.packs = addToList(Array.isArray(c.packs) ? c.packs : [], name); }); })) layer.toast(`${uids.length} entries packed into #${name}`);
            };
            for (const p of packsOf(data)) s2.append(layer.opt(`#${p}`, () => pack(p), { icon: 'tag' }));
            s2.append(layer.opt('New pack…', () => layer.askText({
                title: 'New pack', placeholder: 'Pack name (town/inn for one inside another)', ok: 'Add',
                check: v => (/^[A-Za-z0-9][A-Za-z0-9_.\-/]*$/.test(v.replace(/^#/, '')) ? null : 'Letters, numbers, - _ . and / only'),
                done: v => pack(v.replace(/^#/, '')),
            }), { icon: 'plus' }));
        }));
        // Hold the group back until one card fires: each selected card waits for it (and for what it already waits for).
        act('Make these wait for…', 'canvas', () => layer.sheet(`Which card do these ${uids.length} wait for?`, s2 => {
            for (const x of sortEntries(entriesShown(book, data), sortBy()).filter(x => !uids.includes(x.uid))) {
                s2.append(layer.opt(titleOf(x), () => {
                    layer.close();
                    const src = { t: 'entry', uid: x.uid };
                    if (barAct(book, (ed, d) => { for (const u of uids) addLink(ed, d, 'open', src, { t: 'entry', uid: u }, { join: 'and' }); })) layer.toast(`${uids.length} entries wait for ${titleOf(x)}`);
                }, { dot: strategyColor(x) }));
            }
        }, { help: 'They open once it has fired.' }));
        act('Make one wait for all of these…', 'canvas', () => layer.sheet('Which card waits for all of them?', s2 => {
            for (const x of sortEntries(entriesShown(book, data), sortBy()).filter(x => !uids.includes(x.uid))) {
                s2.append(layer.opt(titleOf(x), () => {
                    layer.close();
                    const dst = { t: 'entry', uid: x.uid };
                    if (barAct(book, (ed, d) => { for (const u of uids) addLink(ed, d, 'open', { t: 'entry', uid: u }, dst, { join: 'and' }); })) layer.toast(`${titleOf(x)} waits for all ${uids.length}`);
                }, { dot: strategyColor(x) }));
            }
        }, { help: 'It opens once every selected entry has fired.' }));
        act('Turn off', 'on', () => {
            library.change(book, d => { for (const u of uids) if (d.entries[u]) d.entries[u].disable = true; });
            layer.toast(`${uids.length} entries turned off`);
        });
        act('Take off canvas', 'trash', () => takeOffPicked(keys));
    }

    function heroKey(e) {
        const k = e.key;
        const ctrl = e.ctrlKey || e.metaKey;
        if (ctrl && !e.altKey && k.toLowerCase() === 'k') { S.search = { query: S.search?.query ?? '', at: 0 }; render(); return true; }
        if (S.search || layer.isOpen() || typing() || ctrl || e.altKey) return false;
        if (H.active !== 'canvas' || !canvas() || !H.book) return false;
        const book = H.book;
        const up = k.length === 1 ? k.toUpperCase() : k;
        if (k === '?') { H.explain ? stopExplain() : startExplain(); return true; }
        // A drawn link's strip is open: 1–4 pick the line type, X flips it, Delete takes away the picked dot.
        const shp = H.bar.edit ? canvas().shapeState?.() : null;
        if (shp && !e.shiftKey) {
            const type = { 1: 'curve', 2: 'arc', 3: 'straight', 4: 'step' }[k];
            if (type) { canvas().patchShape({ type }); return true; }
            if (up === 'X') { canvas().patchShape({ flip: !shp.flip }); return true; }
            if ((k === 'Delete' || k === 'Backspace') && shp.dot != null) { canvas().removeShapeDot(); return true; }
        }
        const piece = !e.shiftKey && BAR.find(p => p.key === up);
        if (piece) {
            if (H.bar.edit) return false;
            const sel = canvas().picked();
            if (sel.length === 1) { dropPiece(book, piece.k, { card: sel[0] }); return true; }
            H.bar.armed = H.bar.armed === piece.k ? null : piece.k;
            render();
            return true;
        }
        if (up === 'F') { canvas().fit(); return true; }
        if (up === 'T') { tidyNow(); return true; }
        if (k === '+' || k === '=') { canvas().zoomAt(1.2); return true; }
        if (k === '-') { canvas().zoomAt(1 / 1.2); return true; }
        if (k === '/') { H.dlist = true; render(); main.querySelector('.panel .phead input')?.focus(); return true; }
        if (k === 'Delete' || k === 'Backspace') { takeOffPicked(); return true; }
        return false;
    }

    /** Esc on desktop: menu, search, armed piece, strip (Cancel), text box, selection, then closes WI Hero. */
    function heroBackDesk() {
        if (S.search) { S.search = null; render(); return true; }
        if (H.active === 'canvas') {
            if (H.bar.armed) { H.bar.armed = null; render(); return true; }
            if (H.bar.edit) {
                const ed = H.bar.edit;
                if (ed.dirty) barApi(ed.book).restore(ed.snap);
                H.bar.edit = null;
                H.bar.loosePick = null;
                render();
                return true;
            }
        }
        if (typing()) { shadow.activeElement?.blur(); return true; }
        if (H.active === 'canvas' && (H.insp || canvas()?.picked().length)) {
            H.insp = null;
            canvas()?.setPicked(new Set(), true);
            render();
            return true;
        }
        if (H.active === 'preview' && H.pv?.page) { H.pv.page = null; render(); return true; }
        hide();
        return false;
    }
    /** Discards a new entry left completely empty when the book pane moves on from it. */
    function leaveEntry(p) {
        if (p.fresh == null || p.fresh !== p.sel) return;
        const uid = p.fresh;
        p.fresh = null;
        const e = library.peek(p.book)?.entries[uid];
        if (e && isBlank(e)) { library.change(p.book, d => { removeEntry(d, uid); }, { quiet: true }); layer.toast('Empty entry removed'); }
    }
    /** A new entry in a book (and folder), with the book's defaults, not opened anywhere yet. */
    function createEntryIn(book, folder = '') {
        if (!library.peek(book)) return null;
        const x = createEntry(book, '');
        if (folder) { setFolder(settings, book, x, folder); saveSettings(); }
        return x;
    }
    function openHero(book) {
        leave();
        H.book = book;
        S.mode = 'hero';
        S.select = null;
        S.search = null;
        H.active = 'canvas';
        H.panel = false;
        render();
    }

    return { createEntryIn, deskCanvas, deskColumns, heroBackDesk, heroInspector, heroKey, inspShown, leaveEntry, listShown, openHero, tidyNow };
}
