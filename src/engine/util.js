// Small pure helpers shared by the engine. No SillyTavern imports.

/** Copy of ST's getStringHash (public/scripts/utils.js 522), so the engine stays pure. */
export function getStringHash(str, seed = 0) {
    if (typeof str !== 'string') return 0;
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** JSON with object keys sorted, so equal rows give equal text. */
export function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

export const isObject = x => !!x && typeof x === 'object' && !Array.isArray(x);

export const clone = x => x === undefined ? undefined : structuredClone(x);

/** A slug of a title, for new ids: lower case, dashes, ASCII letters and digits. */
export function slugify(text) {
    return String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

/** `base`, or `base-2`, `base-3`… whichever isn't taken. */
export function uniqueId(base, taken) {
    let id = base;
    for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
    return id;
}

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** `/pattern/flags` as a RegExp, null if it isn't one or doesn't compile. */
export function parseRegex(text) {
    const m = /^\/([\w\W]+?)\/([gimsuy]*)$/.exec(text);
    if (!m) return null;
    try { return new RegExp(m[1], m[2].replace('g', '')); } catch { return null; }
}

/**
 * Matcher for a lock phrase: whole words, ignoring case. A `/regex/flags` phrase is a regex.
 * @returns {(text: string) => boolean}
 */
export function phraseMatcher(phrase) {
    const regex = parseRegex(phrase);
    if (regex) return text => regex.test(text ?? '');
    const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRegex(phrase.trim())}(?:$|[^\\p{L}\\p{N}_])`, 'iu');
    return text => pattern.test(text ?? '');
}
