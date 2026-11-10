// Editing story logic (CONCEPTS 3, LAYOUT "Inspector"): the pieces, their rows and lists, the Story moves on
// shortcut, masks, and the rules greetings put on entries (BUILD_SPEC 15.3). Pure: works on a book's data and
// writes through writeConfig, so the stored shape is always BUILD_SPEC 2.
import { bookIds, newId, writeConfig } from '../book.js';
import { normalize, rawConfig } from '../engine/model.js';
import { canonical, isObject } from '../engine/util.js';

/** The pieces in matrix order (LAYOUT "Inspector"), with their help lines. */
export const PIECES = [
    { key: 'gate', label: 'Gate', family: 'open', help: 'What this entry waits for before it may fire. A row means "all of these"; the gate opens as soon as any row is complete.' },
    { key: 'gatesFor', label: 'Gates for', family: 'open', help: 'These entries or packs also wait for this one to fire, on top of their own gate.' },
    { key: 'closeGate', label: 'Close gate', family: 'close', help: 'When this entry closes for good. Built like a gate: rows, any complete row closes it.' },
    { key: 'closesFor', label: 'Closes for', family: 'close', help: 'When this entry fires, these entries or packs close for good.' },
    { key: 'glue', label: 'Glue', family: 'glue', help: 'Keeps the entry on whether or not its key words match: ride along with a host, or hold until it closes.' },
    { key: 'switch', label: 'Switch', family: 'close', help: 'Makes this entry a fork: when one path fires, every other path closes for good.' },
    { key: 'masks', label: 'Masks', family: 'mask', help: 'Other versions of the text. The last mask that is on wins; below them all is the main text.' },
    { key: 'packs', label: 'Packs', family: 'pack', help: 'Tags that group entries, so rules can treat them as one. town/inn is inside town.' },
    { key: 'once', label: 'Once', family: 'close', help: 'Fires one time, then closes from the next message on.' },
    { key: 'by', label: 'Who triggers', family: 'by', help: 'Whose messages the key words are matched against. Without it, both count.' },
    { key: 'written', label: 'Tracker', family: 'track', help: 'The model writes this text: WI Hero reads each new reply for its line and sends the newest value. The main text or any mask can be written.' },
];
export const PIECE = Object.fromEntries(PIECES.map(p => [p.key, p]));
/** What a Moment takes (CONCEPTS 3.13): its own gate (which arms it), and what it opens and closes. */
export const MOMENT_PIECES = ['gate', 'gatesFor', 'closesFor', 'packs']; // a Moment can be packed, and leave its pack (#5)
export const ROW_FIELDS = ['gate', 'closeGate'];
export const LIST_FIELDS = ['gatesFor', 'closesFor', 'switch', 'packs'];

const READING = /^#([^:]+)(?::(all|\d+))?$/;
export const isGreetingRef = x => isObject(x) && 'greeting' in x;
export const isEntryRef = x => typeof x === 'string' && !x.startsWith('#');
export const same = (a, b) => canonical(a) === canonical(b);

/** Whether a config has a piece. */
export function hasPiece(c, key) {
    const v = c?.[key];
    if (key === 'once') return v === true;
    if (key === 'by') return v === 'user' || v === 'char';
    if (key === 'glue') return isObject(v);
    if (key === 'written') return isObject(v) || v === true || (Array.isArray(c?.masks) && c.masks.some(m => isObject(m) && isObject(m.written)));
    return Array.isArray(v) && v.length > 0;
}

/** The pieces a config doesn't have yet that may be added. Once isn't offered on glued entries (CONCEPTS 3.5). */
export function missingPieces(c) {
    if (c?.moment === true) return PIECES.filter(p => MOMENT_PIECES.includes(p.key) && !hasPiece(c, p.key));
    // Who triggers, Once and Tracker are settings in the inspector, not pieces to add (#14, #31, #7).
    return PIECES.filter(p => !hasPiece(c, p.key) && p.key !== 'once' && p.key !== 'by' && p.key !== 'written');
}

/** A new, empty piece. Row and list pieces start empty; the editor fills them. */
export function addPiece(c, key) {
    if (key === 'once') c.once = true;
    else if (key === 'by') c.by = 'user';
    else if (key === 'glue') { c.glue = { mode: 'hold' }; delete c.once; }
    else if (key === 'written') c.written = {};
    else if (!Array.isArray(c[key])) c[key] = [];
}

export function removePiece(c, key) {
    delete c[key];
    if (key === 'written' && Array.isArray(c.masks)) for (const m of c.masks) if (isObject(m)) writeSlot(c, m.name, null);
}

/**
 * Makes a text slot written by the model (TRACKERS 7), or takes that off (`value` null). A mask that was only
 * written gets placeholder text, or the model would skip it.
 * @param {string | null} mask The mask's name, or null for the main text.
 */
export function writeSlot(c, mask, value) {
    const target = mask ? (Array.isArray(c.masks) ? c.masks.find(m => isObject(m) && m.name === mask) : null) : c;
    if (!target) return;
    if (value === null) {
        delete target.written;
        if (mask && !String(target.content ?? '').trim()) target.content = 'Write this version here.';
    } else {
        target.written = value;
    }
}

/** Drops what is empty, so the stored config stays as small as the pieces it has. */
export function tidyConfig(c) {
    for (const k of ROW_FIELDS) if (Array.isArray(c[k])) { c[k] = c[k].filter(r => Array.isArray(r) && r.length); if (!c[k].length) delete c[k]; }
    for (const k of [...LIST_FIELDS, 'gatedBy']) if (Array.isArray(c[k]) && !c[k].length) delete c[k];
    if (Array.isArray(c.masks)) {
        for (const m of c.masks) {
            if (!isObject(m)) continue;
            for (const k of ROW_FIELDS) if (Array.isArray(m[k])) { m[k] = m[k].filter(r => Array.isArray(r) && r.length); if (!m[k].length) delete m[k]; }
        }
        if (!c.masks.length) delete c.masks;
    }
    if (c.once !== true) delete c.once;
    if (c.by !== 'user' && c.by !== 'char') delete c.by;
    if (!isObject(c.glue)) delete c.glue;
    return c;
}

// ---- rows (gate, close gate, mask gates) and lists

/** Adds an item to row `i`, or as a new row (OR) when `i` is null. Duplicates in a row are skipped. */
export function addToRow(rows, i, ref) {
    if (i === null || i === undefined || !rows[i]) { rows.push([ref]); return rows; }
    if (!rows[i].some(x => same(x, ref))) rows[i].push(ref);
    return rows;
}

/** Removes item j of row i; an emptied row goes too. */
export function removeFromRow(rows, i, j) {
    rows[i]?.splice(j, 1);
    if (rows[i] && !rows[i].length) rows.splice(i, 1);
    return rows;
}

export function addToList(list, value) {
    if (!list.some(x => same(x, value))) list.push(value);
    return list;
}

/**
 * "and" to "or" (#20): splits row `i` before item `j` into two rows, either one. Locks and waits stay with the
 * part they are in.
 */
export function splitRow(rows, i, j) {
    const r = rows[i];
    if (!Array.isArray(r) || j <= 0 || j >= r.length) return rows;
    rows.splice(i, 1, r.slice(0, j), r.slice(j));
    return rows;
}

/** "or" to "and" (#20): merges row `i` into row `a` (both); links first, then waits, then locks. */
export function mergeRows(rows, a, i) {
    if (!Array.isArray(rows[a]) || !Array.isArray(rows[i]) || a === i) return rows;
    const all = [...rows[a], ...rows[i]];
    const isLock = x => isObject(x) && Array.isArray(x.lock);
    const isWait = x => isObject(x) && 'wait' in x;
    const merged = [...all.filter(x => !isLock(x) && !isWait(x)), ...all.filter(isWait), ...all.filter(isLock)];
    const [lo, hi] = a < i ? [a, i] : [i, a];
    rows.splice(hi, 1);
    rows[lo] = merged.filter((x, k) => merged.findIndex(y => same(y, x)) === k);
    return rows;
}

/** Entry ids a set of rows reads (not packs, locks, waits or greetings). */
export const entryIdsIn = rows => [...new Set((Array.isArray(rows) ? rows : []).flat().filter(isEntryRef))];

/**
 * The Story moves on shortcut (CONCEPTS 3.5): the gate's entries this entry doesn't close yet.
 * @returns {{ ids: string[], missing: string[] }}
 */
export function movesOn(c) {
    const ids = entryIdsIn(c.gate);
    const closes = new Set((Array.isArray(c.closesFor) ? c.closesFor : []).filter(isEntryRef));
    return { ids, missing: ids.filter(id => !closes.has(id)) };
}

/** Writes Closes for to every gate entry not covered yet. Returns what was added. */
export function applyMovesOn(c) {
    const { missing } = movesOn(c);
    if (missing.length) c.closesFor = [...(Array.isArray(c.closesFor) ? c.closesFor : []), ...missing];
    return missing;
}

// ---- masks

const MASK_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
/** A mask name as the model accepts it: a slug, unique among the entry's masks. */
export function maskName(text, masks, except = null) {
    const base = String(text ?? '').trim().replace(/\s+/g, '-').replace(/[^A-Za-z0-9_.:-]/g, '').replace(/^[^A-Za-z0-9]+/, '') || 'mask';
    const taken = new Set((masks ?? []).filter(isObject).map(m => m.name).filter(n => n !== except));
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
    return MASK_NAME.test(name) ? name : 'mask';
}

/** Adds a mask, its text starting as a copy of the main text (an empty mask would be skipped). */
export function addMask(c, name, content) {
    c.masks = Array.isArray(c.masks) ? c.masks : [];
    const m = { name: maskName(name, c.masks), content: String(content ?? '').trim() ? content : 'Write this version here.' };
    c.masks.push(m);
    return m;
}

/** Moves a mask up the list: lower priority (the last mask that is on wins). */
export function moveMaskUp(c, i) {
    if (i > 0 && Array.isArray(c.masks)) [c.masks[i - 1], c.masks[i]] = [c.masks[i], c.masks[i - 1]];
}

// ---- refs, as chips

/**
 * A ref in words, for a chip.
 * @param {*} ref
 * @param {(id: string) => string} nameOfId
 * @returns {{ text: string, kind: 'entry' | 'pack' | 'lock' | 'wait' | 'greeting' | 'bad' }}
 */
export function refLabel(ref, nameOfId) {
    if (typeof ref === 'string') {
        const r = READING.exec(ref);
        if (!ref.startsWith('#')) return { text: nameOfId(ref) ?? ref, kind: 'entry' };
        if (!r) return { text: ref, kind: 'bad' };
        return { text: `${r[2] === 'all' ? 'all of' : r[2] ? `${r[2]} of` : 'any of'} #${r[1]}`, kind: 'pack' };
    }
    if (isObject(ref) && Array.isArray(ref.lock)) return { text: ref.lock.map(p => `"${p}"`).join(' or ') + (ref.by === 'user' ? ' (you)' : ref.by === 'char' ? ' (character)' : ''), kind: 'lock' };
    if (isObject(ref) && 'wait' in ref) return { text: `${ref.wait} message${ref.wait === 1 ? '' : 's'}${ref.by === 'user' ? ' of yours' : ref.by === 'char' ? ' of the character' : ''}`, kind: 'wait' };
    if (isGreetingRef(ref)) return { text: `${ref.name || ref.char} · ${greetingName(ref.greeting)}`, kind: 'greeting' };
    return { text: '?', kind: 'bad' };
}

export const greetingName = n => (n === 0 ? 'Greeting' : `Alt ${n}`);
/** A pack reading as stored: '#town', '#town:all', '#town:2'. */
export const reading = (pack, mode) => (mode === 'all' ? `#${pack}:all` : Number.isInteger(mode) && mode > 0 ? `#${pack}:${mode}` : `#${pack}`);
/** Packs used in a book, nested ones with their parents. */
export function packsOf(data) {
    const set = new Set();
    for (const e of Object.values(data?.entries ?? {})) {
        const c = configOf(e);
        for (const p of Array.isArray(c?.packs) ? c.packs : []) {
            if (typeof p !== 'string' || !p) continue;
            const parts = p.split('/');
            for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'));
        }
    }
    return [...set].sort();
}

const configOf = e => { const raw = rawConfig(e); return raw ? normalize(raw).config : null; };

/**
 * Renames a pack (#21) everywhere a book names it: members' `packs` (nested packs move with it, `town/inn` →
 * `harbor/inn`), and every `#town`, `#town:all`, `#town:2` a rule reads or targets, greeting `via`s included.
 * Returns how many entries changed. Notes and written text are left alone.
 */
export function renamePack(ed, data, from, to) {
    const moved = name => (name === from ? to : name.startsWith(`${from}/`) ? `${to}${name.slice(from.length)}` : null);
    const ref = str => {
        const m = /^#([^:]+)(:.*)?$/.exec(str);
        const n = m && moved(m[1]);
        return n === null || !m ? str : `#${n}${m[2] ?? ''}`;
    };
    const walk = x => (typeof x === 'string' ? ref(x) : Array.isArray(x) ? x.map(walk)
        : isObject(x) ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, k === 'note' || k === 'written' ? v : walk(v)])) : x);
    let n = 0;
    for (const e of Object.values(data.entries)) {
        const c = configOf(e);
        if (!c || !JSON.stringify(c).includes(from)) continue;
        const next = { ...walk(c), ...(Array.isArray(c.packs) ? { packs: [...new Set(c.packs.map(p => (typeof p === 'string' ? moved(p) ?? p : p)))] } : {}) };
        if (canonical(next) === canonical(c)) continue;
        ed.update(e.uid, cc => { for (const k of Object.keys(cc)) delete cc[k]; Object.assign(cc, next); });
        n++;
    }
    return n;
}

// ---- the book editor

/**
 * Edits story logic on a book's data. An entry gets an id the first time it gets a piece or is aimed at
 * (BUILD_SPEC 2.4); `created` lists those, so the caller can rekey its settings (folders, canvas).
 */
export function bookEditor(data) {
    const created = [];
    const taken = bookIds(data);
    const config = uid => configOf(data.entries[uid]) ?? {};
    const write = (uid, c) => {
        tidyConfig(c);
        writeConfig(data, uid, Object.keys(c).length ? c : null);
    };
    /** The entry's id, giving it one if it has none. */
    function idOf(uid) {
        const c = config(uid);
        if (typeof c.id === 'string' && c.id) return c.id;
        const id = newId(data.entries[uid], taken);
        taken.add(id);
        write(uid, { id, ...c });
        created.push([Number(uid), id]);
        return id;
    }
    /** Changes an entry's config through `fn(config, id)`. */
    function update(uid, fn) {
        idOf(uid);
        const c = config(uid);
        const out = fn(c, c.id);
        write(uid, c);
        return out;
    }
    const uidOfId = id => Object.values(data.entries).find(e => configOf(e)?.id === id)?.uid;
    const membersOf = pack => Object.values(data.entries).filter(e => (configOf(e)?.packs ?? []).some(p => p === pack || (typeof p === 'string' && p.startsWith(`${pack}/`)))).map(e => e.uid);
    return { config, idOf, update, uidOfId, membersOf, created };
}

/**
 * Sets an entry's sticky note (AFTER_V1): an author note shown beside its card on the canvas. It lives in the
 * entry's `extensions.wihero.note`, which ST never puts in the prompt. Empty text removes it.
 */
export function writeNote(data, uid, text) {
    const note = String(text ?? '').trim();
    bookEditor(data).update(uid, c => { if (note) c.note = note; else delete c.note; });
}

/** Asks for an entry's sticky note and saves it. */
export function askNote(layer, library, book, uid, current) {
    layer.askText({
        title: current ? 'Edit note' : 'Add a note', placeholder: 'TODO: second way into the mill', value: current ?? '', ok: 'Save', allowEmpty: true,
        done: v => library.change(book, d => writeNote(d, uid, v)),
    });
}

// ---- greetings (BUILD_SPEC 15.3): their rules live on the entries they touch

const sameGreeting = (a, b) => isGreetingRef(a) && isGreetingRef(b) && a.char === b.char && a.greeting === b.greeting;
const onlyGreetingRow = (row, ref) => Array.isArray(row) && row.length === 1 && sameGreeting(row[0], ref);

/**
 * What a greeting does in a book: the entries and packs it gates and closes, and the entries that read it.
 * @returns {{ gatesFor: string[], closesFor: string[], usedBy: number[] }} targets as ids or '#pack', readers as uids
 */
export function greetingRules(data, ref) {
    const gatesFor = new Set();
    const closesFor = new Set();
    const usedBy = new Set();
    for (const e of Object.values(data?.entries ?? {})) {
        const c = configOf(e);
        if (!c) continue;
        const target = x => (typeof x.via === 'string' ? x.via : c.id);
        for (const x of Array.isArray(c.gatedBy) ? c.gatedBy : []) if (sameGreeting(x, ref) && target(x)) gatesFor.add(target(x));
        for (const row of Array.isArray(c.closeGate) ? c.closeGate : []) {
            if (onlyGreetingRow(row, ref)) { if (target(row[0])) closesFor.add(target(row[0])); } else if (Array.isArray(row) && row.some(x => sameGreeting(x, ref))) usedBy.add(e.uid);
        }
        const reads = rows => (Array.isArray(rows) ? rows : []).some(r => Array.isArray(r) && r.some(x => sameGreeting(x, ref)));
        if (reads(c.gate) || (Array.isArray(c.masks) && c.masks.some(m => isObject(m) && (reads(m.gate) || reads(m.closeGate))))) usedBy.add(e.uid);
    }
    return { gatesFor: [...gatesFor], closesFor: [...closesFor], usedBy: [...usedBy] };
}

/**
 * Adds or removes a greeting's Gates for / Closes for on a target (an entry id or '#pack'). A pack target is
 * written on every current member with `via` (BUILD_SPEC 15.3).
 * @param {'gatesFor' | 'closesFor'} kind
 */
export function setGreetingRule(ed, ref, kind, target, on) {
    const pack = target.startsWith('#') ? target.slice(1) : null;
    const uids = pack ? ed.membersOf(pack) : [ed.uidOfId(target)].filter(u => u !== undefined);
    const stored = pack ? { ...plainRef(ref), via: target } : plainRef(ref);
    for (const uid of uids) {
        ed.update(uid, c => {
            const match = x => sameGreeting(x, ref) && (pack ? x.via === target : x.via === undefined);
            if (kind === 'gatesFor') {
                const list = (Array.isArray(c.gatedBy) ? c.gatedBy : []).filter(x => !match(x));
                c.gatedBy = on ? [...list, stored] : list;
            } else {
                const rows = (Array.isArray(c.closeGate) ? c.closeGate : []).filter(r => !(Array.isArray(r) && r.length === 1 && match(r[0])));
                c.closeGate = on ? [...rows, [stored]] : rows;
            }
        });
    }
    return uids.length;
}

/** Re-pick (15.2): rewrites a greeting's fingerprint wherever the book stores it. */
export function repickGreeting(ed, data, ref, fp) {
    let n = 0;
    const fix = x => { if (sameGreeting(x, ref) && x.fp !== fp) { x.fp = fp; n++; } return x; };
    const fixRows = rows => (Array.isArray(rows) ? rows.map(r => (Array.isArray(r) ? r.map(fix) : r)) : rows);
    for (const e of Object.values(data.entries)) {
        const c = configOf(e);
        if (!c || !JSON.stringify(c).includes('"greeting"')) continue;
        ed.update(e.uid, x => {
            if (Array.isArray(x.gatedBy)) x.gatedBy = x.gatedBy.map(fix);
            for (const k of ['gate', 'closeGate']) if (x[k] !== undefined) x[k] = fixRows(x[k]);
            if (Array.isArray(x.masks)) for (const m of x.masks) if (isObject(m)) for (const k of ['gate', 'closeGate']) { if (m[k] === undefined) continue; m[k] = fixRows(m[k]); }
        });
    }
    return n;
}

const plainRef = ref => ({ greeting: ref.greeting, char: ref.char, name: ref.name, fp: ref.fp });
