// The inspector (LAYOUT "Inspector", D14): a sheet at half height over the canvas, drag up for full height.
// The entry's text, the Reopen line (D18), one row per piece with the entry page's sentence, tap one to edit it
// (one open at a time), rules other entries aim at this one, + Add piece, and the footer. Also the target
// picker, and the greeting inspector (BUILD_SPEC 15.4). Every change goes through `x.edit`, which wraps
// pieces.js's bookEditor in the library's change.
import { btn, el, swEl } from './dom.js';
import { ic } from './icons.js';
import { FAMILY_COLOR } from './logic-text.js';
import { strategyColor } from './entry-page.js';
import {
    PIECE, PIECES, addMask, addPiece, addToList, addToRow, applyMovesOn, greetingName, hasPiece, maskName, missingPieces,
    moveMaskUp, movesOn, reading, refLabel, removeFromRow, removePiece, setGreetingRule, repickGreeting,
} from './pieces.js';

const KIND_ICON = { lock: 'lock', wait: 'clock', greeting: 'chat' };

/** The sheet itself: a grab bar that toggles and drags between half and full height. */
function frame(box, x, cls) {
    const sh = el('div', `insp ${cls}${x.full ? ' full' : ''}`);
    sh.setAttribute('role', 'dialog');
    const grab = el('div', 'igrab');
    grab.append(el('i'));
    grab.setAttribute('role', 'button');
    grab.setAttribute('aria-label', x.full ? 'Half height' : 'Full height');
    let y0 = null;
    let moved = false;
    grab.addEventListener('pointerdown', e => { y0 = e.clientY; moved = false; grab.setPointerCapture(e.pointerId); });
    grab.addEventListener('pointermove', e => {
        if (y0 === null) return;
        const dy = e.clientY - y0;
        if (Math.abs(dy) > 6) moved = true;
        if (moved) sh.style.height = `${Math.min(box.clientHeight, Math.max(120, sh.getBoundingClientRect().height - dy))}px`;
        y0 = e.clientY;
    });
    grab.addEventListener('pointerup', () => {
        y0 = null;
        if (!moved) { x.setFull(!x.full); return; }
        const h = sh.getBoundingClientRect().height;
        sh.style.height = '';
        if (h < box.clientHeight * 0.3) x.close();
        else x.setFull(h > box.clientHeight * 0.7);
    });
    const body = el('div', 'ibody');
    sh.append(grab, body);
    box.append(sh);
    if (x.scroll) requestAnimationFrame(() => { body.scrollTop = x.scroll; });
    body.addEventListener('scroll', () => x.onScroll?.(body.scrollTop));
    return body;
}

/** A chip for a ref: icon for locks, waits and greetings, × to remove. */
function chip(ref, x, onRemove, target = false) {
    const label = refLabel(ref, x.nameOfId);
    const { kind } = label;
    // A pack as a target is the whole pack, not a reading.
    const text = target && kind === 'pack' ? ref : label.text;
    const c = el('span', `chip ${kind}`);
    const t = el('span');
    if (KIND_ICON[kind]) t.innerHTML = ic(KIND_ICON[kind]);
    t.append(text);
    c.append(t);
    if (onRemove) c.append(btn('', ic('x'), onRemove, `Remove ${text}`));
    return c;
}

/**
 * The target picker (LAYOUT "Choosing a target"): a search box, entries, packs, then greetings, Lock phrase…
 * and Wait…, as the place allows.
 * @param {object} o { title, entries: [{uid, title, dot}], packs: string[], readings, greetings, lock, done(make) }
 *   `done` gets `make(ed) → ref`, run inside the change so an entry picked can get its id there.
 */
export function pickTarget(layer, o) {
    layer.sheet(o.title ?? 'Choose', sh => {
        const q = el('input', 'kin');
        q.placeholder = 'Search';
        q.setAttribute('aria-label', 'Search');
        sh.append(el('div', 'pickq'));
        sh.lastChild.append(q);
        const list = el('div', 'picklist');
        sh.append(list);
        const fill = () => {
            list.innerHTML = '';
            const needle = q.value.trim().toLowerCase();
            const hit = s => !needle || s.toLowerCase().includes(needle);
            const ents = o.entries.filter(e => hit(e.title));
            if (ents.length) list.append(el('div', 'lbl', 'Entries'));
            for (const e of ents) list.append(layer.opt(e.title, () => { layer.close(); o.done(ed => ed.idOf(e.uid)); }, { dot: e.dot }));
            const packs = (o.packs ?? []).filter(p => hit(`#${p}`));
            if (packs.length) list.append(el('div', 'lbl', 'Packs'));
            for (const p of packs) {
                list.append(layer.opt(`#${p}`, () => {
                    if (!o.readings) { layer.close(); o.done(() => `#${p}`); return; }
                    layer.sheet(`#${p}`, s2 => {
                        s2.append(layer.opt('Any of them', () => { layer.close(); o.done(() => reading(p)); }, { sub: 'Any member has fired' }));
                        s2.append(layer.opt('All of them', () => { layer.close(); o.done(() => reading(p, 'all')); }, { sub: 'Every member has fired' }));
                        s2.append(layer.opt('A number of them…', () => layer.askText({
                            title: `How many of #${p}?`, type: 'number', value: '2', ok: 'Add',
                            check: v => (Number.isInteger(Number(v)) && Number(v) >= 1 ? null : 'A whole number, 1 or more'),
                            done: v => o.done(() => reading(p, Number(v))),
                        }), { sub: 'At least that many members have fired' }));
                    }, { help: 'How this rule reads the pack.' });
                }, { icon: 'tag' }));
            }
            const greets = (o.greetings ?? []).filter(g => hit(g.title) || hit(g.text ?? ''));
            if (greets.length) list.append(el('div', 'lbl', 'Greetings'));
            for (const g of greets) list.append(layer.opt(g.title, () => { layer.close(); o.done(() => ({ ...g.ref })); }, { icon: 'chat', sub: g.text }));
            if (o.lock) {
                list.append(el('div', 'lbl', 'Other'));
                list.append(layer.opt('Lock phrase…', () => layer.askText({
                    title: 'Lock phrase', placeholder: 'Phrases, separated by commas', ok: 'Add',
                    done: v => { const lock = v.split(',').map(s => s.trim()).filter(Boolean); if (lock.length) o.done(() => ({ lock })); },
                }), { icon: 'lock', sub: 'Waits until someone says it' }));
                list.append(layer.opt('Wait…', () => layer.askText({
                    title: 'Wait how many messages?', type: 'number', value: '3', ok: 'Add',
                    check: v => (Number.isInteger(Number(v)) && Number(v) >= 1 ? null : 'A whole number, 1 or more'),
                    done: v => o.done(() => ({ wait: Number(v) })),
                }), { icon: 'clock', sub: 'Runs out that many messages after the rest of the row' }));
            }
            if (!list.children.length) list.append(el('p', 'help', 'Nothing matches.'));
        };
        q.addEventListener('input', fill);
        fill();
    }, { cls: 'pick' });
}

/**
 * Draws the entry inspector into `box`.
 * @param {HTMLElement} box
 * @param {object} x everything it needs from the app (see app.js inspect())
 */
export function renderInspector(box, x) {
    const { layer, entry: e, config: c } = x;
    const body = frame(box, x, 'entry');

    const head = el('div', 'ihead');
    const d = el('i', 'sd');
    d.style.background = strategyColor(e);
    const h = el('h2', '', x.title);
    head.append(d, h, swEl(!e.disable, on => x.edit((ed, data) => { data.entries[e.uid].disable = !on; }), 'Entry on'), btn('round flat', ic('x'), x.close, 'Close the inspector'));
    body.append(head);

    const pre = el('button', 'ipre');
    pre.type = 'button';
    pre.textContent = (e.content ?? '').trim() || 'No text yet. Tap to write it.';
    if (!(e.content ?? '').trim()) pre.classList.add('empty');
    pre.addEventListener('click', () => x.openEntry());
    body.append(pre);

    if (x.closed) {
        const r = el('div', 'closedline ireopen');
        r.append(el('span', '', 'Closed in this chat by '), el('em', '', x.closed.by));
        r.append(btn('linkish acc', 'Reopen', x.closed.reopen));
        body.append(r);
    }
    if (x.problems.length) {
        const pr = el('div', 'prob iprob');
        pr.innerHTML = ic('alert', 's');
        pr.append(el('span', '', x.problems.join('. ')));
        body.append(pr);
    }

    const sentence = label => x.lines.find(l => l.label === label)?.text ?? '';
    const update = fn => x.edit(ed => ed.update(e.uid, (cc, id) => fn(cc, id, ed)));
    for (const p of PIECES) {
        if (!hasPiece(c, p.key) && x.open !== p.key) continue;
        const open = x.open === p.key;
        const pc = el('div', `pc${open ? ' open' : ''}`);
        pc.dataset.piece = p.key;
        pc.style.setProperty('--c', FAMILY_COLOR[p.family]);
        const ph = el('div', 'pch');
        const tap = el('button', 'pct');
        tap.type = 'button';
        tap.append(el('b', '', p.label), el('span', 'pcs', sentence(p.label) || (open ? '' : 'Tap to set it up')));
        tap.addEventListener('click', () => x.setOpen(open ? null : p.key));
        ph.append(tap, btn('pq', ic('help'), () => layer.sheet(p.label, sh => sh.append(el('p', 'help', p.help))), `What is ${p.label}?`));
        if (open && hasPiece(c, p.key)) ph.append(btn('pq', ic('trash'), () => { update(cc => removePiece(cc, p.key)); x.setOpen(null); layer.toast(`${p.label} removed`); }, `Remove ${p.label}`));
        pc.append(ph);
        if (open) pc.append(editorOf(p.key, x, update));
        body.append(pc);
    }

    if (x.sources.length) {
        body.append(el('div', 'lbl', 'From other entries'));
        for (const s of x.sources) body.append(layer.opt(s.name, () => x.inspect(s.key), { sub: s.what, dot: FAMILY_COLOR[s.family] }));
    }

    const missing = missingPieces(c);
    if (missing.length) {
        body.append(btn('addpiece', `${ic('plus', 's')} Add piece`, () => layer.sheet('Add piece', sh => {
            for (const p of missing) {
                sh.append(layer.opt(p.label, () => {
                    layer.close();
                    // Rows and lists are written with their first item; until then the open editor stands in.
                    if (['once', 'by', 'glue'].includes(p.key)) update(cc => addPiece(cc, p.key));
                    x.setOpen(p.key);
                }, { sub: p.help, dot: FAMILY_COLOR[p.family] }));
            }
        })));
    }

    const foot = el('div', 'ifoot');
    foot.append(btn('linkish', `${ic('entry', 's')} Open entry`, () => x.openEntry()));
    if (x.takeOff) foot.append(btn('linkish', `${ic('x', 's')} Take off canvas`, x.takeOff));
    foot.append(btn('linkish', `${ic('code', 's')} Data`, x.data));
    body.append(foot);
}

/** The editor of one piece, under its row. */
function editorOf(key, x, update) {
    const { layer, config: c } = x;
    const box = el('div', 'ped');
    const rows = (get, set, { gate = false } = {}) => rowsEditor(box, x, get, set, update, gate);
    if (key === 'gate') {
        rows(cc => cc.gate ?? [], (cc, r) => { cc.gate = r; }, { gate: true });
        const mo = movesOn(c);
        if (mo.ids.length) {
            const names = mo.missing.map(x.nameOfId).join(', ');
            if (mo.missing.length) box.append(btn('addb mo', `Story moves on: close ${names} when this fires`, () => { update(cc => applyMovesOn(cc)); layer.toast('The story moves on'); }));
            else box.append(el('p', 'phelp', `The story moves on: this already closes ${mo.ids.map(x.nameOfId).join(', ')} when it fires.`));
        }
    } else if (key === 'closeGate') {
        rows(cc => cc.closeGate ?? [], (cc, r) => { cc.closeGate = r; });
    } else if (key === 'gatesFor' || key === 'closesFor' || key === 'switch') {
        const list = Array.isArray(c[key]) ? c[key] : [];
        const wrap = el('div', 'rowbox');
        list.forEach((t, i) => wrap.append(chip(t, x, () => update(cc => { cc[key].splice(i, 1); }), true)));
        wrap.append(btn('addb', '+ add', () => pickTarget(layer, {
            title: key === 'switch' ? 'Add a path' : 'Add a target',
            entries: x.others, packs: key === 'switch' ? [] : x.packs, readings: false,
            done: make => update((cc, id, ed) => { cc[key] = addToList(Array.isArray(cc[key]) ? cc[key] : [], make(ed)); }),
        })));
        box.append(wrap);
        if (key === 'switch' && list.length < 2) box.append(el('p', 'phelp', 'A fork needs two paths or more.'));
    } else if (key === 'glue') {
        const g = c.glue ?? { mode: 'hold' };
        const seg = el('div', 'seg');
        seg.append(
            btn(g.mode === 'ride' ? 'on' : '', 'Ride along', () => { if (g.mode !== 'ride') pickHost(); }),
            btn(g.mode === 'hold' ? 'on' : '', 'Hold', () => update(cc => { cc.glue = { mode: 'hold' }; })),
        );
        box.append(seg);
        const pickHost = () => pickTarget(layer, {
            title: 'Ride along with', entries: x.others, readings: false,
            done: make => update((cc, id, ed) => { cc.glue = { mode: 'ride', host: make(ed) }; delete cc.once; }),
        });
        if (g.mode === 'ride') {
            const wrap = el('div', 'rowbox');
            if (g.host) wrap.append(chip(g.host, x));
            wrap.append(btn('addb', g.host ? 'Change' : '+ host', pickHost));
            box.append(wrap);
            box.append(el('p', 'phelp', 'Fires whenever its host fires, and stops when the host closes.'));
        } else if (hasPiece(c, 'closeGate')) {
            box.append(el('p', 'phelp', `Ends through its close gate: ${x.lines.find(l => l.label === 'Close gate')?.text ?? ''}`));
        } else {
            box.append(el('p', 'phelp', 'Nothing ends it yet: once fired it stays on for the rest of the chat.'));
            box.append(btn('addb', '+ Close gate', () => x.setOpen('closeGate')));
        }
    } else if (key === 'masks') {
        const masks = Array.isArray(c.masks) ? c.masks : [];
        masks.forEach((m, i) => {
            const ml = el('div', 'mlayer');
            const mh = el('div', 'mlh');
            mh.append(el('span', '', `${i + 1} · ${m.name}`));
            mh.append(
                btn('', ic('eye'), () => x.showMask(m.name), `Show ${m.name} on the canvas`),
                btn('', ic('edit'), () => layer.askText({
                    title: 'Rename mask', value: m.name,
                    done: v => { const to = maskName(v, masks, m.name); update(cc => { cc.masks[i].name = to; }); x.renamedMask(m.name, to); },
                }), `Rename ${m.name}`),
            );
            if (i > 0) mh.append(btn('up', ic('down'), () => update(cc => moveMaskUp(cc, i)), `Move ${m.name} up (lower priority)`));
            mh.append(btn('', ic('trash'), () => { update(cc => { cc.masks.splice(i, 1); }); layer.toast(`Mask ${m.name} removed`); }, `Remove ${m.name}`));
            ml.append(mh);
            ml.append(btn('linkish', `${ic('edit', 's')} Edit text`, () => x.openEntry(m.name)));
            ml.append(el('div', 'sub', 'On when'));
            rowsEditor(ml, x, cc => cc.masks[i].gate ?? [], (cc, r) => { cc.masks[i].gate = r; }, update, false);
            if (!m.gate?.length) ml.append(el('p', 'phelp', 'No gate: used only when picked by hand.'));
            ml.append(el('div', 'sub', 'Off when (close gate)'));
            rowsEditor(ml, x, cc => cc.masks[i].closeGate ?? [], (cc, r) => { cc.masks[i].closeGate = r; }, update, false);
            box.append(ml);
        });
        box.append(btn('addb', '+ Mask', () => layer.askText({
            title: 'New mask', placeholder: 'Mask name, like ruined', ok: 'Add',
            done: v => update(cc => { addMask(cc, v, x.entry.content); }),
        })));
        box.append(el('p', 'phelp', 'The last mask that is on wins. A new mask starts with a copy of the main text.'));
    } else if (key === 'packs') {
        const list = Array.isArray(c.packs) ? c.packs : [];
        const wrap = el('div', 'rowbox');
        list.forEach((p, i) => {
            const ch = el('span', 'chip pack');
            const t = el('span');
            t.innerHTML = ic('tag');
            t.append(`#${p}`);
            ch.append(t, btn('', ic('x'), () => update(cc => { cc.packs.splice(i, 1); }), `Remove #${p}`));
            wrap.append(ch);
        });
        const addPack = name => update(cc => { cc.packs = addToList(Array.isArray(cc.packs) ? cc.packs : [], name); });
        wrap.append(btn('addb', '+ add', () => layer.sheet('Add to pack', sh => {
            for (const p of x.packs.filter(p => !list.includes(p))) sh.append(layer.opt(`#${p}`, () => { layer.close(); addPack(p); }, { icon: 'tag' }));
            sh.append(layer.opt('New pack…', () => layer.askText({
                title: 'New pack', placeholder: 'Pack name (town/inn for one inside another)', ok: 'Add',
                check: v => (/^[A-Za-z0-9][A-Za-z0-9_.\-/]*$/.test(v.replace(/^#/, '')) ? null : 'Letters, numbers, - _ . and / only'),
                done: v => addPack(v.replace(/^#/, '')),
            }), { icon: 'plus' }));
        })));
        box.append(wrap);
    } else if (key === 'once') {
        box.append(el('p', 'phelp', `On. ${x.title} closes right after it fires.`));
    } else if (key === 'by') {
        const seg = el('div', 'seg');
        seg.append(
            btn(c.by === 'user' ? 'on' : '', 'Your messages', () => update(cc => { cc.by = 'user'; })),
            btn(c.by === 'char' ? 'on' : '', 'Character\'s replies', () => update(cc => { cc.by = 'char'; })),
        );
        box.append(seg);
    }
    return box;
}

/** Rows with chips, "+ add" per row and "+ Another row (OR)". */
function rowsEditor(box, x, get, set, update, isGate) {
    const rows = get(x.config) ?? [];
    const pick = (i, title) => pickTarget(x.layer, {
        title, entries: x.others, packs: x.packs, readings: true, greetings: x.greetings, lock: true,
        done: make => update((cc, id, ed) => { set(cc, addToRow(get(cc) ?? [], i, make(ed))); }),
    });
    rows.forEach((row, i) => {
        if (i) box.append(el('div', 'orsep', 'OR'));
        const wrap = el('div', 'rowbox');
        row.forEach((ref, j) => wrap.append(chip(ref, x, () => update(cc => { set(cc, removeFromRow(get(cc) ?? [], i, j)); }))));
        wrap.append(btn('addb', '+ add', () => pick(i, 'Add to this row (AND)')));
        box.append(wrap);
    });
    box.append(btn('addb', rows.length ? '+ Another row (OR)' : '+ add', () => pick(null, rows.length ? 'A new row (OR)' : 'Add')));
    if (isGate && rows.length > 1) box.append(el('p', 'phelp', 'Opens as soon as any row is complete.'));
}

/**
 * The greeting inspector (BUILD_SPEC 15.4): name, opening words, Gates for, Closes for, Used by, Re-pick.
 * @param {object} x { g: {key, ref, title, text, full, changed, fp}, rules, nameOfId, others, packs, layer, edit, inspect, close, ... }
 */
export function renderGreetingInspector(box, x) {
    const { layer, g, rules } = x;
    const body = frame(box, x, 'greet');
    const head = el('div', 'ihead');
    const icn = el('i', 'gicon');
    icn.innerHTML = ic('chat');
    head.append(icn, el('h2', '', g.title), btn('round flat', ic('x'), x.close, 'Close the inspector'));
    body.append(head);
    const pre = el('button', 'ipre');
    pre.type = 'button';
    pre.textContent = g.text || '(empty)';
    pre.addEventListener('click', () => layer.sheet(g.title, sh => { const p = el('div', 'gfull', g.full || '(empty)'); sh.append(p); }, { help: 'Read only. Greetings are edited on the character card.' }));
    body.append(pre);
    if (g.changed) {
        const pr = el('div', 'prob iprob');
        pr.innerHTML = ic('alert', 's');
        pr.append(el('span', '', 'This greeting changed since it was linked, so its rules are paused.'));
        pr.append(btn('linkish acc', 'Re-pick', () => { x.edit((ed, data) => repickGreeting(ed, data, g.ref, g.fp)); layer.toast(`${g.title} re-picked`); }));
        body.append(pr);
    }
    for (const kind of ['gatesFor', 'closesFor']) {
        const p = PIECE[kind];
        const pc = el('div', 'pc open');
        pc.dataset.piece = kind;
        pc.style.setProperty('--c', FAMILY_COLOR[p.family]);
        const ph = el('div', 'pch');
        ph.append(el('b', '', p.label), btn('pq', ic('help'), () => layer.sheet(p.label, sh => sh.append(el('p', 'help', kind === 'gatesFor'
            ? 'These entries or packs open only in a chat that started with this greeting.'
            : 'These entries or packs are closed in a chat that started with this greeting.'))), `What is ${p.label}?`));
        pc.append(ph);
        const wrap = el('div', 'rowbox');
        for (const t of rules[kind]) wrap.append(chip(t, x, () => x.edit(ed => setGreetingRule(ed, g.ref, kind, t, false)), true));
        wrap.append(btn('addb', '+ add', () => pickTarget(layer, {
            title: 'Add a target', entries: x.others, packs: x.packs, readings: false,
            done: make => x.edit(ed => { const t = make(ed); setGreetingRule(ed, g.ref, kind, t, true); }),
        })));
        pc.append(wrap);
        body.append(pc);
    }
    if (rules.usedBy.length) {
        body.append(el('div', 'lbl', 'Used by'));
        for (const u of rules.usedBy) body.append(layer.opt(u.title, () => x.inspect(u.key), { dot: u.dot }));
    }
    body.append(el('p', 'phelp gnote', `${greetingName(g.ref.greeting)} of ${g.ref.name || g.ref.char}. A greeting counts as fired when the chat opened with it.`));
}
