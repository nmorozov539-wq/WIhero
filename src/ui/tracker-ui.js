// Trackers in the editor (TRACKERS 2.3, 4, 5): the Tracker piece (which text slots the model writes, and how), a
// slot's value in the open chat with Edit and Clear, and the book's syntax builder.
import { btn, el, swEl } from './dom.js';
import { isObject } from '../engine/util.js';
import { rawConfig } from '../engine/model.js';
import { DEFAULT_SYNTAX, DEFAULT_TEACH, SYNTAX_EXAMPLES, compileSyntax, instruction, sample, syntaxProblems, syntaxWarnings } from '../engine/written.js';
import { writeSlot } from './pieces.js';

/** The text slots of a config: main and each mask, with what is stored for them. */
export function slotsOf(c) {
    const masks = Array.isArray(c?.masks) ? c.masks.filter(m => isObject(m) && typeof m.name === 'string') : [];
    return [{ mask: null, name: 'Main text', written: c?.written }, ...masks.map(m => ({ mask: m.name, name: `Mask ${m.name}`, written: m.written }))]
        .map(s => ({ ...s, written: s.written === true ? {} : isObject(s.written) ? s.written : null }));
}

/**
 * The Tracker piece's editor (inspector).
 * @param {HTMLElement} box
 * @param {object} x The inspector's context; `x.tracker` is { shared, labelOf(mask), values(mask) → string | undefined | null,
 *   set(mask, text), builder() } (values null: no chat open).
 * @param {(fn: (c: object) => void) => void} update
 */
export function trackerEditor(box, x, update) {
    const t = x.tracker ?? {};
    const slots = slotsOf(x.config);
    for (const s of slots) {
        const on = !!s.written;
        const row = el('div', 'mlayer trk');
        const head = el('div', 'mlh');
        head.append(el('span', '', s.name), swEl(on, v => update(cc => writeSlot(cc, s.mask, v ? { ...(t.shared ?? {}) } : null)), `${s.name} written by the model`));
        row.append(head);
        if (on) slotFields(row, s, x, update);
        else row.append(el('p', 'phelp', s.mask ? 'Written by hand, as usual.' : 'Written by hand, as usual. Switch on to let the model write it.'));
        box.append(row);
    }
    const first = slots.find(s => s.written);
    if (first) {
        const syntax = t.shared?.syntax ?? DEFAULT_SYNTAX;
        const label = first.written.label || t.labelOf?.(first.mask) || 'Label';
        box.append(el('p', 'phelp', `The model writes ${sample(syntax, { label, shape: first.written.shape ?? 'line' }, '…').replace(/\n/g, ' ')}${t.shared?.teach?.on ? '. WI Hero teaches it the format.' : '. Your preset or card tells the model to write it.'}`));
        if (t.builder) box.append(btn('addb', 'Syntax and teaching…', t.builder));
    }
}

function slotFields(row, s, x, update) {
    const t = x.tracker ?? {};
    const w = s.written;
    const patch = fn => update(cc => {
        const target = s.mask ? cc.masks?.find(m => m.name === s.mask) : cc;
        if (!target) return;
        target.written = isObject(target.written) ? target.written : {};
        fn(target.written);
    });
    const field = (label, value, placeholder, set) => {
        const input = el('input', 'kin');
        input.value = value ?? '';
        input.placeholder = placeholder;
        input.setAttribute('aria-label', `${s.name}: ${label}`);
        input.addEventListener('change', () => set(input.value.trim()));
        input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); } });
        row.append(el('div', 'sub', label), input);
    };
    field('Label', w.label, t.labelOf?.(s.mask) ?? 'Label', v => patch(o => { if (v) o.label = v; else delete o.label; }));
    const seg = el('div', 'pseg');
    seg.style.setProperty('--c', 'var(--p-track)');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', `${s.name}: shape`);
    for (const [v, label] of [['line', 'One line'], ['block', 'Block (many lines)']]) {
        const cur = (w.shape ?? 'line') === v;
        const b = btn(cur ? 'on' : '', label, () => { if (!cur) patch(o => { o.shape = v; }); });
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(cur));
        seg.append(b);
    }
    row.append(el('div', 'sub', 'Shape'), seg);
    field('What it is (for the model)', w.describe, 'coins the player carries', v => patch(o => { if (v) o.describe = v; else delete o.describe; }));
    const show = el('div', 'trkshow');
    show.append(el('span', '', 'Show in chat'), swEl(w.show !== false, v => patch(o => { if (v) delete o.show; else o.show = false; }), `${s.name}: show in chat`));
    row.append(show);
    const lab = el('div', 'trkshow');
    lab.append(el('span', '', 'Send with its label'), swEl(w.labelled !== false, v => patch(o => { if (v) delete o.labelled; else o.labelled = false; }), `${s.name}: send with its label`));
    // The example uses this tracker's own label and the book's syntax (playtest: it always said [Gold: 12]).
    const example = sample(t.shared?.syntax ?? DEFAULT_SYNTAX, { label: w.label || t.labelOf?.(s.mask) || 'Label', shape: w.shape ?? 'line' }, '12').replace(/\n/g, ' ');
    row.append(lab, el('p', 'phelp', w.labelled !== false ? `The model reads it as it writes it, like ${example}.` : 'The model reads the bare value, like 12.'));
    valueLine(row, x, s.mask);
}

/**
 * A slot's value in the open chat, with Edit and Clear (TRACKERS 2.3). Nothing without a chat.
 * @param {object} x { layer, tracker: { values(mask), set(mask, text) } }
 */
export function valueLine(box, x, mask) {
    const t = x.tracker;
    const v = t?.values?.(mask);
    if (v === null || !t) return;
    const line = el('div', 'trkval');
    const text = v === undefined ? 'Nothing written yet in this chat' : v === '' ? 'Cleared in this chat' : v;
    const shown = el('span', v ? 'v' : 'none', text);
    shown.title = v ?? '';
    line.append(el('b', '', 'In this chat'), shown);
    const acts = el('span', 'acts');
    acts.append(btn('linkish', 'Edit', () => askValue(x.layer, { title: mask ? `Value of ${mask}` : 'Value', value: v ?? '', done: text2 => t.set(mask, text2) })));
    if (v) acts.append(btn('linkish', 'Clear', () => t.set(mask, '')));
    line.append(acts);
    box.append(line);
}

/** A small form with a text area, for a value of any length. Empty is allowed (it clears). */
export function askValue(layer, { title, value, done }) {
    layer.scrim();
    const d = el('div', 'dlg');
    d.setAttribute('role', 'dialog');
    d.append(el('h2', '', title));
    const ta = el('textarea', 'trkta');
    ta.value = value ?? '';
    ta.rows = Math.min(10, Math.max(3, String(value ?? '').split('\n').length + 1));
    ta.setAttribute('aria-label', title);
    const row = el('div', 'row');
    row.append(btn('', 'Cancel', layer.close), btn('pri', 'Save', () => { layer.close(); done(ta.value.trim()); }));
    d.append(ta, el('p', 'phelp', 'Saved on the latest message, so it rewinds with the chat. Empty clears it.'), row);
    layer.layer.append(d);
    setTimeout(() => ta.focus(), 0);
    return d;
}

/**
 * The syntax builder (TRACKERS 5): one syntax per book, its teaching, a live test on the open chat's last replies,
 * warnings, the instruction WI Hero would send, and short advice. Saving writes the syntax and teaching onto every
 * written slot of the book.
 * @param {object} layer
 * @param {object} o { book, slots: [{ key, label, shape, describe }], syntax, teach, texts: string[] (newest last),
 *   values: Map, save(syntax, teach) }
 */
export function openBuilder(layer, o) {
    let syntax = { ...DEFAULT_SYNTAX, ...(o.syntax ?? {}) };
    let teach = { ...DEFAULT_TEACH, ...(o.teach ?? {}) };
    layer.sheet(`Tracker syntax · ${o.book}`, sh => {
        sh.classList.add('trkb');
        sh.append(el('p', 'help', 'One syntax for every tracker in this book. {label} is the tracker\'s label, {value} what the model writes.'));
        const ex = el('div', 'rowbox');
        const inputs = {};
        for (const e of SYNTAX_EXAMPLES) {
            ex.append(btn('addb', e.name, () => {
                syntax = { ...e.syntax };
                for (const k of Object.keys(inputs)) inputs[k].value = syntax[k];
                draw();
            }));
        }
        sh.append(el('div', 'sub', 'Start from'), ex);
        const input = (key, label) => {
            const i = el('input', 'kin mono');
            i.value = syntax[key];
            i.setAttribute('aria-label', label);
            i.addEventListener('input', () => { syntax[key] = i.value; draw(); });
            inputs[key] = i;
            sh.append(el('div', 'sub', label), i);
        };
        input('line', 'One line');
        input('open', 'Block opens with');
        input('close', 'Block closes with');

        const tr = el('div', 'trkshow');
        tr.append(el('span', '', 'WI Hero teaches the model'), swEl(teach.on, v => { teach.on = v; depth.hidden = !v; draw(); }, 'WI Hero teaches the model'));
        sh.append(tr);
        const depth = el('label', 'trkdepth');
        const di = el('input', 'kin');
        di.type = 'number';
        di.min = '0';
        di.max = '100';
        di.value = String(teach.depth);
        di.addEventListener('input', () => { const n = Number(di.value); if (Number.isInteger(n) && n >= 0 && n <= 100) { teach.depth = n; draw(); } });
        depth.append(el('span', '', 'Depth (messages from the end)'), di);
        depth.hidden = !teach.on;
        sh.append(depth);
        sh.append(el('p', 'phelp', 'Off: your preset or card already tells the model what to write; WI Hero only reads. '
            + 'On: WI Hero adds one short instruction to the prompt and takes old tracker lines out of the history.'));

        const live = el('div', 'trklive');
        sh.append(live);
        sh.append(el('div', 'sub', 'Advice'));
        const tips = el('ul', 'phelp trktips');
        for (const tip of ['Keep labels short and different from each other.', 'Ask for the lines at the very end of the reply.',
            'Use a block only when the value really needs several lines.', 'One fact per label: Gold, not Gold and gems.']) tips.append(el('li', '', tip));
        sh.append(tips);
        const row = el('div', 'row trkrow');
        const save = btn('pri', 'Save', () => { layer.close(); o.save(syntax, teach); });
        row.append(btn('', 'Cancel', layer.close), save);
        sh.append(row);

        function draw() {
            live.replaceChildren();
            const problems = syntaxProblems(syntax, o.slots);
            save.disabled = problems.length > 0;
            if (problems.length) {
                const p = el('div', 'prob');
                p.append(el('span', '', `Can't be read: ${problems.join('; ')}.`));
                live.append(p);
                return;
            }
            const texts = o.texts ?? [];
            for (const w of syntaxWarnings(syntax, o.slots, texts)) live.append(el('div', 'trkwarn', w));
            live.append(el('div', 'sub', texts.length ? `Test on the last ${texts.length} ${texts.length === 1 ? 'reply' : 'replies'}` : 'Test (open a chat to test on its replies)'));
            const r = compileSyntax(syntax, o.slots);
            const found = new Map();
            for (const t of texts) for (const [k, v] of r.read(t)) found.set(k, v);
            for (const s of o.slots) {
                const line = el('div', 'trkval');
                line.append(el('b', '', s.label));
                const v = found.get(s.key);
                line.append(el('span', v === undefined ? 'none' : 'v', v === undefined ? (texts.length ? 'not found' : sample(syntax, s, '…').replace(/\n/g, ' ')) : v === '' ? '(cleared)' : v));
                live.append(line);
            }
            if (teach.on) {
                live.append(el('div', 'sub', 'Sent to the model'));
                live.append(el('pre', 'trkpre', instruction({ syntax }, o.slots, o.values ?? new Map()) || '(nothing: no tracker is open)'));
            }
        }
        draw();
    }, { cls: 'wide' });
}

/**
 * What the Tracker piece, the entry page and the builder need for one entry (`x.tracker`).
 * @param {object} d { book, node (the editor model's node), model (the editor model of the book), hooks, ctx, layer,
 *   editBook(fn(ed, data)), after() (redraw), toast(text) }
 */
export function trackerContext({ book, node, model, hooks, ctx, layer, editBook, after = () => {}, toast = () => {} }) {
    const t = model?.trackers?.get(book) ?? null;
    const key = mask => (node?.key ? (mask ? `${node.key}|m:${mask}` : node.key) : null);
    let live = null;
    const values = () => (live ??= (() => { try { return hooks.values(); } catch { return new Map(); } })());
    return {
        shared: t ? { syntax: t.syntax, teach: t.teach } : null,
        labelOf: mask => model?.slots?.get(key(mask))?.label ?? (mask ? `${node?.label ?? 'Entry'} · ${mask}` : node?.label ?? 'Label'),
        /** The value in the open chat; null when no chat is open or the running books don't have this tracker. */
        values(mask) {
            const k = key(mask);
            if (!k || !ctx().chat?.length || !hooks.model?.slots?.has(k)) return null;
            return values().get(k);
        },
        async set(mask, text) {
            const k = key(mask);
            if (!k) return;
            await hooks.setSlotValue(k, text);
            live = null;
            toast(text ? 'Value saved on the latest message' : 'Value cleared');
            after();
        },
        builder: t ? () => {
            const chat = ctx().chat ?? [];
            const texts = chat.filter(m => m && !m.is_user && !m.is_system).slice(-5).map(m => m.mes ?? '');
            openBuilder(layer, {
                book, slots: t.slots.filter(s => !s.bad), syntax: t.syntax, teach: t.teach, texts, values: values(),
                save: (syntax, teach) => editBook((ed, data) => {
                    // Only entries that already have a written slot: update() would give any other entry an id.
                    for (const e of Object.values(data?.entries ?? {})) {
                        if (slotsOf(rawConfig(e) ?? {}).some(sl => sl.written)) ed.update(e.uid, cc => setShared(cc, syntax, teach));
                    }
                }),
            });
        } : null,
    };
}

/** Copies a book's syntax and teaching onto every written slot of one entry's config. */
export function setShared(cc, syntax, teach) {
    const put = o => { if (isObject(o.written)) { o.written.syntax = { ...syntax }; o.written.teach = { ...teach }; } else if (o.written === true) o.written = { syntax: { ...syntax }, teach: { ...teach } }; };
    put(cc);
    if (Array.isArray(cc.masks)) for (const m of cc.masks) if (isObject(m)) put(m);
}
