// Snapshots (BUILD_SPEC 11, D21): named copies of a whole book, kept as files in the user's files folder, with
// their index in WI Hero's settings. One "As imported" copy is taken the first time WI Hero opens or changes a book.
import { slugify } from '../engine/util.js';
import { bookSettings } from './data.js';

export const IMPORTED = 'As imported';

const snapshotId = () => [...crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(16).padStart(8, '0')).join('');
const identity = snap => snap.id ?? snap.path ?? snap.at; // old indexed snapshots remain readable and editable
const sameSnapshot = (a, b) => identity(a) === identity(b);

/** Unique identity is independent of the displayed timestamp and the non-unique book slug. */
export function snapshotFileName(book, at, id = snapshotId()) {
    let slug = slugify(book);
    if (!slug) slug = `book-${[...String(book)].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) >>> 0, 7).toString(36)}`;
    return `wihero-snap-${slug}-${at}-${id}.json`;
}

/** The name a new snapshot is offered: the date and time. */
export function defaultSnapshotName(date = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** Newest first, "As imported" pinned at the bottom. */
export const sortSnapshots = list => [...(list ?? [])].sort((a, b) => (!!a.imported - !!b.imported) || b.at - a.at);

export function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(out);
}

/**
 * @param {object} deps { ctx, settings, saveSettings, library, now? }
 */
export function createSnapshots({ ctx, settings, saveSettings, library, now = () => Date.now(), onSeedError = () => {} }) {
    const headers = () => ctx().getRequestHeaders();

    const pending = new Map();
    const seeding = new Map();
    const list = book => sortSnapshots(settings.books?.[book]?.snapshots);

    function write(book, name, data, extra = {}) {
        const tasks = pending.get(book) ?? new Set();
        pending.set(book, tasks);
        const task = writeNow(book, name, data, extra).finally(() => {
            tasks.delete(task);
            if (!tasks.size) pending.delete(book);
        });
        tasks.add(task);
        return task;
    }

    async function writeNow(book, name, data, extra) {
        const at = now();
        const id = snapshotId();
        const file = snapshotFileName(book, at, id);
        // Keep the object identity: renameBookSettings can move it while an upload is pending.
        const b = bookSettings(settings, book);
        const r = await fetch('/api/files/upload', { method: 'POST', headers: headers(), body: JSON.stringify({ name: file, data: toBase64(JSON.stringify(data)) }) });
        if (!r.ok) throw new Error(`The snapshot couldn't be saved (${r.status})`);
        const { path } = await r.json();
        const snap = { id, name, at, entries: Object.keys(data.entries ?? {}).length, path, ...extra };
        (b.snapshots ??= []).push(snap);
        saveSettings();
        return snap;
    }

    /**
     * Before WI Hero first uses a book: keep it as it came in. A book made in WI Hero needs no copy. The book counts
     * as seen only once its copy is uploaded, so a failed upload is tried again the next time the book is opened
     * (review 2026-11-09, finding 6). `data` is serialized before the first await: a change right after can't reach it.
     */
    function seed(book, data, options) {
        if (seeding.has(book)) return seeding.get(book);
        const task = seedNow(book, data, options).finally(() => seeding.delete(book));
        seeding.set(book, task);
        return task;
    }

    async function seedNow(book, data, { fresh = false } = {}) {
        const b = bookSettings(settings, book);
        if (b?.seen) return true;
        if (fresh) {
            b.seen = true;
            saveSettings();
            return true;
        }
        try {
            await write(book, IMPORTED, data, { imported: true });
        } catch (e) {
            console.warn('[WI Hero] Could not keep the "As imported" copy of', book, e);
            onSeedError(book, e);
            return false;
        }
        b.seen = true;
        saveSettings();
        return true;
    }

    const take = async (book, name) => write(book, name, structuredClone(await library.get(book)));

    async function load(snap) {
        const r = await fetch(`/${String(snap.path).replace(/^\/+/, '')}`, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`The snapshot file is missing (${r.status})`);
        return await r.json();
    }

    /** Puts the snapshot over the book. Returns the replaced book, for Undo. The chat's state is left alone (D20). */
    async function restore(book, snap) {
        const data = await load(snap);
        return await library.replace(book, data);
    }

    function rename(book, snap, name) {
        const s = settings.books?.[book]?.snapshots?.find(x => sameSnapshot(x, snap));
        if (s && !s.imported) { s.name = name; saveSettings(); }
    }

    /** Takes a snapshot off the list (its file stays until removeFile, so Delete can be undone). */
    function forget(book, snap) {
        const b = settings.books?.[book];
        if (b?.snapshots) b.snapshots = b.snapshots.filter(x => !sameSnapshot(x, snap));
        saveSettings();
    }
    function keep(book, snap) {
        const b = bookSettings(settings, book);
        if (!(b.snapshots ??= []).some(x => sameSnapshot(x, snap))) b.snapshots.push(snap);
        saveSettings();
    }
    const removeFile = snap => fetch('/api/files/delete', { method: 'POST', headers: headers(), body: JSON.stringify({ path: snap.path }) }).catch(() => {});

    /** A deleted book takes its snapshots with it. */
    async function removeAll(book) {
        await Promise.allSettled([...(pending.get(book) ?? [])]);
        for (const snap of settings.books?.[book]?.snapshots ?? []) await removeFile(snap);
    }

    return { list, seed, take, restore, rename, forget, keep, removeFile, removeAll, load };
}
