// Snapshots (BUILD_SPEC 11, D21): named copies of a whole book, kept as files in the user's files folder, with
// their index in WI Hero's settings. One "As imported" copy is taken the first time WI Hero sees a book.
import { slugify } from '../engine/util.js';
import { bookSettings } from './data.js';

export const IMPORTED = 'As imported';

/** `wihero-snap-<book slug>-<timestamp>.json`; ST's upload only takes letters, digits, `_`, `-` and `.`. */
export function snapshotFileName(book, at) {
    let slug = slugify(book);
    if (!slug) slug = `book-${[...String(book)].reduce((h, ch) => (h * 31 + ch.codePointAt(0)) >>> 0, 7).toString(36)}`;
    return `wihero-snap-${slug}-${at}.json`;
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
export function createSnapshots({ ctx, settings, saveSettings, library, now = () => Date.now() }) {
    const headers = () => ctx().getRequestHeaders();

    const list = book => sortSnapshots(settings.books?.[book]?.snapshots);

    async function write(book, name, data, extra = {}) {
        let at = now();
        const taken = new Set((settings.books?.[book]?.snapshots ?? []).map(s => s.at));
        while (taken.has(at)) at++;
        const file = snapshotFileName(book, at);
        const r = await fetch('/api/files/upload', { method: 'POST', headers: headers(), body: JSON.stringify({ name: file, data: toBase64(JSON.stringify(data)) }) });
        if (!r.ok) throw new Error(`The snapshot couldn't be saved (${r.status})`);
        const { path } = await r.json();
        const snap = { name, at, entries: Object.keys(data.entries ?? {}).length, path, ...extra };
        const b = bookSettings(settings, book);
        (b.snapshots ??= []).push(snap);
        saveSettings();
        return snap;
    }

    /** Before WI Hero first uses a book: keep it as it came in. A book made in WI Hero needs no copy. */
    async function seed(book, data, { fresh = false } = {}) {
        const b = settings.books?.[book];
        if (b?.seen) return;
        const s = bookSettings(settings, book);
        s.seen = true;
        saveSettings();
        if (fresh) return;
        try {
            await write(book, IMPORTED, data, { imported: true });
        } catch (e) {
            console.warn('[WI Hero] Could not keep the "As imported" copy of', book, e);
        }
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
        const s = settings.books?.[book]?.snapshots?.find(x => x.at === snap.at);
        if (s && !s.imported) { s.name = name; saveSettings(); }
    }

    /** Takes a snapshot off the list (its file stays until removeFile, so Delete can be undone). */
    function forget(book, snap) {
        const b = settings.books?.[book];
        if (b?.snapshots) b.snapshots = b.snapshots.filter(x => x.at !== snap.at);
        saveSettings();
    }
    function keep(book, snap) {
        const b = bookSettings(settings, book);
        if (!(b.snapshots ??= []).some(x => x.at === snap.at)) b.snapshots.push(snap);
        saveSettings();
    }
    const removeFile = snap => fetch('/api/files/delete', { method: 'POST', headers: headers(), body: JSON.stringify({ path: snap.path }) }).catch(() => {});

    /** A deleted book takes its snapshots with it. */
    async function removeAll(book) {
        for (const snap of settings.books?.[book]?.snapshots ?? []) await removeFile(snap);
    }

    return { list, seed, take, restore, rename, forget, keep, removeFile, removeAll, load };
}
