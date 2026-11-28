// WI Hero's way into SillyTavern's books: a working copy per book, saved through ST's own path (TECHNICAL_NOTES 9),
// and the book-level actions (create, rename, duplicate, delete, export, global, links, World Info settings).
// SillyTavern is reached through `ctx()` and the `WI` module namespace passed in (live bindings of world-info.js).
import { upgradeBook } from '../book.js';
import { writeBook as persistBook } from './book-write.js';
import { adoptUiFields, forgetReusedNames } from './data.js';
import { perf } from './perf.js';

const SAVE_DELAY = 350;
/**
 * While typing, each change pushes a pending save further back: 350 → 525 → 788 → 1000 ms. A change after a pause
 * (nothing waiting) keeps SAVE_DELAY. The cost is a larger crash-loss window while typing, up to about a second;
 * flush on hide/close still bounds it, but a hard process kill can lose that last second of typing.
 */
const SAVE_DELAY_MAX = 1000;
/** A failed save is tried again after this, a few times, before the book is left unsaved until its next change. */
const RETRY_DELAY = 5000;
const RETRIES = 3;
/** How long a failed As imported copy waits before the book's next open tries it again. */
const SEED_RETRY = 60000;
/**
 * How many working copies stay loaded at once (M2). Book data is the big retained thing: a 1,000-entry book is
 * roughly a megabyte serialized, and Home only needs a count. Eight covers the open book plus a few tabs, and keeps
 * a 40-book Home from ending up with the whole library in memory. Pinned books (open, dirty, saving, failed, history,
 * reserved, loading) are never evicted, so the real count can be higher; `stats()` says by how much.
 */
export const MAX_COPIES = 8;
/** The cheap default summary: a book's entry count. Home passes a richer one (visible entries and tokens). */
const countOf = data => Object.keys(data?.entries ?? {}).length;
const defaultSummary = (name, data) => ({ entries: countOf(data), total: countOf(data), tokens: 0 });

/**
 * @param {object} deps
 * @param {() => object} deps.ctx SillyTavern.getContext
 * @param {object} deps.WI the world-info.js module namespace
 * @param {object} deps.powerUser power_user
 * @param {object} deps.settings WI Hero's extension settings
 * @param {() => void} deps.saveSettings
 * @param {(name: string, data: object) => Promise<void>} [deps.onFirstSeen] called before a book is first opened or
 *   changed (As imported). Listing books (Home) doesn't count: it would upload a copy of every book at once.
 * @param {() => void} [deps.onChange]
 * @param {(name: string, error: unknown, final: boolean, what?: 'save' | 'export') => void} [deps.onSaveError] a save
 *   (or export) of `name` failed; `final` when it won't be tried again until the book changes.
 * @param {(name: string, data: object) => { entries: number, total?: number, tokens?: number }} [deps.summarize]
 *   the small per-book summary Home shows without the book loaded (M2). It runs once per load, and lazily after a
 *   change, not per keystroke; the default counts entries.
 * @param {() => Iterable<string>} [deps.pinned] names the app must keep loaded: the open books, and books whose undo
 *   states still need their working copy (M2).
 * @param {number} [deps.maxCopies] the clean-copy cache bound, for tests; defaults to MAX_COPIES.
 */
/** A value's JSON text, counted as serialized characters: the whole-book work a save or comparison pays. */
const json = value => {
    const text = JSON.stringify(value);
    perf.count('serializedChars', text?.length ?? 0);
    return text;
};

const same = (a, b) => {
    const sa = json(a);
    const sb = json(b);
    return sa === sb;
};

/**
 * Merges an outside save into WI Hero's working copy, in place. `base` is the book as it was when WI Hero last
 * loaded or saved it. Per entry (and per top-level field): unchanged here → the outside version; changed here and
 * not outside → kept; changed on both sides → kept, and counted. Returns the count.
 */
export function mergeOutside(mine, base, outside) {
    let conflicts = 0;
    const mineE = (mine.entries ??= {});
    const baseE = base.entries ?? {};
    const outE = outside.entries ?? {};
    for (const uid of new Set([...Object.keys(mineE), ...Object.keys(baseE), ...Object.keys(outE)])) {
        const changedHere = !same(mineE[uid], baseE[uid]);
        const changedThere = !same(outE[uid], baseE[uid]);
        if (!changedThere) continue;
        if (changedHere) { if (!same(mineE[uid], outE[uid])) conflicts++; continue; }
        if (uid in outE) mineE[uid] = outE[uid]; else delete mineE[uid];
    }
    for (const key of new Set([...Object.keys(mine), ...Object.keys(base), ...Object.keys(outside)])) {
        if (key === 'entries' || same(outside[key], base[key]) || !same(mine[key], base[key])) continue;
        if (key in outside) mine[key] = outside[key]; else delete mine[key];
    }
    return conflicts;
}

export function createLibrary({
    ctx, WI, powerUser, settings, saveSettings, writeBook = (name, data) => persistBook(ctx(), WI, name, data), onFirstSeen = async () => {}, onChange = () => {},
    onSaveError = (name, e) => console.error('[WI Hero] Could not save', name, e),
    onMerged = () => {},
    summarize = defaultSummary, pinned = () => [], maxCopies = MAX_COPIES,
}) {
    /** name → the working copy WI Hero edits; ST's cache is updated on every save. */
    const copies = new Map();
    /**
     * name → the JSON text of the book as ST last had it from WI Hero's side (loaded, or saved): what an outside save
     * is merged against. A string is all a comparison needs; it is parsed only when a merge needs the object.
     */
    const bases = new Map();
    /** name → the JSON text of ST's cache as last seen (`base` when it was not looked at since the load). */
    const cacheSeen = new Map();
    const timers = new Map();
    /** name → the delay of a typing timer, so the next change can stretch it toward SAVE_DELAY_MAX. */
    const delays = new Map();
    const inFlight = new Map();
    const reserved = new Set();
    // A timer requests a write; only a confirmed revision makes a book clean.
    const revisions = new Map();
    /**
     * name → the book's revision: bumped whenever its content can change, so what is worked out from that book can
     * be kept until its next change. A name that was never seen (or was removed) answers 0. The numbers come from
     * one counter, so a book removed and made again never answers with its old revision.
     */
    const bookVersions = new Map();
    let bookRevision = 0;
    const bookVersion = name => bookVersions.get(name) ?? 0;
    const bumpBook = name => bookVersions.set(name, ++bookRevision);
    const external = new Map();
    const operations = new Map();
    const revision = name => revisions.get(name) ?? { dirty: 0, saved: 0 };
    const isDirty = name => revision(name).dirty !== revision(name).saved;
    function dirty(name) {
        const r = revision(name);
        revisions.set(name, { ...r, dirty: r.dirty + 1 });
        bumpBook(name);
        version++;
    }
    function editable(name) {
        if (operations.has(name)) throw new Error(`${operations.get(name)}. Please wait.`);
    }
    async function operation(name, label, fn) {
        editable(name);
        operations.set(name, label);
        onChange();
        try { return await fn(); } finally { operations.delete(name); onChange(); }
    }
    const operationText = () => [...operations.values()].join(' · ');
    /** Books whose last save failed for good: their edits live only in the working copy until a save works. */
    const unsavedSet = new Set();
    /** name → failed saves in a row. */
    const failures = new Map();
    /** Objects currently being published by our confirmed write path, to distinguish their host events. */
    const ours = new WeakSet();
    const loading = new Map();
    /** Books whose As imported copy was asked for this session (onFirstSeen itself remembers it across sessions). */
    const seeded = new Set();
    /**
     * name → the small summary Home draws without the book loaded (M2): `{ entries, total, tokens, revision }`.
     * A summary is kept while its book is clean; `revision` is the book revision it was taken at, so a change (which
     * bumps the revision) makes it stale without paying an O(entries) walk per keystroke. `summary(name)` recomputes
     * lazily from a working copy, or answers null so Home falls back to the loader.
     */
    const summaries = new Map();
    /** name → when it was last read or written, oldest first: the eviction order. */
    const lru = new Map();
    /** Search and other derived caches can release entry references at the same moment a working copy leaves. */
    const copyDropListeners = new Set();
    const dropCopy = name => {
        if (!copies.delete(name)) return false;
        for (const fn of [...copyDropListeners]) fn(name);
        return true;
    };
    const limit = Math.max(1, Math.floor(maxCopies) || MAX_COPIES);
    let evictions = 0;

    const names = () => ctx().getWorldInfoNames();
    /** A book was made under this name: a rename that left it behind no longer applies (forgetReusedNames). */
    const reused = name => { if (forgetReusedNames(settings, [name])) { perf.count('settingsSaves'); saveSettings(); } };
    /**
     * Goes up on every change to any working copy, so Home and the book list are drawn again. Caches kept for one
     * book key on bookVersion, not this: a change to another book must not invalidate them.
     */
    let version = 0;

    const touch = name => {
        if (!copies.has(name)) return;
        lru.delete(name);
        lru.set(name);
    };

    function computeSummary(name, data) {
        const total = countOf(data);
        let out = null;
        try { out = summarize(name, data); } catch (e) { out = null; }
        const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
        return { entries: num(out?.entries, total), total: num(out?.total, total), tokens: num(out?.tokens, 0), revision: bookVersion(name) };
    }
    /** Takes a book's summary now, from its working copy. */
    function summarizeNow(name) {
        const data = copies.get(name);
        if (!data) return null;
        const out = computeSummary(name, data);
        summaries.set(name, out);
        return out;
    }
    /**
     * Home's count without the loader: a fresh summary, or null when there is neither a summary nor a working copy
     * to take one from. A stale summary with a copy (the book was edited) is recomputed here, once, so a Home draw
     * never walks every book: only the ones whose revision moved since their last summary.
     *
     * A save needs no separate invalidation: `change` already bumped the book revision, and `saveNow` writes the same
     * entries (an outside merge calls `dirty` too). Anything that changes a book's visible entries must either bump
     * the revision (library changes, outside saves) or call `invalidateSummary` (the app's hidden-entry set).
     */
    function summary(name) {
        const kept = summaries.get(name);
        if (kept && kept.revision === bookVersion(name)) return kept;
        return summarizeNow(name);
    }
    /** The book's visible entries changed outside its revision (the app's undo-toast hidden set): drop the summary. */
    function invalidateSummary(name) { summaries.delete(name); }

    /** Why a copy must stay: dirty, a save due, a save or book operation running, a name reserved, or failed. */
    const held = name => isDirty(name) || timers.has(name) || inFlight.has(name) || operations.has(name)
        || reserved.has(name) || unsavedSet.has(name) || loading.has(name);
    /** Every name that must stay loaded for now, the app's pins included (open books, books with undo states). */
    function pinnedNames() {
        const out = new Set();
        let extra = null;
        try { extra = pinned(); } catch (e) { extra = null; }
        for (const name of extra ?? []) out.add(name);
        for (const name of copies.keys()) if (held(name)) out.add(name);
        for (const name of timers.keys()) out.add(name);
        for (const name of inFlight.keys()) out.add(name);
        for (const name of operations.keys()) out.add(name);
        for (const name of reserved) out.add(name);
        for (const name of unsavedSet) out.add(name);
        for (const name of loading.keys()) out.add(name);
        return out;
    }

    /**
     * Drops the oldest clean, unpinned working copies until the cache is within its bound (M2). Called after a read
     * or a save finishes, never inside `change`: a pending save, a running operation or a label that is about to be
     * written must not lose its copy. `settings.books[name]`, the book revision and the As imported record stay.
     */
    function evict() {
        if (copies.size <= limit) return 0;
        const keep = pinnedNames();
        let dropped = 0;
        for (const name of [...lru.keys()]) {
            if (copies.size <= limit) break;
            if (keep.has(name) || !copies.has(name)) continue;
            // Home must still be able to draw the count without reading the book again.
            if (!summaries.has(name) || summaries.get(name).revision !== bookVersion(name)) summarizeNow(name);
            dropCopy(name);
            bases.delete(name);
            cacheSeen.delete(name);
            lru.delete(name);
            evictions++;
            dropped++;
        }
        return dropped;
    }

    async function get(name) {
        if (copies.has(name)) { touch(name); return copies.get(name); }
        if (!loading.has(name)) {
            loading.set(name, (async () => {
                const data = await ctx().loadWorldInfo(name);
                if (!data) return null;
                data.entries ??= {};
                if (!copies.has(name)) {
                    copies.set(name, data);
                    bases.set(name, json(data));
                    touch(name);
                    summarizeNow(name);
                }
                return copies.get(name) ?? data;
            })().finally(() => { loading.delete(name); evict(); }));
        }
        return loading.get(name);
    }
    const peek = name => {
        const data = copies.get(name) ?? null;
        if (data) touch(name);
        return data;
    };

    /**
     * The book is being opened or changed: keep its As imported copy first, once. The copy is taken synchronously
     * (serialized before the first await), so a change made right after doesn't reach it.
     */
    function seen(name, data = copies.get(name)) {
        if (!data || seeded.has(name)) return;
        seeded.add(name);
        // A copy that couldn't be kept (offline, a server error) is tried again when the book is next opened or
        // changed, a minute on, so a draw or a keystroke doesn't upload it over and over.
        const retry = () => setTimeout(() => seeded.delete(name), SEED_RETRY);
        onFirstSeen(name, data).then(ok => { if (ok === false) retry(); }, e => {
            console.warn('[WI Hero] Could not keep the "As imported" copy of', name, e);
            retry();
        });
    }

    /** Changes the working copy and saves it a moment later. `quiet`: the screen already shows it (typing). */
    function change(name, fn, { quiet = false } = {}) {
        editable(name);
        const data = copies.get(name);
        if (!data) return undefined;
        seen(name, data);
        let out;
        try { out = fn(data); } finally { dirty(name); touch(name); }
        scheduleTyping(name);
        if (!quiet) onChange();
        return out;
    }

    function schedule(name, delay = SAVE_DELAY) {
        clearTimeout(timers.get(name));
        delays.delete(name);
        timers.set(name, setTimeout(() => { delays.delete(name); save(name); }, delay));
    }

    /**
     * Typing stretches a pending save toward SAVE_DELAY_MAX. A retry timer has no `delays` entry, so a change during
     * a retry starts again at SAVE_DELAY rather than growing from RETRY_DELAY.
     */
    function scheduleTyping(name) {
        const stretching = timers.has(name) && delays.has(name);
        const delay = stretching ? Math.min(SAVE_DELAY_MAX, Math.round(delays.get(name) * 1.5)) : SAVE_DELAY;
        schedule(name, delay);
        delays.set(name, delay);
    }

    function save(name) {
        if (inFlight.has(name)) return inFlight.get(name);
        const task = (async () => {
            while (isDirty(name) && copies.has(name)) {
                const saveAt = perf.begin('save');
                let ok;
                try { ok = await saveNow(name); } finally { perf.end(saveAt); }
                if (ok === false) return false;
            }
            return true;
        })().finally(() => { inFlight.delete(name); evict(); });
        inFlight.set(name, task);
        return task;
    }

    async function saveNow(name) {
        perf.count('saveAttempts');
        clearTimeout(timers.get(name));
        timers.delete(name);
        delays.delete(name);
        const data = copies.get(name);
        if (!data) return;
        // Native debounced saves update ST's cache before they emit their event. Merge that pending edit too.
        const cached = WI.worldInfoCache?.get(name);
        const base = bases.get(name);
        const cachedJson = cached ? json(cached) : null;
        if (cachedJson && base && cachedJson !== (cacheSeen.get(name) ?? base)) {
            const conflicts = mergeOutside(data, JSON.parse(base), JSON.parse(cachedJson));
            bases.set(name, cachedJson);
            cacheSeen.set(name, cachedJson);
            external.set(name, (external.get(name) ?? 0) + 1);
            dirty(name);
            onMerged(name, conflicts);
        }
        const { ui } = upgradeBook(data);
        // When it was last edited here, for Home's tiles and list (ST keeps no date of its own). One settings save per
        // save transaction carries both the adopted UI fields and this date.
        (settings.books[name] ??= { defaults: {}, folders: {} }).edited = Date.now();
        if (Object.keys(ui).length) adoptUiFields(settings, name, data, ui);
        perf.count('settingsSaves');
        saveSettings();
        const sentRevision = revision(name).dirty;
        // The write payload may be kept and changed by ST after the save. The base an outside save is merged against
        // is this JSON text, taken before the write, so that later change cannot reach it.
        const copy = structuredClone(data);
        const sentJson = json(copy);
        ours.add(copy);
        try {
            await writeBook(name, copy);
        } catch (e) {
            // Never rejects: callers (the debounce, flush on close) don't wait for it. The working copy keeps the edit.
            const n = (failures.get(name) ?? 0) + 1;
            const final = n >= RETRIES;
            failures.set(name, final ? 0 : n);
            if (!final && !timers.has(name)) schedule(name, RETRY_DELAY);
            if (final && !unsavedSet.has(name)) { unsavedSet.add(name); onChange(); }
            onSaveError(name, e, final);
            return false;
        } finally { ours.delete(copy); }
        // A native edit can update the cache while the HTTP request is pending, before its debounced event.
        const after = WI.worldInfoCache?.get(name);
        const afterJson = after ? json(after) : null;
        if (afterJson && afterJson !== sentJson && afterJson !== (cacheSeen.get(name) ?? base)) onWorldInfoUpdated(name, after);
        if (afterJson) cacheSeen.set(name, afterJson);
        failures.delete(name);
        bases.set(name, sentJson);
        revisions.set(name, { ...revision(name), saved: sentRevision });
        if (unsavedSet.delete(name)) onChange();
        await quietly(() => ctx().reloadWorldInfoEditor?.(name));
        return true;
    }

    /** Saves every pending book now. Rejects when one fails (already reported), so a book action waiting on it stops. */
    async function flush(only = null) {
        const pendingNames = () => [...new Set([...timers.keys(), ...revisions.keys(), ...inFlight.keys()])]
            .filter(name => (!only || name === only) && (isDirty(name) || inFlight.has(name)));
        let pending = pendingNames();
        while (pending.length) {
            const done = await Promise.all(pending.map(save));
            if (done.includes(false)) throw Object.assign(new Error('a book could not be saved'), { reported: true });
            pending = pendingNames();
        }
    }

    /**
     * Another save of the book (ST's own editor, a slash command, another extension). With no edit of WI Hero's
     * waiting, the working copy is dropped so the next read is fresh. With one waiting (a save due, or a retry), the
     * outside save is merged in (review 2026-11-09, finding 3): every entry WI Hero hasn't changed since its last
     * save takes the outside version; an entry both changed keeps WI Hero's, and `onMerged` says how many did.
     */
    function onWorldInfoUpdated(name, data) {
        if (ours.has(data)) return;
        const dataJson = data && typeof data === 'object' ? json(data) : null;
        if (dataJson) cacheSeen.set(name, dataJson);
        const mine = copies.get(name);
        const base = bases.get(name);
        if (mine && base && base === dataJson) {
            // Native requests serialize before awaiting fetch, but emit their mutable cached object afterwards.
            // Even equal event content can describe an older in-flight write: confirm our latest copy again.
            dirty(name);
            schedule(name);
            return;
        }
        external.set(name, (external.get(name) ?? 0) + 1);
        bumpBook(name);
        version++;
        if (!isDirty(name) && !inFlight.has(name)) {
            // No working copy is kept; the outside content is right here, so take its summary without a read. Home
            // stays able to draw the new count, and the next open reads the book fresh.
            if (data && typeof data === 'object') summaries.set(name, computeSummary(name, data));
            else summaries.delete(name);
            dropCopy(name);
            bases.delete(name);
            lru.delete(name);
            onChange();
            return;
        }
        if (!mine || !base || !dataJson) return;
        const conflicts = mergeOutside(mine, JSON.parse(base), JSON.parse(dataJson));
        bases.set(name, dataJson);
        dirty(name);
        // Entries may have moved: the next Home ask takes a fresh summary from the merged copy (M2).
        summaries.delete(name);
        schedule(name);
        onChange();
        onMerged(name, conflicts);
    }

    async function sanitize(name) {
        const r = await fetch('/api/files/sanitize-filename', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ fileName: name }) });
        if (!r.ok) throw new Error(`Could not check book name (HTTP ${r.status})`);
        return String((await r.json()).fileName ?? '').trim();
    }

    /** Why a new book name can't be used, or null. */
    function nameProblem(name, current = null, checkReservations = true) {
        const n = String(name ?? '').trim();
        if (!n) return 'Type a name';
        if (n === current) return null;
        if ([...names(), ...(checkReservations ? reserved : [])].some(x => x.toLowerCase() === n.toLowerCase() && x !== current)) return 'A book with that name exists';
        return null;
    }

    const create = (...a) => quietly(() => createNow(...a));
    // While WI Hero makes, copies, renames or deletes a book, ST refreshes its own editor's book list, and that
    // fires the dropdown's change as if the user picked a book there: `busy()` tells the listener to let it pass.
    let busyN = 0;
    let busyTill = 0;
    async function quietly(fn) {
        busyN++;
        try { return await fn(); } finally { busyN--; busyTill = Date.now() + 500; }
    }
    const busy = () => busyN > 0 || Date.now() < busyTill;

    async function destination(name, current = null) {
        const clean = await sanitize(String(name ?? '').trim());
        const problem = nameProblem(clean, current);
        if (problem) throw new Error(problem);
        reserved.add(clean);
        return clean;
    }

    function checkDestination(name, current = null) {
        editable(name);
        if (isDirty(name) || inFlight.has(name)) throw new Error(`Finish saving ${name} before reusing its name.`);
        const problem = nameProblem(name, current, false);
        if (problem) throw new Error(problem);
    }

    // A destination can still have a stale working copy after an outside delete. Its new content is a new
    // history generation, even though our own host event is deliberately ignored.
    function newCopy(name) {
        dropCopy(name);
        bases.delete(name);
        cacheSeen.delete(name);
        summaries.delete(name);
        lru.delete(name);
        revisions.delete(name);
        failures.delete(name);
        unsavedSet.delete(name);
        external.set(name, (external.get(name) ?? 0) + 1);
        bumpBook(name);
        version++;
    }

    async function writeOwn(name, data) {
        ours.add(data);
        try { return await writeBook(name, data); } finally { ours.delete(data); }
    }

    async function createNow(name) {
        const clean = await destination(name);
        try {
            const data = { entries: {} };
            seeded.add(clean);
            await onFirstSeen(clean, data, { fresh: true });
            checkDestination(clean);
            await writeOwn(clean, data);
            newCopy(clean);
            summaries.set(clean, computeSummary(clean, data));
            await ctx().updateWorldInfoList();
            reused(clean);
            return clean;
        } finally { reserved.delete(clean); }
    }

    /** Writes a whole new content over a book (Restore), keeping the old one for Undo. */
    async function replace(name, data) {
        editable(name);
        const old = copies.get(name) ?? await ctx().loadWorldInfo(name);
        editable(name);
        seen(name, old);
        copies.set(name, structuredClone(data));
        touch(name);
        summaries.delete(name);
        if (!bases.has(name)) bases.set(name, json(old));
        dirty(name);
        schedule(name);
        if (await save(name) === false) throw Object.assign(new Error('a book could not be saved'), { reported: true });
        onChange();
        return old;
    }

    const duplicate = (...a) => quietly(() => duplicateNow(...a));
    async function duplicateNow(name) {
        await flush();
        const data = structuredClone(await get(name));
        let n = `${name} copy`;
        for (let i = 2; nameProblem(n); i++) n = `${name} copy ${i}`;
        const clean = await destination(n);
        try {
            checkDestination(clean);
            await writeOwn(clean, data);
            newCopy(clean);
            summaries.set(clean, computeSummary(clean, data));
            await ctx().updateWorldInfoList();
            reused(clean);
            return clean;
        } finally { reserved.delete(clean); }
    }

    const remove = name => quietly(() => operation(name, `Deleting ${name}`, () => removeNow(name)));
    async function removeNow(name) {
        await flush();
        clearTimeout(timers.get(name));
        timers.delete(name);
        const result = await WI.deleteWorldInfo(name);
        if (result === false) throw new Error(`Could not delete ${name}. The book and its backups were kept.`);
        dropCopy(name);
        bases.delete(name);
        cacheSeen.delete(name);
        summaries.delete(name);
        lru.delete(name);
        unsavedSet.delete(name);
        revisions.delete(name);
        bookVersions.delete(name);
        failures.delete(name);
        return result;
    }

    /**
     * Renames a book: saved under the new name, links moved (global, characters, the open chat, personas), old
     * file deleted. ST's own renameWorldInfo isn't exported and asks with popups, so this does the same quietly.
     */
    /**
     * Imports a lorebook file through ST's own import (its endpoint, and its converters for NovelAI, Agnai and Risu
     * books and NovelAI's PNG lorebooks; ST asks before overwriting a book of the same name). Returns the book's
     * name, or null when nothing was imported.
     */
    const importFile = file => quietly(async () => {
        await flush();
        if (typeof WI.importWorldInfo !== 'function') throw new Error('This SillyTavern has no lorebook import');
        const before = new Set(names());
        await WI.importWorldInfo(file);
        const fresh = names().find(n => !before.has(n));
        if (fresh) { reused(fresh); return fresh; }
        // Overwritten under the same name (ST asked first), or not imported at all.
        const base = await sanitize(file.name.replace(/\.[^.]+$/, ''));
        if (!names().includes(base)) return null;
        dropCopy(base); // read it again from ST: its content may be new
        summaries.delete(base);
        lru.delete(base);
        reused(base);
        return base;
    });
    const rename = (from, to) => quietly(() => operation(from, `Renaming ${from}`, () => renameNow(from, to)));
    async function renameNow(from, to) {
        const target = await destination(to, from);
        try {
            if (target === from) return from;
            await flush();
            const fromRevision = bookVersion(from);
            const data = structuredClone(await get(from));
            const wasGlobal = isGlobal(from);
            checkDestination(target, from);
            await writeOwn(target, data);
            newCopy(target);
            // The renamed book is the same book: what was worked out for the old name carries over to the new one.
            bookVersions.set(target, fromRevision);
            const carried = summaries.get(from);
            summaries.delete(from);
            if (carried) summaries.set(target, { ...carried, revision: fromRevision });
            lru.delete(from);
            // Primary links first, so ST's delete doesn't unlink the open character.
            const $ = globalThis.jQuery;
            if ($ && $('#character_world').val() === from) $('#character_world').val(target);
            for (const c of ctx().characters ?? []) {
                if (c?.data?.extensions?.world !== from) continue;
                await mergeCharacter(c, { extensions: { world: target } });
            }
            invalidateLinks();
            const deleted = await WI.deleteWorldInfo(from);
            if (deleted === false) throw new Error(`Saved a copy as ${target}, but could not delete ${from}. Both books were kept; the rename is incomplete.`);
            dropCopy(from);
            bases.delete(from);
            cacheSeen.delete(from);
            revisions.delete(from);
            bookVersions.delete(from);
            failures.delete(from);
            unsavedSet.delete(from);
            for (const lore of WI.world_info.charLore ?? []) {
                if (lore.extraBooks?.includes(from)) lore.extraBooks = lore.extraBooks.map(b => (b === from ? target : b));
            }
            invalidateLinks();
            if (powerUser) {
                if (powerUser.persona_description_lorebook === from) powerUser.persona_description_lorebook = target;
                for (const d of Object.values(powerUser.persona_descriptions ?? {})) if (d?.lorebook === from) d.lorebook = target;
            }
            const meta = ctx().chatMetadata;
            if (meta?.[WI.METADATA_KEY] === from) { meta[WI.METADATA_KEY] = target; invalidateLinks(); await ctx().saveMetadata(); }
            await ctx().updateWorldInfoList();
            if (wasGlobal) setGlobal(target, true);
            ctx().saveSettingsDebounced();
            return target;
        } finally { reserved.delete(target); }
    }

    async function mergeCharacter(c, data) {
        const r = await fetch('/api/characters/merge-attributes', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ avatar: c.avatar, data }) });
        if (!r.ok) throw new Error(`Couldn't update ${c.name}`);
        await ctx().getOneCharacter?.(c.avatar);
    }

    /** Downloads the same file as ST's own export (D10). */
    async function exportBook(name) {
        let data;
        try {
            await flush();
            data = await ctx().loadWorldInfo(name);
            if (!data) throw new Error('it came back empty');
        } catch (e) {
            // Every caller starts it without waiting, so it reports here.
            if (!e?.reported) onSaveError(name, e, true, 'export');
            return false;
        }
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${name}.json`;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }

    // ---- global and links

    const isGlobal = name => (WI.selected_world_info ?? []).includes(name);

    // Through ST's own global list, the way its dropdown does it: the slash-command path splits names on commas and
    // matches them ignoring case, so a book called "Kingdom, North" could never be turned on.
    function setGlobal(name, on) {
        if (isGlobal(name) === on) return;
        const i = (WI.world_names ?? []).indexOf(name);
        const $ = globalThis.jQuery;
        const option = i < 0 || !$ ? null : $('#world_info').children().filter((_, o) => o.value === String(i));
        if (option?.length) {
            option.prop('selected', on);
            $('#world_info').trigger('change');
        } else WI.onWorldInfoChange({ state: on ? 'on' : 'off', silent: 'true' }, name);
    }

    const fileOf = avatar => String(avatar ?? '').replace(/\.[^/.]+$/, '');

    // One links index per Home pass: book → links. Array identity catches characters, charLore and chatMetadata being
    // swapped; their lengths catch ST refilling the same arrays in place (getCharacters on an import); in-place edits
    // (unlink/linkChat, a rename, CHARACTER_EDITED/CHARACTER_PAGE_LOADED/CHAT_CHANGED) clear it explicitly.
    let linksIndex = null;
    let linksRefs = null;
    const noLinks = [];

    const invalidateLinks = () => { linksIndex = null; linksRefs = null; };

    function buildLinks(chars, lore, meta) {
        const index = new Map();
        const entry = name => { let out = index.get(name); if (!out) index.set(name, out = []); return out; };
        for (const c of chars) {
            const book = c?.data?.extensions?.world;
            if (book != null) entry(book).push({ kind: 'char', name: c.name, avatar: c.avatar });
        }
        for (const l of lore) {
            for (const book of new Set(l.extraBooks ?? [])) {
                if (index.get(book)?.some(o => o.avatar && fileOf(o.avatar) === l.name)) continue;
                const c = chars.find(x => fileOf(x.avatar) === l.name);
                entry(book).push({ kind: 'aux', name: c?.name ?? l.name, file: l.name });
            }
        }
        const chatBook = meta?.[WI.METADATA_KEY];
        if (chatBook != null) entry(chatBook).push({ kind: 'chat', name: 'This chat' });
        return index;
    }

    /**
     * Characters and chats that turn a book on. Only the open chat is known (ST keeps a chat's book in that chat).
     * @returns {{ kind: 'char' | 'aux' | 'chat', name: string, avatar?: string, file?: string }[]}
     */
    function links(name) {
        const chars = ctx().characters ?? [];
        const lore = WI.world_info?.charLore ?? [];
        const meta = ctx().chatMetadata;
        if (!linksIndex || linksRefs.chars !== chars || linksRefs.lore !== lore || linksRefs.meta !== meta
            || linksRefs.charsLength !== chars.length || linksRefs.loreLength !== lore.length) {
            linksIndex = buildLinks(chars, lore, meta);
            linksRefs = { chars, lore, meta, charsLength: chars.length, loreLength: lore.length };
        }
        return linksIndex.get(name) ?? noLinks;
    }

    async function unlink(name, link) {
        if (link.kind === 'chat') {
            delete ctx().chatMetadata[WI.METADATA_KEY];
            globalThis.jQuery?.('.chat_lorebook_button').removeClass('world_set');
            await ctx().saveMetadata();
        } else if (link.kind === 'aux') {
            const lore = (WI.world_info.charLore ?? []).find(l => l.name === link.file);
            WI.charSetAuxWorlds(link.file, (lore?.extraBooks ?? []).filter(b => b !== name));
        } else if (link.kind === 'char') {
            const c = (ctx().characters ?? []).find(x => x.avatar === link.avatar);
            if (!c) return;
            const $ = globalThis.jQuery;
            const current = ctx().characters[ctx().characterId]?.avatar === c.avatar;
            await mergeCharacter(c, { extensions: { world: '' } });
            if (current && $) { $('#character_world').val(''); WI.setWorldInfoButtonClass?.(undefined, false); }
        }
        invalidateLinks();
        onChange();
    }

    const chatOpen = () => !!ctx().chatId || !!ctx().getCurrentChatId?.();
    const chatBook = () => ctx().chatMetadata?.[WI.METADATA_KEY] ?? null;

    async function linkChat(name) {
        ctx().chatMetadata[WI.METADATA_KEY] = name;
        invalidateLinks();
        globalThis.jQuery?.('.chat_lorebook_button').addClass('world_set');
        await ctx().saveMetadata();
        onChange();
    }

    // ---- ST's World Info settings (they apply to every book), through ST's own controls so they save as usual

    /** ST's own World Info settings (they apply to every book), read live. */
    function wiSettings() {
        return {
            depth: WI.world_info_depth, recursive: WI.world_info_recursive, maxRecursion: WI.world_info_max_recursion_steps,
            minActivations: WI.world_info_min_activations, minActivationsDepth: WI.world_info_min_activations_depth_max,
            caseSensitive: WI.world_info_case_sensitive, wholeWords: WI.world_info_match_whole_words,
            includeNames: WI.world_info_include_names, groupScoring: WI.world_info_use_group_scoring,
            budget: WI.world_info_budget, budgetCap: WI.world_info_budget_cap, overflowAlert: WI.world_info_overflow_alert,
            bookOrder: WI.world_info_character_strategy, maxContext: Number(ctx().maxContext) || null,
        };
    }
    /** Each setting's control in ST's World Info panel, and the event ST listens to on it. */
    const WI_CONTROLS = {
        depth: ['#world_info_depth', 'input'], recursive: ['#world_info_recursive', 'input', true], maxRecursion: ['#world_info_max_recursion_steps', 'input'],
        minActivations: ['#world_info_min_activations', 'input'], minActivationsDepth: ['#world_info_min_activations_depth_max', 'input'],
        caseSensitive: ['#world_info_case_sensitive', 'input', true], wholeWords: ['#world_info_match_whole_words', 'input', true],
        includeNames: ['#world_info_include_names', 'input', true], groupScoring: ['#world_info_use_group_scoring', 'change', true],
        budget: ['#world_info_budget', 'input'], budgetCap: ['#world_info_budget_cap', 'input'], overflowAlert: ['#world_info_overflow_alert', 'change', true],
        bookOrder: ['#world_info_character_strategy', 'change'],
    };
    /** Changes a setting through ST's own control, so ST saves it and keeps its rules (min activations vs. max recursion). */
    function setWiSetting(key, value) {
        const $ = globalThis.jQuery;
        const c = WI_CONTROLS[key];
        if (!$ || !c) return;
        const [sel, event, check] = c;
        if (check) $(sel).prop('checked', !!value).trigger(event);
        else $(sel).val(value).trigger(event);
    }

    const edited = name => settings.books?.[name]?.edited ?? null;

    /** The cache as it stands, for tests and the memory harness (M2): what is loaded, summarised and pinned. */
    function stats() {
        const pins = [...pinnedNames()].sort();
        let bytes = 0;
        for (const name of copies.keys()) bytes += bases.get(name)?.length ?? 0;
        return {
            copies: copies.size, summaries: summaries.size, pinned: pins, evictions,
            maxCopies: limit, estimatedBytes: bytes,
        };
    }

    return {
        unsaved: name => unsavedSet.has(name),
        operationText, externalRevision: name => external.get(name) ?? 0,
        edited, names, get, peek, seen, change, bookVersion, get version() { return version; }, save, flush, onWorldInfoUpdated, nameProblem, create, replace, duplicate, remove, rename, busy, importFile,
        exportBook, isGlobal, setGlobal, links, invalidateLinks, unlink, linkChat, chatOpen, chatBook, wiSettings, setWiSetting,
        /** Home's count without loading the book (M2); null when there is no fresh summary and no copy to take one. */
        summary, invalidateSummary, stats,
        /** Releases derived data with the working copy; returns an unsubscribe function. */
        onCopyDrop(fn) { copyDropListeners.add(fn); return () => copyDropListeners.delete(fn); },
    };
}
