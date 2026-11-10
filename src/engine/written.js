// Trackers (docs/TRACKERS.md): text slots the model writes. A slot is an entry's main content or one of its masks;
// its text comes from the chat. This file reads the stored settings, compiles a book's syntax and reads messages.
// Pure, no SillyTavern imports.
import { isObject } from './util.js';

/** The starting syntax of a book (TRACKERS 5): a line and a block template. */
export const DEFAULT_SYNTAX = Object.freeze({ line: '[{label}: {value}]', open: '<{label}>', close: '</{label}>' });

/** Starting syntaxes to pick from in the builder. Picking one only fills in the templates. */
export const SYNTAX_EXAMPLES = Object.freeze([
    { name: 'Square brackets', syntax: { line: '[{label}: {value}]', open: '<{label}>', close: '</{label}>' } },
    { name: 'HTML comment', syntax: { line: '<!-- {label}={value} -->', open: '<!-- {label} -->', close: '<!-- /{label} -->' } },
    { name: 'State block', syntax: { line: '<state {label}="{value}"/>', open: '<state name="{label}">', close: '</state>' } },
]);

/** Teaching (TRACKERS 3): off is bring-your-own; on, WI Hero sends one instruction at `depth`. */
export const DEFAULT_TEACH = Object.freeze({ on: false, depth: 1 });

const SHAPES = ['line', 'block'];
const SLOT_FIELDS = ['label', 'shape', 'describe', 'show', 'syntax', 'teach'];

/** The state key of a slot: the entry's key for its main, `<key>|m:<mask>` for a mask. */
export const slotKey = (entryKey, mask = null) => (mask ? `${entryKey}|m:${mask}` : entryKey);

/** A label as it is matched: lower case, spaces collapsed. */
export const normLabel = text => String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Reads a stored `written` object. Returns { slot, warnings }: `slot` is null when the input isn't one.
 * @param {any} raw
 */
export function readWritten(raw) {
    const warnings = [];
    if (raw === undefined || raw === null || raw === false) return { slot: null, warnings };
    if (raw === true) raw = {};
    if (!isObject(raw)) return { slot: null, warnings: ['written must be an object'] };
    const unknown = Object.keys(raw).filter(k => !SLOT_FIELDS.includes(k));
    if (unknown.length) warnings.push(`written has unknown field${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}`);
    const slot = {
        label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : null,
        shape: SHAPES.includes(raw.shape) ? raw.shape : 'line',
        describe: typeof raw.describe === 'string' ? raw.describe.trim() : '',
        show: raw.show !== false,
        syntax: readSyntax(raw.syntax),
        teach: readTeach(raw.teach),
    };
    if (raw.shape !== undefined && !SHAPES.includes(raw.shape)) warnings.push('written shape must be "line" or "block"');
    return { slot, warnings };
}

const readSyntax = s => isObject(s)
    ? { line: str(s.line, DEFAULT_SYNTAX.line), open: str(s.open, DEFAULT_SYNTAX.open), close: str(s.close, DEFAULT_SYNTAX.close) }
    : null;
const readTeach = t => isObject(t)
    ? { on: t.on === true, depth: Number.isInteger(t.depth) && t.depth >= 0 && t.depth <= 100 ? t.depth : DEFAULT_TEACH.depth }
    : null;
const str = (x, d) => (typeof x === 'string' ? x : d);

const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A literal piece of a template: runs of spaces match any spaces (and none at the ends). */
const literal = s => s.split(/(\s+)/).map(p => (/^\s+$/.test(p) ? '\\s*' : escapeRegex(p))).join('');
/** A label as a pattern: case and extra spaces don't matter. */
const labelPattern = label => label.trim().split(/\s+/).map(escapeRegex).join('\\s+');

/**
 * Checks a book's syntax against its slots (TRACKERS 6).
 * @returns {string[]} problems; empty when it compiles.
 */
export function syntaxProblems(syntax, slots) {
    const out = [];
    const many = slots.length > 1;
    const lines = slots.filter(s => s.shape === 'line');
    const blocks = slots.filter(s => s.shape === 'block');
    if (lines.length) {
        if (!syntax.line.includes('{value}')) out.push('the line template has no {value}');
        else if (many && !syntax.line.includes('{label}')) out.push('the line template has no {label}, and the book has more than one tracker');
        else if (syntax.line.indexOf('{value}') < syntax.line.indexOf('{label}')) out.push('the line template must put {label} before {value}');
    }
    if (blocks.length) {
        if (!syntax.open.trim() || !syntax.close.trim()) out.push('the block template needs an opening and a closing mark');
        else if (many && !syntax.open.includes('{label}')) out.push('the block\'s opening mark has no {label}, and the book has more than one tracker');
    }
    return out;
}

/**
 * Compiles a book's syntax into a reader for its slots.
 * @param {{ line: string, open: string, close: string }} syntax
 * @param {{ key: string, label: string, shape: 'line' | 'block' }[]} slots
 * @returns {{ read: (text: string) => Map<string, string>, strip: (text: string) => string } | null}
 *   `read` gives each slot found in the text its last value (an empty string clears); null when it can't compile.
 */
export function compileSyntax(syntax, slots) {
    if (!slots.length || syntaxProblems(syntax, slots).length) return null;
    const byLabel = new Map(slots.map(s => [normLabel(s.label), s]));
    const patterns = [];
    const lines = slots.filter(s => s.shape === 'line');
    const blocks = slots.filter(s => s.shape === 'block');
    const alt = list => `(${list.map(s => labelPattern(s.label)).sort((a, b) => b.length - a.length).join('|')})`;
    if (lines.length) {
        const t = syntax.line;
        const v = t.indexOf('{value}');
        const before = t.slice(0, v);
        const after = t.slice(v + '{value}'.length);
        const l = before.indexOf('{label}');
        const head = l >= 0 ? `${literal(before.slice(0, l))}\\s*${alt(lines)}\\s*${literal(before.slice(l + 7))}` : `()${literal(before)}`;
        // The value runs to the closing mark, on one line; with no closing mark, to the end of the line.
        const tail = after.trim() ? `[ \\t]*([^\\n]*?)[ \\t]*${literal(after.trim())}` : '[ \\t]*([^\\n]*?)[ \\t]*(?=\\n|$)';
        patterns.push({ re: new RegExp(`${head}${tail}`, 'gi'), shape: 'line', only: l < 0 ? lines[0] : null });
    }
    if (blocks.length) {
        const open = syntax.open;
        const l = open.indexOf('{label}');
        const head = l >= 0 ? `${literal(open.slice(0, l))}\\s*${alt(blocks)}\\s*${literal(open.slice(l + 7))}` : `()${literal(open)}`;
        // The closing mark may repeat the label: it must be the same one (a backreference, case aside).
        const close = syntax.close;
        const cl = close.indexOf('{label}');
        const end = cl >= 0 ? `${literal(close.slice(0, cl))}\\s*\\1\\s*${literal(close.slice(cl + 7))}` : literal(close);
        patterns.push({ re: new RegExp(`${head}([\\s\\S]*?)${end}`, 'gi'), shape: 'block', only: l < 0 ? blocks[0] : null });
    }
    const each = (text, fn) => {
        for (const p of patterns) {
            p.re.lastIndex = 0;
            for (const m of String(text ?? '').matchAll(p.re)) {
                const slot = p.only ?? byLabel.get(normLabel(m[1]));
                if (slot && slot.shape === p.shape) fn(slot, m);
            }
        }
    };
    return {
        read(text) {
            // The last match in the message wins: matches are applied in the order they appear.
            const found = [];
            each(text, (slot, m) => found.push([m.index, slot.key, m[2].trim()]));
            found.sort((a, b) => a[0] - b[0]);
            return new Map(found.map(([, k, v]) => [k, v]));
        },
        strip(text) {
            let out = String(text ?? '');
            for (const p of patterns) { p.re.lastIndex = 0; out = out.replace(p.re, (m, label) => (p.only || byLabel.has(normLabel(label)) ? '' : m)); }
            return out.replace(/\n{3,}/g, '\n\n').trim();
        },
        /** Same as strip, but only for the slots in `keys`. */
        stripOnly(text, keys) {
            let out = String(text ?? '');
            for (const p of patterns) {
                p.re.lastIndex = 0;
                out = out.replace(p.re, (m, label) => {
                    const slot = p.only ?? byLabel.get(normLabel(label));
                    return slot && keys.has(slot.key) ? '' : m;
                });
            }
            return out.replace(/\n{3,}/g, '\n\n').trim();
        },
    };
}

/** One slot's line, as the model is asked to write it. */
export function sample(syntax, slot, value = '…') {
    const fill = t => t.replaceAll('{label}', slot.label).replaceAll('{value}', value);
    return slot.shape === 'block' ? `${fill(syntax.open)}\n${value}\n${fill(syntax.close)}` : fill(syntax.line);
}

/**
 * Warnings for a syntax (TRACKERS 5), over the slots and, when given, test replies.
 * @param {string[]} [texts] Recent replies to test against.
 */
export function syntaxWarnings(syntax, slots, texts = []) {
    const out = [];
    const labels = slots.map(s => ({ s, n: normLabel(s.label) }));
    for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
            const [a, b] = labels[i].n.length <= labels[j].n.length ? [labels[i], labels[j]] : [labels[j], labels[i]];
            if (a.n === b.n) continue; // a problem, reported by the model
            if (b.n.startsWith(a.n)) out.push(`"${a.s.label}" is the start of "${b.s.label}"`);
            else if (similar(a.n, b.n)) out.push(`"${a.s.label}" and "${b.s.label}" are very alike`);
        }
    }
    const closing = syntax.line.slice(syntax.line.indexOf('{value}') + 7).trim();
    if (slots.some(s => s.shape === 'line') && closing.length === 1 && /[\]),.;:|]/.test(closing)) {
        out.push(`the line closes with "${closing}", which a value can contain`);
    }
    const r = texts.length ? compileSyntax(syntax, slots) : null;
    if (r && slots.some(s => s.shape === 'block')) {
        const open = syntax.open.split('{label}')[0].trim();
        for (const t of texts) {
            if (open && t.includes(open)) {
                const n = (t.split(open).length - 1);
                const found = [...r.read(t).keys()].filter(k => slots.find(s => s.key === k)?.shape === 'block').length;
                if (n > found) { out.push('a test reply opens a block and never closes it'); break; }
            }
        }
    }
    if (r) {
        const lineSlots = slots.filter(s => s.shape === 'line');
        const head = syntax.line.split('{value}')[0].split('{label}')[0];
        for (const t of texts) {
            for (const s of lineSlots) {
                const start = head ? `${head}${s.label}` : null;
                if (start && t.toLowerCase().includes(start.toLowerCase()) && !r.read(t).has(s.key)) {
                    out.push(`"${s.label}" was written over more than one line in a test reply`);
                    break;
                }
            }
        }
    }
    return [...new Set(out)];
}

/** Two labels one letter or so apart. */
function similar(a, b) {
    if (Math.abs(a.length - b.length) > 1 || Math.min(a.length, b.length) < 4) return false;
    let i = 0;
    while (i < a.length && a[i] === b[i]) i++;
    let j = 0;
    while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
    return Math.max(a.length, b.length) - i - j <= 1;
}

/**
 * The value a slot holds after the snapshot `state` in `chat`: in-flight values first (`state.wrote`, read in this
 * turn), then the message the snapshot points at, then the chat's greeting. Undefined when nothing was written; an
 * empty string when it was cleared.
 * @param {object} state Story state with `written` (slot → message index) and `wrote` (values read this turn).
 * @param {object[]} chat
 * @param {string} key Slot key.
 * @param {(text: string) => Map<string, string>} [readGreeting] The book's reader, for the opening greeting.
 */
export function slotValue(state, chat, key, readGreeting) {
    if (Object.hasOwn(state.wrote ?? {}, key)) return state.wrote[key];
    const at = state.written?.[key];
    if (Number.isInteger(at)) {
        const stored = chat?.[at]?.extra?.wihero?.wrote;
        if (isObject(stored) && Object.hasOwn(stored, key)) return String(stored[key]);
        return undefined;
    }
    const first = chat?.[0];
    if (readGreeting && first && !first.is_user && !first.is_system) {
        const v = readGreeting(first.mes ?? '').get(key);
        if (v !== undefined) return v;
    }
    return undefined;
}

/**
 * The one instruction WI Hero sends in its own mode (TRACKERS 3.2), built from the book's syntax and the slots that
 * are open now. Empty when no slot is open.
 * @param {{ syntax: object }} tracker A book's tracker settings (model.trackers).
 * @param {object[]} open The book's slots that read now.
 * @param {Map<string, string>} values Current values by slot key.
 */
export function instruction(tracker, open, values) {
    if (!open.length) return '';
    const lines = open.map(s => {
        // Cleared or never written, a written main's own text is its value (the start value).
        const v = values.get(s.key) || s.start || '';
        const notes = [s.describe ? s.describe.replace(/[.\s]+$/, '') : '', s.shape === 'line' && v ? `now ${v}` : ''].filter(Boolean);
        const form = sample(tracker.syntax, s, s.shape === 'block' ? '(value, any number of lines)' : '(value)');
        return `${form}${notes.length ? `\n  (${notes.join('; ')})` : ''}`;
    });
    return [
        'Story trackers. At the very end of your reply, after everything else, write the trackers below whose value changed, each exactly in its format. To clear one, write it with an empty value. Never write them anywhere else in the reply.',
        ...lines,
    ].join('\n');
}
