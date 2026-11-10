// The piece bar's links (LAYOUT "Piece bar", pieces-one-by-one): Opens, Closes and Glue between two ends, the
// rows they sit in, locks and waits, switches. Pure: works through a bookEditor on a book's data, so what it
// writes is the same story logic the inspector writes (CONCEPTS 3). An end is one of
//   { t: 'entry', uid }   { t: 'pack', name, mode? }   { t: 'greet', ref }
import { isObject } from '../engine/util.js';
import { addToList, greetingRules, isGreetingRef, reading, same, setGreetingRule } from './pieces.js';

const READING = /^#([^:]+)(?::(all|\d+))?$/;
export const isCond = x => isObject(x) && (Array.isArray(x.lock) || 'wait' in x);
const sameGreeting = (a, b) => isGreetingRef(a) && isGreetingRef(b) && a.char === b.char && a.greeting === b.greeting;
const plainGreeting = ref => ({ greeting: ref.greeting, char: ref.char, name: ref.name, fp: ref.fp });
/** The field a link kind is stored in on the waiting (or closing) side. */
const ROW_FIELD = { open: 'gate', close: 'closeGate' };
const LIST_FIELD = { open: 'gatesFor', close: 'closesFor' };

export const sameEnd = (a, b) => !!a && !!b && a.t === b.t && (a.t === 'entry' ? a.uid === b.uid : a.t === 'pack' ? a.name === b.name : sameGreeting(a.ref, b.ref));

/** The rows of a field, of the entry or of one of its masks; created when `make`. */
export function rowsOf(c, field, mask = null, make = false) {
    const host = mask === null || mask === undefined ? c : c.masks?.[mask];
    if (!host) return [];
    if (!Array.isArray(host[field])) { if (!make) return []; host[field] = []; }
    return host[field];
}

/** A stored ref for an end (giving an entry an id when it has none). */
function refOf(ed, end) {
    if (end.t === 'entry') return ed.idOf(end.uid);
    if (end.t === 'pack') return reading(end.name, end.mode ?? 'any');
    return plainGreeting(end.ref);
}

/** Whether a stored ref names an end. */
export function refIs(ed, x, end) {
    if (end.t === 'entry') { const id = ed.config(end.uid).id; return typeof x === 'string' && !!id && x === id; }
    if (end.t === 'pack') return typeof x === 'string' && READING.exec(x)?.[1] === end.name;
    return sameGreeting(x, end.ref);
}

/** Why a link can't be made between two ends, or null. `kind`: 'open' | 'close' | 'ride'. */
export function whyNot(kind, src, dst) {
    if (!src || !dst) return null;
    if (sameEnd(src, dst)) {
        if (kind === 'close') return 'An entry can\'t link to itself. To close it after it fires, turn on Once, or add the entry itself to its close gate in the inspector (with a wait to close it later).';
        return 'A link needs two different cards.';
    }
    if (dst.t === 'greet') return 'A greeting only starts things: it can\'t wait, close or ride along.';
    if (dst.moment && kind === 'close') return 'A Moment can\'t be closed: once it happens, it has happened. Give it a gate to say when it counts.';
    if ((src.moment || dst.moment) && kind === 'ride') return 'A Moment sends nothing, so nothing rides along with it.';
    if (kind === 'ride') {
        if (src.t !== 'entry' || dst.t !== 'entry') return 'Ride along joins two entries: a pack or a greeting can\'t be a host or a rider.';
        return null;
    }
    if (src.t === 'pack' && dst.t === 'pack') return 'A pack can wait for or be closed by an entry or a greeting, not by another pack.';
    return null;
}

/**
 * Where a link is stored, or null.
 * @returns {{ t: 'row', uid, field, mask, row, j } | { t: 'list', uid, field, j } | { t: 'gatedBy', uid, j } | { t: 'greet', field } | { t: 'glue', uid } | null}
 */
export function findLink(ed, data, kind, src, dst, mask = null) {
    if (!src || !dst) return null;
    if (kind === 'ride') {
        if (dst.t !== 'entry' || src.t !== 'entry') return null;
        const g = ed.config(dst.uid).glue;
        return g?.mode === 'ride' && g.host === ed.config(src.uid).id ? { t: 'glue', uid: dst.uid } : null;
    }
    const field = ROW_FIELD[kind];
    if (dst.t === 'entry') {
        const rows = rowsOf(ed.config(dst.uid), field, mask);
        for (let i = 0; i < rows.length; i++) {
            const j = Array.isArray(rows[i]) ? rows[i].findIndex(x => refIs(ed, x, src)) : -1;
            if (j >= 0) return { t: 'row', uid: dst.uid, field, mask, row: i, j };
        }
        if (mask !== null) return null;
        const dstId = ed.config(dst.uid).id;
        if (src.t === 'entry' && dstId) {
            const list = ed.config(src.uid)[LIST_FIELD[kind]] ?? [];
            const j = list.indexOf(dstId);
            if (j >= 0) return { t: 'list', uid: src.uid, field: LIST_FIELD[kind], j };
        }
        if (src.t === 'greet' && kind === 'open') {
            const j = (ed.config(dst.uid).gatedBy ?? []).findIndex(x => sameGreeting(x, src.ref) && x.via === undefined);
            if (j >= 0) return { t: 'gatedBy', uid: dst.uid, j };
        }
        return null;
    }
    if (dst.t === 'pack') {
        if (src.t === 'entry') {
            const list = ed.config(src.uid)[LIST_FIELD[kind]] ?? [];
            const j = list.findIndex(x => x === `#${dst.name}`);
            return j >= 0 ? { t: 'list', uid: src.uid, field: LIST_FIELD[kind], j } : null;
        }
        if (src.t === 'greet') {
            const r = greetingRules(data, src.ref);
            return r[LIST_FIELD[kind]].includes(`#${dst.name}`) ? { t: 'greet', field: LIST_FIELD[kind] } : null;
        }
    }
    return null;
}

/** The other refs and the conditions in a link's row. */
export function rowOf(ed, loc) {
    if (loc?.t !== 'row') return { others: [], conds: [], lone: true };
    const row = rowsOf(ed.config(loc.uid), loc.field, loc.mask)[loc.row] ?? [];
    const others = row.filter((x, j) => j !== loc.j && !isCond(x));
    return { others, conds: row.filter(isCond), lone: !others.length, count: rowsOf(ed.config(loc.uid), loc.field, loc.mask).length };
}

/**
 * The both/either choice a new link into `dst` follows: 'and' when its rows are one row of several, 'or' when it
 * has several rows, and null when it has one row of one (ask) or none (nothing to ask).
 */
export function joinOf(ed, kind, dst, mask = null, except = null) {
    if (dst?.t !== 'entry') return null;
    const rows = rowsOf(ed.config(dst.uid), ROW_FIELD[kind], mask).map((r, i) => (i === except?.row ? r.filter((x, j) => j !== except.j) : r)).filter(r => r.some(x => !isCond(x)));
    if (!rows.length) return null;
    if (rows.length > 1) return 'or';
    return rows[0].filter(x => !isCond(x)).length > 1 ? 'and' : null;
}

/**
 * Writes a link. `join`: 'and' puts it in the last row with links in it, anything else in a row of its own.
 * `conds` go along into its row (a link turned around keeps its lock and wait). Returns where it went.
 */
export function addLink(ed, data, kind, src, dst, { join = 'or', conds = [], mask = null } = {}) {
    const why = whyNot(kind, src, dst);
    if (why) throw new Error(why);
    if (kind === 'ride') {
        const host = refOf(ed, src);
        ed.update(dst.uid, c => { c.glue = { mode: 'ride', host }; delete c.once; });
        return { t: 'glue', uid: dst.uid };
    }
    if (dst.t === 'entry') {
        const ref = refOf(ed, src);
        let at = null;
        ed.update(dst.uid, c => {
            const rows = rowsOf(c, ROW_FIELD[kind], mask, true);
            let i = -1;
            if (join === 'and') for (let k = rows.length - 1; k >= 0; k--) if (rows[k].some(x => !isCond(x))) { i = k; break; }
            if (i < 0) { rows.push([ref, ...conds]); at = { row: rows.length - 1, j: 0 }; return; }
            const j = rows[i].findIndex(x => same(x, ref));
            if (j >= 0) { at = { row: i, j }; return; }
            const firstCond = rows[i].findIndex(isCond);
            const pos = firstCond < 0 ? rows[i].length : firstCond;
            rows[i].splice(pos, 0, ref);
            for (const x of conds) if (!rows[i].some(y => same(y, x))) rows[i].push(x);
            at = { row: i, j: pos };
        });
        return { t: 'row', uid: dst.uid, field: ROW_FIELD[kind], mask, ...at };
    }
    // Into a pack: Gates for / Closes for on the source.
    if (conds.length) throw new Error('Links into a pack are stored as Gates for or Closes for, which have no row for a lock or a wait.');
    if (src.t === 'greet') { setGreetingRule(ed, src.ref, LIST_FIELD[kind], `#${dst.name}`, true); return { t: 'greet', field: LIST_FIELD[kind] }; }
    ed.update(src.uid, c => { c[LIST_FIELD[kind]] = addToList(Array.isArray(c[LIST_FIELD[kind]]) ? c[LIST_FIELD[kind]] : [], `#${dst.name}`); });
    return findLink(ed, data, kind, src, dst);
}

/**
 * Removes a link. A row left with only locks and waits goes with it; those are returned, so a link turned
 * around can take them along.
 */
export function removeLink(ed, data, kind, src, dst, mask = null) {
    const loc = findLink(ed, data, kind, src, dst, mask);
    if (!loc) return { conds: [], shared: [] };
    let out = { conds: [], shared: [] };
    if (loc.t === 'glue') ed.update(loc.uid, c => { delete c.glue; });
    else if (loc.t === 'row') {
        ed.update(loc.uid, c => {
            const rows = rowsOf(c, loc.field, loc.mask);
            const row = rows[loc.row];
            row.splice(loc.j, 1);
            out.shared = row.filter(x => !isCond(x));
            if (!out.shared.length) { out.conds = row.filter(isCond); rows.splice(loc.row, 1); }
        });
    } else if (loc.t === 'list') ed.update(loc.uid, c => { c[loc.field].splice(loc.j, 1); });
    else if (loc.t === 'gatedBy') ed.update(loc.uid, c => { c.gatedBy.splice(loc.j, 1); });
    else if (loc.t === 'greet') setGreetingRule(ed, src.ref, loc.field, `#${dst.name}`, false);
    return out;
}

/**
 * Why a link can't be turned around, or null. A greeting can't wait; a rider can ride on one host only; a link
 * with a lock or a wait can't turn into a link into a pack.
 */
export function whyNotFlip(ed, data, kind, src, dst, mask = null) {
    if (mask !== null) return 'A mask\'s "on when" always points at the mask.';
    const why = whyNot(kind, dst, src);
    if (why) return src.t === 'greet' ? `${'A greeting can\'t wait for anything, so this link can only point away from it.'}` : why;
    if (kind === 'ride' && ed.config(src.uid).glue?.mode === 'ride') return 'That entry already rides along with another one, and an entry can ride on one host only.';
    const loc = findLink(ed, data, kind, src, dst);
    if (src.t === 'pack' && loc?.t === 'row' && rowOf(ed, loc).lone && rowOf(ed, loc).conds.length) return 'Its lock or wait can\'t go along into a pack. Remove them first.';
    return null;
}

/**
 * Turns a link around: dst now waits for (or is closed by, or rides with) src the other way. A link alone in
 * its row takes the row's locks and waits along; one that shared a row leaves it.
 * @returns {{ shared: any[] }} the refs it was needed together with
 */
export function flipLink(ed, data, kind, src, dst) {
    const why = whyNotFlip(ed, data, kind, src, dst);
    if (why) throw new Error(why);
    const { conds, shared } = removeLink(ed, data, kind, src, dst);
    const back = src.t === 'pack' ? { ...src, mode: undefined } : src;
    addLink(ed, data, kind, dst, back, { join: joinOf(ed, kind, back) ?? 'or', conds });
    return { shared };
}

/** Moves a link into the row with the other links ('and') or into a row of its own ('or'). */
export function setJoin(ed, data, kind, src, dst, join, mask = null) {
    const loc = findLink(ed, data, kind, src, dst, mask);
    if (loc?.t !== 'row') return;
    const { lone } = rowOf(ed, loc);
    if (join === 'or' && lone) return;
    if (join === 'and' && !lone) return;
    const { conds } = removeLink(ed, data, kind, src, dst, mask);
    addLink(ed, data, kind, src, dst, { join, conds, mask });
}

/** Sets how a pack source is read: 'any', 'all' or a number. */
export function setReading(ed, data, kind, src, dst, mode, mask = null) {
    const loc = findLink(ed, data, kind, src, dst, mask);
    if (loc?.t !== 'row') return;
    ed.update(loc.uid, c => { rowsOf(c, loc.field, loc.mask)[loc.row][loc.j] = reading(src.name, mode); });
}

/** How a pack source is read in its row: 'any', 'all' or a number. */
export function readingOf(ed, data, kind, src, dst, mask = null) {
    const loc = findLink(ed, data, kind, src, dst, mask);
    if (loc?.t !== 'row') return 'any';
    const r = READING.exec(rowsOf(ed.config(loc.uid), loc.field, loc.mask)[loc.row][loc.j]);
    return r?.[2] === 'all' ? 'all' : r?.[2] ? Number(r[2]) : 'any';
}

// ---- conditions: locks and waits in a row

/** Puts a lock or wait in a row (a wait before the locks, since a lock is armed after the rest), or a new row. */
export function addCond(ed, uid, field, mask, row, cond) {
    let at = null;
    ed.update(uid, c => {
        const rows = rowsOf(c, field, mask, true);
        if (row === null || row === undefined || !rows[row]) { rows.push([cond]); at = { row: rows.length - 1, j: 0 }; return; }
        const r = rows[row];
        const firstLock = r.findIndex(x => isObject(x) && Array.isArray(x.lock));
        const pos = 'wait' in cond && firstLock >= 0 ? firstLock : r.length;
        r.splice(pos, 0, cond);
        at = { row, j: pos };
    });
    return { uid, field, mask, ...at };
}

export function setCond(ed, at, cond) {
    ed.update(at.uid, c => { const r = rowsOf(c, at.field, at.mask)[at.row]; if (r) r[at.j] = cond; });
}

export function removeCond(ed, at) {
    ed.update(at.uid, c => {
        const rows = rowsOf(c, at.field, at.mask);
        rows[at.row]?.splice(at.j, 1);
        if (rows[at.row] && !rows[at.row].length) rows.splice(at.row, 1);
    });
}

/**
 * Where a lock or wait goes for a link: its row. Links stored as Closes for between two entries move into the
 * closed entry's close gate (the same rule) so they have a row; links into a pack can't hold one.
 * @returns {{ at?: {uid, field, mask, row}, why?: string }}
 */
export function condRowFor(ed, data, kind, src, dst, mask = null) {
    if (kind === 'ride') return { why: 'Glue has no row for a lock or a wait. Put it on the host\'s gate instead.' };
    if (dst.t === 'pack') return { why: 'Links into a pack are stored as Gates for or Closes for, which have no row for a lock or a wait.' };
    let loc = findLink(ed, data, kind, src, dst, mask);
    if (!loc) return { why: 'That link isn\'t there any more.' };
    if (loc.t === 'list' && kind === 'close') {
        removeLink(ed, data, kind, src, dst);
        loc = addLink(ed, data, kind, src, dst, { join: 'or' });
    } else if (loc.t === 'list' || loc.t === 'gatedBy') {
        if (rowsOf(ed.config(dst.uid), 'gate').length) return { why: 'This link is stored as Gates for, on top of rows that are already there, so it has no row of its own. Remove it and link it again to add a lock or a wait.' };
        removeLink(ed, data, kind, src, dst);
        loc = addLink(ed, data, kind, src, dst, { join: 'or' });
    }
    return { at: { uid: loc.uid, field: loc.field, mask: loc.mask ?? null, row: loc.row } };
}

// ---- switch

/** Writes a switch's paths in order, and (when `wait`) makes every path wait for the fork. */
export function setSwitch(ed, data, fork, paths, wait) {
    const pathIds = paths.map(p => ed.idOf(p.uid));
    const forkId = ed.idOf(fork.uid);
    ed.update(fork.uid, c => { c.switch = pathIds; });
    for (const p of paths) {
        const has = !!findLink(ed, data, 'open', fork, p);
        if (wait && !has) addLink(ed, data, 'open', fork, p, { join: 'and' });
        if (!wait && has) removeLink(ed, data, 'open', fork, p);
    }
    return { forkId };
}

/** Whether every path of a list waits for the fork. */
export const pathsWait = (ed, data, fork, paths) => paths.length > 0 && paths.every(p => !!findLink(ed, data, 'open', fork, p));
