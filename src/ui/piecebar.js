// The piece bar (LAYOUT "Piece bar", pieces-one-by-one): chips at the bottom of the canvas. Tap a chip and then
// a card, or drag the chip onto a card; the bar turns into the piece's strip, Cancel on the left and Done on the
// right. Tapping a line or a lock later opens its strip again, with Remove. Everything is written as it is set
// up (so the canvas shows it), and Cancel puts the book back as it was when the strip opened.
import { btn, el, html, swEl } from './dom.js';
import { ic } from './icons.js';
import { maskName, refLabel, same } from './pieces.js';
import * as L from './links.js';
import { addMoment } from './data.js';

/** The chips, in bar order; the divider sits before the conditions. */
export const BAR = [
    { k: 'opens', label: 'Opens', c: 'open', kind: 'open', key: 'O' },
    { k: 'closes', label: 'Closes', c: 'close', kind: 'close', key: 'C' },
    { k: 'glue', label: 'Glue', c: 'glue', kind: 'ride', key: 'G' },
    { k: 'switch', label: 'Switch', c: 'close', key: 'S' },
    { k: 'mask', label: 'Mask', c: 'mask', key: 'M' },
    { k: 'pack', label: 'Pack', c: 'pack', key: 'P' },
    { k: 'lock', label: 'Lock', c: 'cond', cond: true, key: 'L' },
    { k: 'wait', label: 'Wait', c: 'cond', cond: true, key: 'W' },
    { k: 'moment', label: 'Moment', c: 'cond', key: 'E' },
];
const CHIP = Object.fromEntries(BAR.map(p => [p.k, p]));
const FIELD = { gin: 'gate', cin: 'closeGate', mgin: 'gate', mcin: 'closeGate' };
const colorOf = k => `var(--p-${CHIP[k]?.c ?? k})`;
const KIND_PIECE = { open: 'opens', close: 'closes', ride: 'glue' };

/** What the armed chip's banner asks for. Opens and Closes start from the source, the card doing the verb. */
export function armText(k, verb = 'Tap') {
    if (k === 'opens') return `${verb} the card that opens something`;
    if (k === 'closes') return `${verb} the card that closes something`;
    if (k === 'moment') return `${verb} a card that reacts to a new Moment, or empty canvas for one on its own`;
    return `${verb} ${CHIP[k]?.cond ? 'a card, a line or a junction' : 'a card'} to add ${CHIP[k]?.label ?? k}`;
}

/** Why a chip can't go on a card, or null. Opens and Closes take any card; the rest take entries. */
function whyNotOn(k, end) {
    if (!end) return 'That card is gone.';
    if (k === 'opens' || k === 'closes') return null;
    if (k === 'moment') return end.t === 'entry' && !end.moment ? null : 'A Moment reacts on an entry: it opens or closes it.';
    // A Moment only happens: nothing rides along with it, and it has no paths or masks (#16). Armed, these dim it.
    if (end.moment && k === 'glue') return 'A Moment sends nothing, so nothing rides along with it.';
    if (end.moment && (k === 'switch' || k === 'mask')) return `A Moment sends nothing, so it can't take ${k === 'mask' ? 'a mask' : 'a switch'}.`;
    if (end.t === 'greet') return 'A greeting only starts things. It can be the start of an Opens or a Closes line.';
    if (end.t === 'pack') return k === 'lock' || k === 'wait' ? 'A pack has no gate of its own. Put the lock or wait on a line into it, or on an entry.' : 'Packs take Opens and Closes lines. This piece goes on an entry.';
    return null;
}

/**
 * Mounts the bar (or the open piece's strip) under the canvas. Called on every Hero render; what is being set
 * up lives in `x.B` ({ armed, edit }), so it survives the redraws a book change causes.
 * @param {object} x { B, main, root, canvas, layer, data(), act(fn) → bool, snapshot(), restore(snap), render(),
 *   nodeOf(key), keyOf(end), nameOf(end), nameOfId(id), candidates(), packs(), closersOf(uid), openMask(uid, name),
 *   showMask(uid, name), inspect(key, piece), folded(), setFolded(v), toast(text) }
 */
export function mountPieceBar(x) {
    const { B, canvas } = x;
    const bottom = el('div', `pbar${x.folded() && !B.edit ? ' folded' : ''}`);
    x.main.append(bottom);
    const ed = () => x.editor();
    const data = () => x.data();
    const say = (...parts) => {
        const n = el('div', 'say');
        for (const p of parts) n.append(typeof p === 'string' ? p : el('b', '', p.b));
        return n;
    };
    const name = end => x.nameOf(end);
    const refText = ref => refLabel(ref, x.nameOfId).text;

    // ---------------------------------------------------------------- the bar
    if (!B.edit) {
        const fold = btn('pfold', ic('down', 's'), () => { x.setFolded(!x.folded()); B.armed = null; x.render(); }, x.folded() ? 'Show the piece bar' : 'Fold the piece bar');
        bottom.append(fold);
        if (x.folded()) { canvas.overlay(null); return; }
        const bar = el('div', 'pchips');
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', 'Pieces');
        bottom.append(bar);
        for (const p of BAR) {
            if (p.k === 'lock') bar.append(el('span', 'pdiv'));
            const b = el('button', `pchip${B.armed === p.k ? ' armed' : ''}`);
            b.type = 'button';
            b.style.setProperty('--c', colorOf(p.k));
            b.append(el('i'), el('span', '', p.label));
            if (x.desk) { b.append(el('kbd', '', p.key)); b.title = `${p.label} (${p.key})`; }
            b.dataset.piece = p.k;
            b.setAttribute('aria-pressed', String(B.armed === p.k));
            chipGestures(b, p.k);
            bar.append(b);
        }
        // Desktop: a hint. Both layouts: while a chip is armed, a banner that says what to tap, with Cancel.
        if (x.desk) bar.append(el('span', 'phint dhint', 'Or drag from a card\'s port to another card'));
        if (B.armed) bottom.prepend(armBanner(B.armed));
        armOverlay();
        return;
    }

    function armBanner(k) {
        const ban = el('div', 'armban');
        ban.style.setProperty('--c', colorOf(k));
        ban.append(el('span', '', armText(k, x.desk ? 'Click' : 'Tap')), btn('pbtn sm', 'Cancel', () => { B.armed = null; x.render(); }));
        ban.setAttribute('role', 'status');
        return ban;
    }

    function armOverlay() {
        canvas.overlay(B.armed ? { dim: key => !!whyNotOn(B.armed, x.nodeOf(key)) } : null);
        for (const c of bottom.querySelectorAll('.pchip')) { const on = c.dataset.piece === B.armed; c.classList.toggle('armed', on); c.setAttribute('aria-pressed', String(on)); }
    }

    /** Tap to arm (tap again to disarm), or drag onto the canvas. A sideways swipe scrolls the bar instead. */
    function chipGestures(chip, k) {
        let start = null;
        let ghost = null;
        let cancel = null;
        const overCancel = ev => {
            const r = cancel?.getBoundingClientRect();
            return !!r && Math.hypot(ev.clientX - (r.left + r.width / 2), ev.clientY - (r.top + r.height / 2)) <= r.width / 2 + 16;
        };
        const clean = () => { ghost?.remove(); cancel?.remove(); ghost = null; cancel = null; start = null; canvas.markTarget(null); };
        chip.addEventListener('pointerdown', ev => {
            if (ev.button) return;
            start = { x: ev.clientX, y: ev.clientY };
            chip.setPointerCapture?.(ev.pointerId);
        });
        chip.addEventListener('pointermove', ev => {
            if (!start) return;
            if (!ghost && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 8) return;
            if (!ghost) {
                ghost = el('div', 'dragchip');
                ghost.style.setProperty('--c', colorOf(k));
                ghost.append(el('i'), el('span', '', CHIP[k].label));
                cancel = el('div', 'dropcancel');
                cancel.innerHTML = ic('x');
                x.root.append(cancel, ghost);
                B.armed = k;
                armOverlay();
            }
            const r = x.root.getBoundingClientRect();
            ghost.style.transform = `translate(${ev.clientX - r.left}px, ${ev.clientY - r.top}px)`;
            const off = overCancel(ev);
            cancel.classList.toggle('over', off);
            ghost.classList.toggle('off', off);
            const h = off ? null : canvas.hitAt(ev.clientX, ev.clientY);
            canvas.markTarget(h?.card && !whyNotOn(k, x.nodeOf(h.card)) ? h : null);
        });
        chip.addEventListener('pointerup', ev => {
            if (!start) return;
            if (!ghost) {
                start = null;
                B.armed = B.armed === k ? null : k;
                // Phones keep the bar (and how far it is scrolled) and only swap the banner.
                if (x.desk) x.render(); else { armOverlay(); bottom.querySelector('.armban')?.remove(); if (B.armed) bottom.prepend(armBanner(B.armed)); }
                return;
            }
            const off = overCancel(ev);
            const h = off ? null : canvas.hitAt(ev.clientX, ev.clientY);
            clean();
            B.armed = null;
            armOverlay();
            // A Moment can stand on its own: off a card, it is made where it was dropped.
            if (k === 'moment' && !off && !h?.card) { const at = canvas.pointAt(ev.clientX, ev.clientY); if (at) x.place(k, null, at); }
            else if (h) x.place(k, h);
        });
        // The browser took the gesture (a sideways scroll of the bar): take away everything the drag drew.
        chip.addEventListener('pointercancel', () => { const was = !!ghost; clean(); if (was) { B.armed = null; armOverlay(); } });
    }

    // ---------------------------------------------------------------- the strip
    const e = B.edit;
    const left = btn('pbtn', 'Cancel', () => cancelEdit());
    const mid = el('div', 'pmid');
    const right = btn('pbtn done', 'Done', () => finish());
    const strip = el('div', 'pstrip');
    strip.style.setProperty('--c', colorOf(e.piece));
    // "?" opens this piece's page in the Guide.
    const help = x.guide ? btn('pbtn sq pq', ic('help', 's'), () => x.guide(e.piece), `How ${CHIP[e.piece]?.label ?? 'this piece'} works`) : null;
    strip.append(left, mid, ...(help ? [help] : []), right);
    bottom.append(strip);
    const note = () => { if (e.note) mid.append(el('div', `pnote${e.noteBad ? ' bad' : ''}`, e.note)); };
    const row = (...kids) => { const r = el('div', 'prow2'); r.append(...kids); return r; };
    const seg = (choices, cur, pick, label) => {
        const s = el('div', 'pseg');
        s.setAttribute('role', 'radiogroup');
        if (label) s.setAttribute('aria-label', label);
        for (const [v, text] of choices) {
            const b = btn(cur === v ? 'on' : '', '', () => pick(v));
            b.textContent = text;
            b.setAttribute('role', 'radio');
            b.setAttribute('aria-checked', String(cur === v));
            s.append(b);
        }
        return s;
    };
    const small = (text, fn, cls = '') => { const b = btn(`pbtn sm ${cls}`, '', fn); b.textContent = text; return b; };
    const removeBtn = fn => { const b = small('Remove', fn, 'bad'); b.prepend(Object.assign(el('span', 'ri'), { innerHTML: ic('trash', 's') })); return b; };
    /** A picker for the other end, beside the loose end. */
    const picker = (label, ok, pick) => {
        const s = el('select', 'ppick');
        s.setAttribute('aria-label', label);
        s.append(new Option(label, ''));
        for (const c of x.candidates()) if (ok(c.end)) s.append(new Option(c.title, c.key));
        s.addEventListener('change', () => { if (s.value) pick(x.nodeOf(s.value)); });
        return s;
    };
    const run = fn => { const ok = x.act(fn); if (ok) e.dirty = true; return ok; };
    const refuse = why => { e.note = why; e.noteBad = true; x.render(); };

    if (e.piece === 'opens' || e.piece === 'closes' || (e.piece === 'glue' && e.mode === 'ride')) linkStrip();
    else if (e.piece === 'glue') glueStrip();
    else if (e.piece === 'switch') switchStrip();
    else if (e.piece === 'lock' || e.piece === 'wait') condStrip();
    else if (e.piece === 'mask') maskStrip();
    else if (e.piece === 'pack') packStrip();

    // ---- Opens, Closes, Glue (ride along)
    function linkStrip() {
        const kind = CHIP[e.piece].kind;
        if (e.piece === 'glue') mid.append(glueChoice());
        // The source comes first, doing the verb: "Road opens Mill" (and, quieter, "Mill waits for Road").
        const sentence = (src, dst) => (kind === 'open' ? [src, ' opens ', dst] : kind === 'close' ? [src, ' closes ', dst] : [dst, ' rides along with ', src]);
        const echo = (srcText, dstText) => { const n = el('span', 'pecho'); n.textContent = ` · ${dstText} waits for ${srcText}`; return n; };
        const words = (end, dots) => (end ? { b: name(end) } : dots);
        if (!e.linked) {
            const fixed = e.src ?? e.dst;
            mid.append(say(...sentence(e.src, e.dst).map(p => (typeof p === 'string' ? p : words(p, '…')))));
            const ok = end => !L.whyNot(kind, e.src ?? end, e.dst ?? end) && !L.sameEnd(end, fixed);
            const tap = x.desk ? 'click' : 'tap';
            const lead = kind === 'ride' ? 'Drag the loose end onto a card, or' : `Now ${tap} the card it ${kind === 'open' ? 'opens' : 'closes'}, drag the loose end onto it, or`;
            mid.append(row(el('span', 'phint', lead), picker('pick one', ok, linkTo)));
            note();
            right.disabled = true;
            loose(fixed, kind === 'ride' ? 'glue' : kind === 'close' ? 'close' : 'open', end => ok(end), linkTo);
            return;
        }
        const E = ed();
        const D = data();
        const flip = btn('pbtn flipb', '⇄', () => flipIt(), 'Turn the link around');
        const whyFlip = L.whyNotFlip(E, D, kind, e.src, e.dst, e.mask ?? null);
        if (whyFlip) { flip.classList.add('no'); flip.title = whyFlip; }
        const parts = sentence(e.src, e.dst).map(p => (typeof p === 'string' ? p : { b: name(p) }));
        // A pack source: how many of it.
        if (e.src.t === 'pack' && e.dst.t === 'entry') {
            const mode = L.readingOf(E, D, kind, e.src, e.dst);
            parts.splice(0, 1, { b: `${mode === 'all' ? 'all' : mode === 'any' ? 'any' : mode} of #${e.src.name}` });
            const n = el('input', 'pnum');
            n.type = 'number'; n.min = '2'; n.value = typeof mode === 'number' ? String(mode) : '2';
            n.setAttribute('aria-label', 'How many of the pack');
            const set = v => run((ed2, d2) => L.setReading(ed2, d2, kind, e.src, e.dst, v));
            n.addEventListener('change', () => { const v = Math.max(1, Math.round(Number(n.value) || 2)); set(v); });
            const s1 = say(...parts);
            if (kind === 'open') s1.append(echo(parts[0].b, name(e.dst)));
            mid.append(row(s1, flip));
            mid.append(row(seg([['any', 'any one'], ['all', 'all'], ['n', 'a number']], typeof mode === 'number' ? 'n' : mode, v => set(v === 'n' ? Math.max(2, Number(n.value) || 2) : v), 'How many of the pack'), ...(typeof mode === 'number' ? [n] : [])));
        } else {
            const s1 = say(...parts);
            if (kind === 'open') s1.append(echo(name(e.src), name(e.dst)));
            mid.append(row(s1, flip));
        }
        // Several links into one card: both, or either one.
        if (kind !== 'ride' && e.dst.t === 'entry') {
            const loc = L.findLink(E, D, kind, e.src, e.dst, e.mask ?? null);
            if (loc?.t === 'row') {
                const rows = L.rowsOf(E.config(e.dst.uid), loc.field, loc.mask);
                const others = rows.flatMap((r, i) => r.filter((y, j) => !(i === loc.row && j === loc.j) && !L.isCond(y))).map(refText);
                if (others.length) {
                    const cur = e.ask ? null : L.rowOf(E, loc).lone ? 'or' : 'and';
                    const list = [...new Set(others)].join(', ');
                    mid.append(seg([['and', `and ${list} (both)`], ['or', `or ${list} (either one)`]], cur, v => { e.ask = false; run((ed2, d2) => L.setJoin(ed2, d2, kind, e.src, e.dst, v, e.mask ?? null)); }, 'Both or either'));
                    if (e.ask) mid.append(el('div', 'phint', `${name(e.dst)} already waits for something. Pick both or either one.`));
                }
                const conds = L.rowOf(E, loc).conds;
                if (conds.length) mid.append(el('div', 'phint', `Then: ${conds.map(refText).join(', then ')}`));
            }
        }
        // The story moves on: the source closes when the waiting card fires.
        if (kind === 'open' && e.src.t === 'entry' && e.dst.t === 'entry' && e.mask == null) {
            const on = !!L.findLink(E, D, 'close', e.dst, e.src);
            mid.append(row(swEl(on, v => run((ed2, d2) => (v ? L.addLink(ed2, d2, 'close', e.dst, e.src) : L.removeLink(ed2, d2, 'close', e.dst, e.src))), `${name(e.src)} closes when ${name(e.dst)} fires`),
                el('span', 'plabel2', `${name(e.src)} closes when ${name(e.dst)} fires`)));
        }
        const tools = shapeRow();
        note();
        // The shape's buttons share a row with the link's Remove, so the strip stays short on a phone.
        if (!e.isNew) tools.push(removeBtn(() => { x.act((ed2, d2) => L.removeLink(ed2, d2, kind, e.src, e.dst, e.mask ?? null)); close('Link removed'); }));
        if (tools.length) mid.append(row(...tools));
        right.disabled = !!e.ask;
        canvas.overlay({ sel: new Set([x.keyOf(e.src), x.keyOf(e.dst)]) });

        function flipIt() {
            if (whyFlip) { refuse(whyFlip); return; }
            let shared = [];
            let ask = false;
            const ok = run((ed2, d2) => {
                ask = needsAsk(ed2, kind, e.src);
                shared = L.flipLink(ed2, d2, kind, e.src, e.dst).shared;
            });
            if (!ok) return;
            const was = e.src;
            e.src = e.dst.t === 'pack' ? { t: 'pack', name: e.dst.name } : e.dst;
            e.dst = was.t === 'pack' ? { t: 'pack', name: was.name } : was;
            e.ask = ask;
            e.noteBad = false;
            e.note = shared.length ? `${name(e.dst)} was needed together with ${shared.map(refText).join(', ')}. Turned around, it's a rule of its own.` : null;
            x.render();
        }
    }
    // The line's shape: its type, which way it bows and how far, for the part picked on the canvas (or all of it).
    function shapeRow() {
        const st = canvas.shapeState?.();
        if (!st) return [];
        const dsk = x.desk;
        const types = [['curve', 'Curve'], ['arc', 'Arc'], ['straight', 'Straight'], ['step', 'Step']];
        const r1 = row(seg(types, st.type, v => canvas.patchShape({ type: v }), 'Line type'));
        r1.classList.add('pshape');
        if (st.type === 'curve' || st.type === 'arc') {
            const f = small('Flip', () => canvas.patchShape({ flip: !st.flip }));
            f.setAttribute('aria-pressed', String(st.flip));
            if (st.flip) f.classList.add('on');
            const bend = el('input', 'pbend');
            Object.assign(bend, { type: 'range', min: '0', max: '1', step: '0.05', value: String(st.tension) });
            bend.setAttribute('aria-label', 'Bend');
            bend.addEventListener('input', () => canvas.patchShape({ tension: Number(bend.value) }, true));
            bend.addEventListener('change', () => canvas.patchShape({ tension: Number(bend.value) }));
            const lb = el('label', 'pbendl', 'Bend');
            lb.append(bend);
            r1.append(f, lb);
        }
        mid.append(r1);
        const tools = [];
        if (st.segs > 1) tools.push(el('span', 'phint', st.dot != null ? `Dot ${st.dot + 1} of ${st.segs - 1}` : st.seg != null ? `Part ${st.seg + 1} of ${st.segs}` : 'The whole line'));
        else if (dsk) tools.push(el('span', 'phint', 'Drag a ghost dot or double-click the line to bend it · keys 1–4, X'));
        if (st.dot != null) tools.push(small('Remove dot', () => canvas.removeShapeDot()));
        if (st.shaped) tools.push(small('Reset shape', () => { canvas.resetShape(); x.toast('Shape reset'); }));
        return tools;
    }
    function needsAsk(E, kind, dst, mask = null) {
        if (kind === 'ride' || dst?.t !== 'entry') return false;
        const rows = L.rowsOf(E.config(dst.uid), kind === 'open' ? 'gate' : 'closeGate', mask).filter(r => r.some(y => !L.isCond(y)));
        return rows.length === 1 && rows[0].filter(y => !L.isCond(y)).length === 1;
    }
    function linkTo(end) {
        const kind = CHIP[e.piece].kind;
        if (!end) return;
        const src = e.src ?? end;
        const dst = e.dst ?? end;
        const why = L.whyNot(kind, src, dst);
        if (why) { refuse(why); return; }
        let ask = false;
        let replaced = null;
        const ok = run((ed2, d2) => {
            const j = L.joinOf(ed2, kind, dst);
            ask = j === null && needsAsk(ed2, kind, dst);
            if (kind === 'ride') { const h = ed2.config(dst.uid).glue; replaced = h?.mode === 'ride' && h.host !== ed2.config(src.uid).id ? h.host : null; }
            L.addLink(ed2, d2, kind, src, dst, { join: j ?? 'or' });
        });
        if (!ok) return;
        Object.assign(e, { src, dst, linked: true, ask, noteBad: false, note: replaced ? `${name(dst)} rode along with ${x.nameOfId(replaced)} before. A card rides on one host, so this one replaces it.` : null });
        x.render();
    }

    // ---- Glue
    function glueChoice() {
        return seg([['ride', 'Ride along'], ['hold', 'Hold']], e.mode, v => {
            if (v === e.mode) return;
            if (v === 'hold') {
                if (run(ed2 => ed2.update(e.dst.uid, c => { c.glue = { mode: 'hold' }; delete c.once; }))) Object.assign(e, { mode: 'hold', src: null, linked: false, note: null });
            } else {
                if (e.mode === 'hold') run(ed2 => ed2.update(e.dst.uid, c => { delete c.glue; }));
                Object.assign(e, { mode: 'ride', src: null, linked: false, note: null });
            }
            x.render();
        }, 'Ride along or hold');
    }
    function glueStrip() {
        mid.append(glueChoice());
        if (!e.mode) {
            mid.append(el('div', 'phint', `Ride along: ${name(e.dst)} fires whenever another card fires. Hold: ${name(e.dst)} stays on once it fires.`));
            right.disabled = true;
        } else {
            mid.append(say({ b: name(e.dst) }, ' stays on once it fires.'));
            const closers = x.closersOf(e.dst.uid);
            if (closers.length) mid.append(el('div', 'phint', `Ends when ${closers.join(' or ')} closes it.`));
            else mid.append(el('div', 'pnote', `Nothing ends it yet. Add a Closes to ${name(e.dst)}.`));
        }
        note();
        if (!e.isNew && e.mode) mid.append(row(removeBtn(() => { x.act(ed2 => ed2.update(e.dst.uid, c => { delete c.glue; })); close('Glue removed'); })));
        canvas.overlay({ sel: new Set([x.keyOf(e.dst)]) });
    }

    // ---- Switch
    function switchStrip() {
        mid.append(say({ b: name(e.fork) }, ' is a fork. When one path fires, the others close.'));
        const list = el('div', 'ppaths');
        // The order only matters when two paths fire in one message, so it is folded away (#18).
        const order = e.order && e.paths.length > 1;
        e.paths.forEach((p, i) => {
            const r = el('div', 'ppath');
            if (order) r.append(el('span', 'pn', `${i + 1}`));
            r.append(el('span', 'pt', name(p)));
            if (order) {
                const mv = d => { const j = i + d; if (j < 0 || j >= e.paths.length) return; [e.paths[i], e.paths[j]] = [e.paths[j], e.paths[i]]; writeSwitch(); };
                const up = btn('pbtn ico', ic('up', 's'), () => mv(-1), `Move ${name(p)} up`);
                const dn = btn('pbtn ico', ic('down', 's'), () => mv(1), `Move ${name(p)} down`);
                up.disabled = i === 0;
                dn.disabled = i === e.paths.length - 1;
                r.append(up, dn);
            }
            r.append(btn('pbtn ico', ic('x', 's'), () => { const [gone] = e.paths.splice(i, 1); writeSwitch([gone]); }, `Take ${name(p)} out`));
            list.append(r);
        });
        if (e.paths.length) mid.append(list);
        const ok = end => end?.t === 'entry' && !L.sameEnd(end, e.fork) && !e.paths.some(p => L.sameEnd(p, end));
        const add = end => { if (!ok(end)) { refuse('A path is another entry, not a pack or a greeting, and each one is listed once.'); return; } e.paths.push(end); if (!writeSwitch()) e.paths.pop(); x.render(); };
        mid.append(row(el('span', 'phint', e.paths.length < 2 ? `Drag the loose end to path ${e.paths.length + 1}, or` : 'More paths: drag the loose end, or'), picker('pick one', ok, add)));
        if (e.paths.length > 1) {
            const t = btn('linkish porder', html`${ic(order ? 'down' : 'right', 's')} If two fire at once`, () => { e.order = !e.order; x.render(); });
            t.setAttribute('aria-expanded', String(!!order));
            mid.append(t);
            if (order) mid.append(el('div', 'phint', 'When two paths are named in the same message, the higher one wins and the others close.'));
        }
        mid.append(row(swEl(e.wait, v => { e.wait = v; writeSwitch(); }, 'Paths wait for the fork'), el('span', 'plabel2', 'Paths wait for the fork')));
        if (!e.wait) mid.append(el('div', 'pnote', `A path can be taken before ${name(e.fork)} fires.`));
        mid.append(row(swEl(e.dice, v => { e.dice = v; writeSwitch(); }, 'Roll the dice'), el('span', 'plabel2', 'Roll the dice')));
        if (e.dice) mid.append(el('div', 'phint', `When ${name(e.fork)} first fires, one path is picked at random and the others close. A swipe keeps the roll; rewriting the message before it rolls again.`));
        note();
        if (!e.isNew) mid.append(row(removeBtn(() => { x.act(ed2 => ed2.update(e.fork.uid, c => { delete c.switch; delete c.dice; })); close('Switch removed'); })));
        right.disabled = e.paths.length < 2;
        loose(e.fork, 'close', ok, add, new Set([e.fork, ...e.paths].map(x.keyOf)));
    }
    function writeSwitch(removed = []) {
        const ok = run((ed2, d2) => {
            if (e.wait) for (const r of removed) L.removeLink(ed2, d2, 'open', e.fork, r);
            if (e.paths.length >= 2) { L.setSwitch(ed2, d2, e.fork, e.paths, e.wait); ed2.update(e.fork.uid, c => { if (e.dice) c.dice = true; else delete c.dice; }); }
            else {
                ed2.update(e.fork.uid, c => { delete c.switch; delete c.dice; });
                for (const p of e.paths) {
                    const has = !!L.findLink(ed2, d2, 'open', e.fork, p);
                    if (e.wait && !has) L.addLink(ed2, d2, 'open', e.fork, p, { join: 'and' });
                    if (!e.wait && has) L.removeLink(ed2, d2, 'open', e.fork, p);
                }
            }
        });
        if (ok) { e.note = null; x.render(); }
        return ok;
    }

    // ---- Lock and Wait
    function condStrip() {
        const E = ed();
        const isLock = e.piece === 'lock';
        const c = e.cond;
        const p = e.place;
        const who = name({ t: 'entry', uid: p.uid });
        if (!p.field) {
            mid.append(row(say({ b: who }, ' '), seg([['gate', 'opens'], ['closeGate', 'closes']], null, v => { p.field = v; writeCond(); x.render(); }, 'Opens or closes'), say(' when…')));
            mid.append(el('div', 'phint', isLock ? 'A lock waits for a phrase in the chat.' : 'A wait counts messages.'));
            right.disabled = true;
            canvas.overlay({ sel: new Set([x.keyOf({ t: 'entry', uid: p.uid })]) });
            return;
        }
        const r = p.row != null ? L.rowsOf(E.config(p.uid), p.field, p.mask)[p.row] ?? [] : [];
        const links = r.filter(y => !L.isCond(y)).map(refText);
        // A lock is armed after the rest of its row, waits included.
        const waits = isLock ? r.filter(y => L.isCond(y) && 'wait' in y).map(refText) : [];
        const after = [...links, ...waits];
        if (p.row == null) {
            mid.append(row(say({ b: who }, ' '), seg([['gate', 'opens'], ['closeGate', 'closes']], p.field, v => { p.field = v; writeCond(); x.render(); }, 'Opens or closes'), say(isLock ? ' when someone says:' : ' after:')));
        } else {
            const n = el('div', 'say');
            if (p.mask != null) n.append('Mask ', el('b', '', E.config(p.uid).masks?.[p.mask]?.name ?? ''), ' of ');
            n.append(el('b', '', who), p.mask != null ? (p.field === 'gate' ? ' is on' : ' is off') : (p.field === 'gate' ? ' opens' : ' closes'));
            if (after.length) n.append(' after ', el('b', '', after.join(' and ')), ', then');
            n.append(isLock ? ' when someone says:' : ' after:');
            mid.append(n);
        }
        if (isLock) {
            const chips = el('div', 'pphr');
            (c.lock ?? []).forEach((ph, i) => {
                const b = btn('pphrase', '', () => { c.lock.splice(i, 1); writeCond(); x.render(); }, `Remove "${ph}"`);
                b.append(el('span', '', `“${ph}”`), Object.assign(el('span', 'px'), { innerHTML: ic('x', 's') }));
                chips.append(b);
            });
            const inp = el('input', 'ptext');
            inp.placeholder = c.lock?.length ? 'or another phrase' : 'a phrase, like: the old mill';
            inp.setAttribute('aria-label', 'Phrase');
            inp.value = e.draft ?? '';
            inp.dataset.focus = 'phrase';
            const addPhrase = () => {
                const v = inp.value.trim();
                if (!v) return;
                c.lock = [...(c.lock ?? []).filter(y => y !== v), v];
                e.draft = '';
                B.focus = 'phrase';
                writeCond();
                x.render();
            };
            inp.addEventListener('input', () => { e.draft = inp.value; });
            inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); addPhrase(); } });
            chips.append(inp, small('Add', addPhrase));
            mid.append(chips);
            if ((c.lock ?? []).length > 1) mid.append(el('div', 'phint', 'Any one of them is enough.'));
            mid.append(row(el('span', 'phint', 'Who says it:'), seg([['', 'anyone'], ['user', 'you'], ['char', 'the character']], c.by ?? '', v => { if (v) c.by = v; else delete c.by; writeCond(); x.render(); }, 'Who says it')));
        } else {
            const nums = el('div', 'prow2');
            for (const n of [1, 2, 3, 5, 10]) nums.append(small(String(n), () => { c.wait = n; writeCond(); x.render(); }, c.wait === n ? 'on' : ''));
            const own = el('input', 'pnum');
            own.type = 'number'; own.min = '1';
            own.value = [1, 2, 3, 5, 10].includes(c.wait) ? '' : String(c.wait);
            own.placeholder = 'other';
            own.setAttribute('aria-label', 'Number of messages');
            own.addEventListener('change', () => { const v = Math.round(Number(own.value)); if (v >= 1) { c.wait = v; writeCond(); x.render(); } });
            nums.append(own, el('span', 'phint', `message${c.wait === 1 ? '' : 's'} pass`));
            mid.append(nums);
            mid.append(row(el('span', 'phint', 'Whose messages count:'), seg([['', 'everyone\'s'], ['user', 'yours'], ['char', 'the character\'s']], c.by ?? '', v => { if (v) c.by = v; else delete c.by; writeCond(); x.render(); }, 'Whose messages count')));
            if (p.row == null) mid.append(el('div', 'phint', 'Counted from the start of the chat.'));
            else if (links.length) mid.append(el('div', 'phint', `Counted from when ${links.join(' and ')} ${links.length > 1 ? 'have' : 'has'} fired.`));
        }
        note();
        const remove = !e.isNew ? removeBtn(() => { x.act(ed2 => L.removeCond(ed2, e.at)); close(isLock ? 'Lock removed' : 'Wait removed'); }) : null;
        // A lock already in the book can stand on its own card: its phrases move to a new Moment, and the lock
        // becomes a link from it, in the same row (CONCEPTS 3.13).
        if (isLock && e.at && (c.lock ?? []).length && x.makeMoment) {
            const mk = small('Make it a Moment', () => {
                const name = c.lock[0].replace(/^./, ch => ch.toUpperCase());
                let made = null;
                const ok = x.act((ed2, d2) => {
                    made = addMoment(d2, x.entryTemplate ?? {}, name, c.lock);
                    if (c.by) ed2.update(made.uid, cc => { cc.by = c.by; });
                    L.setCond(ed2, e.at, ed2.config(made.uid).id);
                });
                if (!ok || !made) return;
                x.makeMoment(made);
                close(`Made the Moment "${name}"`);
            });
            mk.prepend(Object.assign(el('span', 'ri'), { innerHTML: ic('spark', 's') }));
            mid.append(row(mk, ...(remove ? [remove] : [])));
        } else if (remove) mid.append(row(remove));
        right.disabled = isLock ? !(c.lock ?? []).length : !(c.wait >= 1);
        canvas.overlay({ sel: new Set([x.keyOf({ t: 'entry', uid: p.uid })]) });
    }
    /** Writes the lock or wait where it goes, once it is complete; a lock with no phrase left comes out. */
    function writeCond() {
        const c = e.cond;
        const p = e.place;
        if (!p.field) return;
        const ok = 'wait' in c ? c.wait >= 1 : (c.lock ?? []).length > 0;
        const value = 'wait' in c ? { wait: c.wait, ...(c.by ? { by: c.by } : {}) } : { lock: [...c.lock ?? []], ...(c.by ? { by: c.by } : {}) };
        // The edit runs twice (on a copy first), so it starts from the same place each time.
        const prev = e.at;
        const moved = prev && prev.field !== p.field;
        let at = null;
        const done = run(ed2 => {
            let cur = prev;
            if (cur && (!ok || moved)) { L.removeCond(ed2, cur); cur = null; }
            if (!ok) { at = null; return; }
            if (cur) { L.setCond(ed2, cur, value); at = cur; } else at = L.addCond(ed2, p.uid, p.field, p.mask ?? null, p.row ?? null, value);
        });
        if (done) e.at = at;
    }

    // ---- Mask
    function maskStrip() {
        const E = ed();
        const c = E.config(e.uid);
        const m = c.masks?.[e.mi];
        if (!m) { close(); return; }
        const n = c.masks.length;
        const nm = el('input', 'ptext');
        nm.value = m.name;
        nm.setAttribute('aria-label', 'Mask name');
        nm.addEventListener('change', () => {
            const v = maskName(nm.value, c.masks, m.name);
            if (v === m.name) { nm.value = v; return; }
            const from = m.name;
            run(ed2 => ed2.update(e.uid, cc => { cc.masks[e.mi].name = v; }));
            x.showMask(e.uid, v, from);
            x.render();
        });
        mid.append(row(say('Mask on ', { b: name({ t: 'entry', uid: e.uid }) }, ':'), nm));
        const write = small('Write its text', () => x.openMask(e.uid, m.name));
        write.prepend(Object.assign(el('span', 'ri'), { innerHTML: ic('edit', 's') }));
        const prio = el('span', 'phint', `Priority ${e.mi + 1} of ${n}`);
        const up = btn('pbtn ico', ic('up', 's'), () => swap(e.mi + 1), 'Higher priority');
        const dn = btn('pbtn ico', ic('down', 's'), () => swap(e.mi - 1), 'Lower priority');
        up.disabled = e.mi === n - 1;
        dn.disabled = e.mi === 0;
        mid.append(row(write, ...(n > 1 ? [prio, up, dn] : [])));
        if (n > 1) mid.append(el('div', 'phint', 'When several masks are on, the highest one wins.'));
        side('gate', 'On when', true);
        if (e.offOpen) side('closeGate', 'Off when', false);
        else mid.append(row(small('Off when ▸', () => { e.offOpen = true; x.render(); })));
        note();
        if (!e.isNew) mid.append(row(removeBtn(() => { x.act(ed2 => ed2.update(e.uid, cc => { cc.masks.splice(e.mi, 1); })); close('Mask removed'); })));
        function swap(j) {
            if (j < 0 || j >= n) return;
            if (run(ed2 => ed2.update(e.uid, cc => { [cc.masks[e.mi], cc.masks[j]] = [cc.masks[j], cc.masks[e.mi]]; }))) { e.mi = j; x.render(); }
        }
        function side(field, label, withLoose) {
            const kind = field === 'gate' ? 'open' : 'close';
            const rows = L.rowsOf(c, field, e.mi);
            const box = el('div', 'pphr');
            box.append(el('span', 'plabel2', `${label}:`));
            rows.forEach((r, ri) => r.forEach((ref, j) => {
                const b = btn('pphrase', '', () => run(ed2 => L.removeCond(ed2, { uid: e.uid, field, mask: e.mi, row: ri, j })) && x.render(), `Remove ${refText(ref)}`);
                b.append(el('span', '', refText(ref)), Object.assign(el('span', 'px'), { innerHTML: ic('x', 's') }));
                box.append(b);
            }));
            mid.append(box);
            const self = { t: 'entry', uid: e.uid };
            const ok = end => !!end && !L.sameEnd(end, self) && end.t !== 'pack';
            const link = end => {
                if (!ok(end)) { refuse('Pick another entry or a greeting.'); return; }
                run((ed2, d2) => L.addLink(ed2, d2, kind, end, self, { mask: e.mi, join: 'or' }));
                x.render();
            };
            const ph = el('input', 'ptext');
            ph.placeholder = 'or when someone says…';
            ph.setAttribute('aria-label', `${label}: a phrase`);
            ph.addEventListener('keydown', ev => {
                if (ev.key !== 'Enter' || !ph.value.trim()) return;
                ev.preventDefault();
                run(ed2 => L.addCond(ed2, e.uid, field, e.mi, null, { lock: [ph.value.trim()] }));
                x.render();
            });
            const wait = el('select', 'ppick');
            wait.setAttribute('aria-label', `${label}: after a number of messages`);
            wait.append(new Option('or after…', ''));
            for (const k of [1, 2, 3, 5, 10]) wait.append(new Option(`${k} message${k === 1 ? '' : 's'}`, String(k)));
            wait.addEventListener('change', () => { if (wait.value) { run(ed2 => L.addCond(ed2, e.uid, field, e.mi, null, { wait: Number(wait.value) })); x.render(); } });
            mid.append(row(...(withLoose ? [el('span', 'phint', 'Drag the loose end, or')] : []), picker('pick an entry', ok, link), ph, wait));
            if (field === 'gate' && !rows.length) mid.append(el('div', 'phint', 'No "on when": it\'s used only when picked by hand.'));
            if (withLoose) loose(self, 'mask', ok, link);
        }
    }

    // ---- Pack
    function packStrip() {
        const E = ed();
        const mine = new Set(E.config(e.uid).packs ?? []);
        mid.append(say('Put ', { b: name({ t: 'entry', uid: e.uid }) }, ' in a pack:'));
        const box = el('div', 'pphr');
        for (const pk of x.packs()) {
            const on = mine.has(pk);
            const b = btn(`pphrase pk${on ? ' on' : ''}`, '', () => toggle(pk, !on));
            b.textContent = `#${pk}`;
            b.setAttribute('aria-pressed', String(on));
            box.append(b);
        }
        box.append(small('+ New pack', () => x.layer.askText({
            title: 'New pack', placeholder: 'Pack name, like town or town/inn', ok: 'Add',
            done: v => { const nmv = String(v).trim().replace(/^#/, '').replace(/\s+/g, '-'); if (nmv) toggle(nmv, true); },
        })));
        mid.append(box, el('div', 'phint', 'A name like town/inn puts the pack inside town.'));
        note();
        right.disabled = !mine.size;
        canvas.overlay({ sel: new Set([x.keyOf({ t: 'entry', uid: e.uid })]) });
        function toggle(pk, on) {
            run(ed2 => ed2.update(e.uid, cc => {
                const list = Array.isArray(cc.packs) ? cc.packs.filter(y => y !== pk) : [];
                cc.packs = on ? [...list, pk] : list;
            }));
            x.render();
        }
    }

    // ---------------------------------------------------------------- shared
    /** Shows a loose end from `fromEnd`; dropping it on a card that `ok` takes calls `pick`. */
    function loose(fromEnd, color, ok, pick, sel = new Set([x.keyOf(fromEnd)])) {
        const from = x.keyOf(fromEnd);
        e.looseAt ??= canvas.looseStart(from);
        canvas.overlay({
            sel,
            dim: key => { const end = x.nodeOf(key); return key !== from && !ok(end); },
            loose: { from, at: e.looseAt, color: `var(--p-${color})` },
            onLoose: (h, at) => {
                const end = h?.card ? x.nodeOf(h.card) : null;
                if (end && ok(end)) { e.looseAt = null; pick(end); return; }
                if (at) e.looseAt = at;
                if (h?.card && end) refuse(whyNotPick(end));
            },
        });
        B.loosePick = end => { if (ok(end)) { e.looseAt = null; pick(end); return true; } return false; };
    }
    function whyNotPick(end) {
        const kind = CHIP[e.piece]?.kind;
        if (kind && !e.linked) return L.whyNot(kind, e.src ?? end, e.dst ?? end) ?? 'Not that card.';
        return 'That card can\'t take this piece.';
    }
    function finish() {
        if (right.disabled) return;
        const msg = { opens: 'Link saved', closes: 'Link saved', glue: 'Glue saved', switch: 'Switch saved', lock: 'Lock saved', wait: 'Wait saved', mask: 'Mask saved', pack: 'Pack saved' }[e.piece];
        close(e.dirty || e.isNew ? msg : null);
    }
    function cancelEdit() {
        if (e.dirty) x.restore(e.snap);
        close(null);
    }
    function close(msg) {
        B.edit = null;
        B.loosePick = null;
        canvas.overlay(null);
        x.render();
        if (msg) x.toast(msg);
    }

    // Focus comes back to the phrase box after a phrase is added (the strip was drawn again).
    if (B.focus) { const f = mid.querySelector(`[data-focus="${B.focus}"]`); B.focus = null; f?.focus(); }
}

/**
 * Starts a piece on what it was dropped on. Returns the edit (the strip to open) or a reason it can't go there.
 * @returns {{ edit?: object, why?: string }}
 */
export function startPiece(k, hit, x) {
    const snap = x.snapshot();
    const base = { piece: k, isNew: true, snap, dirty: false, note: null };
    if (hit.card) {
        const end = x.nodeOf(hit.card);
        const why = whyNotOn(k, end);
        if (why) return { why };
        const E = x.editor();
        // One direction rule: the first card is the source, the one doing the verb (Road opens Mill, Storm closes Mill).
        if (k === 'opens' || k === 'closes') return { edit: { ...base, src: end, dst: null } };
        if (k === 'glue') {
            const g = E.config(end.uid).glue;
            if (g?.mode === 'ride') { const host = E.uidOfId(g.host); if (host !== undefined) return { edit: { ...base, isNew: false, piece: 'glue', mode: 'ride', src: { t: 'entry', uid: host }, dst: end, linked: true } }; }
            if (g?.mode === 'hold') return { edit: { ...base, isNew: false, mode: 'hold', dst: end } };
            return { edit: { ...base, mode: null, dst: end, src: null } };
        }
        if (k === 'switch') {
            const ids = E.config(end.uid).switch ?? [];
            const paths = ids.map(id => E.uidOfId(id)).filter(u => u !== undefined).map(uid => ({ t: 'entry', uid }));
            return { edit: { ...base, isNew: !paths.length, fork: end, paths, wait: paths.length ? L.pathsWait(E, x.data(), end, paths) : true, dice: E.config(end.uid).dice === true } };
        }
        if (k === 'mask') {
            let mi = -1;
            const ok = x.act(ed2 => ed2.update(end.uid, c => {
                c.masks = Array.isArray(c.masks) ? c.masks : [];
                c.masks.push({ name: maskName('mask', c.masks), content: String(x.contentOf(end.uid) ?? '').trim() ? x.contentOf(end.uid) : 'Write this version here.' });
                mi = c.masks.length - 1;
            }), { quiet: true });
            if (!ok) return { why: 'The mask could not be added.' };
            const m = x.editor().config(end.uid).masks[mi];
            x.showMask(end.uid, m.name);
            return { edit: { ...base, dirty: true, uid: end.uid, mi } };
        }
        if (k === 'pack') return { edit: { ...base, uid: end.uid } };
        if (k === 'lock' || k === 'wait') return { edit: { ...base, place: { uid: end.uid, field: null, mask: null, row: null }, cond: k === 'lock' ? { lock: [] } : { wait: 2 }, at: null } };
    }
    if (k !== 'lock' && k !== 'wait') return { why: 'Drop it on a card.' };
    const cond = k === 'lock' ? { lock: [] } : { wait: 2 };
    let row = hit.row ?? (hit.cond ? { key: hit.cond.key, port: hit.cond.port, ri: hit.cond.ri, mask: hit.cond.mask } : null);
    if (hit.link) {
        const l = hit.link;
        const src = x.nodeOf(l.from);
        const dst = x.nodeOf(l.to);
        if (!src || !dst) return { why: 'That link is gone.' };
        if (l.kind === 'ride') return { why: 'Glue has no row for a lock or a wait. Put it on the host\'s gate instead.' };
        let at = null;
        let why = null;
        const ok = x.act((ed2, d2) => {
            const r = L.condRowFor(ed2, d2, l.kind, src, dst, l.mask ?? null);
            if (r.why) { why = r.why; return; }
            at = r.at;
        }, { quiet: true });
        if (why || !ok || !at) return { why: why ?? 'A lock or a wait can\'t go there.' };
        const edit = { ...base, dirty: true, place: { uid: at.uid, field: at.field, mask: at.mask, row: at.row }, cond, at: null };
        if (k === 'wait') writeNow(edit, x);
        return { edit };
    }
    if (!row) return { why: 'Drop it on a card, a line or a junction.' };
    const end = x.nodeOf(row.key);
    if (end?.t !== 'entry') return { why: 'A lock or a wait goes on an entry\'s row.' };
    const edit = { ...base, place: { uid: end.uid, field: FIELD[row.port], mask: row.mask ?? null, row: row.ri }, cond, at: null };
    if (k === 'wait') writeNow(edit, x);
    return { edit };
}

/** A wait is complete from the start (2 messages), so it is written straight away. */
function writeNow(edit, x) {
    let at = null;
    if (x.act(ed2 => { at = L.addCond(ed2, edit.place.uid, edit.place.field, edit.place.mask, edit.place.row, { wait: edit.cond.wait }); }, { quiet: true })) { edit.at = at; edit.dirty = true; }
}

/** Opens the strip of something already on the canvas: a line, or a lock or wait pill. */
export function editExisting(hit, x) {
    const snap = x.snapshot();
    const base = { isNew: false, snap, dirty: false, note: null };
    if (hit.link) {
        const l = hit.link;
        const src = x.nodeOf(l.from);
        const dst = x.nodeOf(l.to);
        if (!src || !dst) return null;
        if (l.mask != null && dst.t === 'entry') return { ...base, piece: 'mask', uid: dst.uid, mi: l.mask, offOpen: l.kind === 'close' };
        const piece = KIND_PIECE[l.kind];
        if (!piece) return null;
        return { ...base, piece, mode: l.kind === 'ride' ? 'ride' : undefined, src, dst, linked: true, mask: null };
    }
    if (hit.cond) {
        const c = hit.cond;
        const end = x.nodeOf(c.key);
        if (end?.t !== 'entry') return null;
        const field = FIELD[c.port];
        const rows = L.rowsOf(x.editor().config(end.uid), field, c.mask ?? null);
        const j = (rows[c.ri] ?? []).findIndex(y => same(y, c.cond));
        if (j < 0) return null;
        const stored = structuredClone(rows[c.ri][j]);
        return { ...base, piece: Array.isArray(stored.lock) ? 'lock' : 'wait', place: { uid: end.uid, field, mask: c.mask ?? null, row: c.ri }, cond: stored, at: { uid: end.uid, field, mask: c.mask ?? null, row: c.ri, j } };
    }
    return null;
}
