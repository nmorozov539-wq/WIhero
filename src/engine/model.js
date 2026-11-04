// The model: every book's story logic reduced to open rules and close rules per entry.
// Pure, no SillyTavern imports. See docs/BUILD_SPEC.md sections 2–3 and CONCEPTS.md 3 and 5.
import { canonical, clone, getStringHash, isObject } from './util.js';

export const FIELD = 'wihero';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const PACK_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*)*$/;
const READING = /^#([^:]+)(?::(all|\d+))?$/;

/** Fields of the old build that only the UI read; they move to the extension settings on save. */
export const UI_FIELDS = Object.freeze(['folder', 'color']);

/** ST's key for an entry within the loaded books (`world.uid`). */
export const stKey = entry => `${entry.world}.${entry.uid}`;

/** The state key of an entry: `<book>/<id>`. */
export const entryKey = (book, id) => `${book}/${id}`;

/** The state key of a greeting: `@<char>:<n>`. */
export const greetingKey = ref => `@${ref.char}:${ref.greeting}`;

const label = entry => entry.comment || (Array.isArray(entry.key) && entry.key[0]) || `uid ${entry.uid}`;

/** The stored story logic of an entry, wherever it is: `extensions.wihero`, or the old top-level `wihero`. */
export function rawConfig(entry) {
    return entry?.extensions?.[FIELD] ?? entry?.[FIELD];
}

const isGreetingRef = x => isObject(x) && 'greeting' in x;

/**
 * Reads a stored config in the current shape (BUILD_SPEC 2.3). Returns a new object; the input is untouched.
 * Anything it doesn't recognize is left for buildModel to report.
 * @returns {{ config: any, ui: object, legacy: boolean }}
 */
export function normalize(raw) {
    if (!isObject(raw)) return { config: raw, ui: {}, legacy: false };
    const c = clone(raw);
    const ui = {};
    let legacy = false;
    for (const field of UI_FIELDS) {
        if (field in c) {
            ui[field] = c[field];
            delete c[field];
            legacy = true;
        }
    }
    const unique = list => [...new Map(list.map(x => [canonical(x), x])).values()];

    // gates + gateMode → gate rows; closeGates (true by default in the old build) → closesFor the gate's entries.
    if ('gates' in c) {
        legacy = true;
        const gates = c.gates;
        if (Array.isArray(gates) && c.gate === undefined && gates.length) {
            c.gate = c.gateMode === 'any' ? gates.map(g => [g]) : [gates];
        } else if (!Array.isArray(gates) && c.gate === undefined) {
            c.gate = gates; // reported as malformed
        }
        if (c.closeGates !== false && Array.isArray(gates)) {
            const plain = gates.filter(g => typeof g === 'string' && !g.startsWith('#'));
            if (plain.length) c.closesFor = unique([...(Array.isArray(c.closesFor) ? c.closesFor : []), ...plain]);
        }
        delete c.gates;
        delete c.gateMode;
        delete c.closeGates;
    }
    if ('closeGates' in c) {
        // A new-shape book with the old flag: same reading.
        legacy = true;
        if (c.closeGates === true && Array.isArray(c.gate)) {
            const plain = c.gate.flat().filter(g => typeof g === 'string' && !g.startsWith('#'));
            if (plain.length) c.closesFor = unique([...(Array.isArray(c.closesFor) ? c.closesFor : []), ...plain]);
        }
        delete c.closeGates;
    }
    if ('gateMode' in c) {
        legacy = true;
        delete c.gateMode;
    }
    if ('closes' in c) {
        legacy = true;
        if (Array.isArray(c.closes)) c.closesFor = unique([...(Array.isArray(c.closesFor) ? c.closesFor : []), ...c.closes]);
        else if (c.closesFor === undefined) c.closesFor = c.closes;
        delete c.closes;
    }
    if ('labels' in c) {
        legacy = true;
        if (Array.isArray(c.labels)) c.packs = unique([...(Array.isArray(c.packs) ? c.packs : []), ...c.labels]);
        else if (c.packs === undefined) c.packs = c.labels;
        delete c.labels;
    }
    // Old glue: true, or end conditions → a hold plus close gate rows.
    if (c.glue === false) {
        legacy = true;
        delete c.glue;
    } else if (c.glue === true || (isObject(c.glue) && !('mode' in c.glue))) {
        legacy = true;
        const old = c.glue === true ? {} : c.glue;
        const rows = [];
        if (Array.isArray(old.closeWhenFired)) rows.push(...old.closeWhenFired.map(x => [x]));
        if (Array.isArray(old.closeWhenAllFired) && old.closeWhenAllFired.length) rows.push([...old.closeWhenAllFired]);
        if (Array.isArray(old.closeKeywords) && old.closeKeywords.length) rows.push([{ lock: [...old.closeKeywords] }]);
        const known = ['closeWhenFired', 'closeWhenAllFired', 'closeKeywords'];
        const unknown = Object.keys(old).filter(k => !known.includes(k));
        c.glue = unknown.length ? { ...Object.fromEntries(unknown.map(k => [k, old[k]])), mode: 'hold' } : { mode: 'hold' };
        if (rows.length) c.closeGate = [...(Array.isArray(c.closeGate) ? c.closeGate : []), ...rows];
    }
    if (Array.isArray(c.masks)) {
        c.masks = c.masks.map(mask => {
            if (!isObject(mask) || !('gates' in mask || 'gateMode' in mask)) return mask;
            legacy = true;
            const m = { ...mask };
            if (Array.isArray(m.gates) && m.gates.length && m.gate === undefined) m.gate = m.gateMode === 'any' ? m.gates.map(g => [g]) : [m.gates];
            else if (m.gates !== undefined && !Array.isArray(m.gates) && m.gate === undefined) m.gate = m.gates;
            delete m.gates;
            delete m.gateMode;
            return m;
        });
    }
    return { config: c, ui, legacy };
}

const FIELDS = ['id', 'gate', 'gatesFor', 'closeGate', 'closesFor', 'glue', 'switch', 'masks', 'packs', 'once', 'by', 'gatedBy'];
const BY = ['user', 'char'];

/**
 * Builds the model of the loaded books.
 * @param {object[]} entries ST entries, each with `world` and `uid`.
 * @param {{ greetingFp?: (char: string, n: number) => string | null | undefined }} [options]
 *   `greetingFp` gives the fingerprint of a character's greeting n: undefined when the character is missing,
 *   null when it has no greeting n. Without it, greeting refs are taken as they are.
 * @returns {object} { nodes, byStKey, issues, packs, switches, riders, greetings }
 *   `nodes` by state key (`book/id`), `byStKey` every entry with story logic by `world.uid`.
 */
export function buildModel(entries, options = {}) {
    const issues = [];
    const nodes = new Map();
    const byStKey = new Map();
    const books = new Map(); // book → Map(id → [node])
    const greetings = new Map();

    const report = (node, message, { warning = false, blocking = !warning } = {}) => {
        if (blocking) node.blocked = true;
        issues.push({ key: node.key, stKey: node.stKey, book: node.book, id: node.id, label: node.label, message, ...(warning ? { warning: true } : {}), ...(!blocking && !warning ? { blocking: false } : {}) });
    };

    // 1. Read every entry's config.
    for (const entry of entries ?? []) {
        const raw = rawConfig(entry);
        if (raw === undefined || raw === null) continue;
        const { config } = normalize(raw);
        if (isObject(config) && Object.keys(config).length === 0) continue; // only UI fields: plain World Info
        const node = {
            key: null, stKey: stKey(entry), book: entry.world, uid: entry.uid, id: null, label: label(entry),
            config, blocked: false, packs: [], glue: null, once: false, by: null,
            opens: { rows: [], all: [] }, closes: [], masks: [],
            probability: entry.useProbability !== false ? Number(entry.probability ?? 100) : 100,
            cooldown: Number(entry.cooldown) || 0,
        };
        byStKey.set(node.stKey, node);
        if (!isObject(config)) {
            report(node, 'its story logic is not an object');
            continue;
        }
        const unknown = Object.keys(config).filter(k => !FIELDS.includes(k));
        if (unknown.length) report(node, `has unknown field${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}`, { warning: true });
        if (typeof config.id !== 'string' || !ID_PATTERN.test(config.id)) {
            report(node, config.id === undefined ? 'has no id' : `id "${config.id}" is not valid`);
            continue;
        }
        node.id = config.id;
        node.key = entryKey(node.book, node.id);
        if (!books.has(node.book)) books.set(node.book, new Map());
        const ids = books.get(node.book);
        if (!ids.has(node.id)) ids.set(node.id, []);
        ids.get(node.id).push(node);
        if (config.packs !== undefined) {
            if (!Array.isArray(config.packs) || config.packs.some(p => typeof p !== 'string' || !PACK_PATTERN.test(p))) report(node, 'packs must be a list of names');
            else node.packs = [...new Set(config.packs)];
        }
        if (config.once !== undefined && typeof config.once !== 'boolean') report(node, 'once must be true or false');
        else node.once = config.once === true;
        if (config.by !== undefined && !BY.includes(config.by)) report(node, 'by must be "user" or "char"');
        else node.by = config.by ?? null;
    }

    // 2. Duplicate ids within a book: every copy is blocked.
    for (const ids of books.values()) {
        for (const [id, list] of ids) {
            if (list.length > 1) for (const node of list) report(node, `id "${id}" is used by more than one entry`);
            if (list.length) nodes.set(list[0].key, list[0]);
        }
    }

    // Packs per book: name → member keys. A rule on `town` covers `town/inn`.
    const packs = new Map();
    for (const node of nodes.values()) {
        if (!packs.has(node.book)) packs.set(node.book, new Map());
        for (const name of node.packs) {
            const parts = name.split('/');
            for (let i = 1; i <= parts.length; i++) {
                const p = parts.slice(0, i).join('/');
                const book = packs.get(node.book);
                if (!book.has(p)) book.set(p, []);
                if (!book.get(p).includes(node.key)) book.get(p).push(node.key);
            }
        }
    }
    const members = (book, name) => packs.get(book)?.get(name) ?? [];

    const greetingInfo = ref => {
        const key = greetingKey(ref);
        if (!greetings.has(key)) {
            let ok = true;
            let problem = null;
            let missing = false;
            if (options.greetingFp) {
                const fp = options.greetingFp(ref.char, ref.greeting);
                if (fp === undefined) { ok = false; missing = true; }
                else if (fp === null || (ref.fp !== undefined && String(fp) !== String(ref.fp))) {
                    ok = false;
                    problem = `${ref.name || ref.char}'s ${ref.greeting === 0 ? 'Greeting' : `Alt ${ref.greeting}`} changed`;
                }
            }
            greetings.set(key, { key, ref: { greeting: ref.greeting, char: ref.char, name: ref.name, fp: ref.fp }, ok, missing, problem });
        }
        return greetings.get(key);
    };

    /**
     * Compiles one ref of a row. Returns { item } | { wait } | { lock } | { error }.
     */
    const compileRef = (node, ref) => {
        if (typeof ref === 'string') {
            const reading = READING.exec(ref);
            if (reading) {
                const [, name, mode] = reading;
                const keys = members(node.book, name);
                if (!keys.length) return { error: `links to pack "#${name}", which no entry carries` };
                return { item: { type: 'pack', name, keys, mode: mode === 'all' ? 'all' : mode ? Number(mode) : 'any' } };
            }
            if (!ID_PATTERN.test(ref)) return { error: `"${ref}" is not a valid link` };
            if (!nodes.has(entryKey(node.book, ref))) return { error: `links to "${ref}", which no entry has` };
            return { item: { type: 'entry', key: entryKey(node.book, ref) } };
        }
        if (isObject(ref) && 'lock' in ref) {
            const phrases = Array.isArray(ref.lock) ? ref.lock.filter(p => typeof p === 'string' && p.trim()) : [];
            if (!phrases.length || phrases.length !== ref.lock.length) return { error: 'a lock needs a list of phrases' };
            if (ref.by !== undefined && !BY.includes(ref.by)) return { error: 'a lock\'s by must be "user" or "char"' };
            return { lock: { phrases, by: ref.by ?? null } };
        }
        if (isObject(ref) && 'wait' in ref) {
            if (!Number.isInteger(ref.wait) || ref.wait < 0) return { error: 'a wait needs a whole number of messages' };
            if (ref.by !== undefined && !BY.includes(ref.by)) return { error: 'a wait\'s by must be "user" or "char"' };
            return { wait: { n: ref.wait, by: ref.by ?? null } };
        }
        if (isGreetingRef(ref)) {
            if (!Number.isInteger(ref.greeting) || ref.greeting < 0 || typeof ref.char !== 'string' || !ref.char) return { error: 'a greeting link is malformed' };
            const info = greetingInfo(ref);
            return { item: { type: 'greeting', key: info.key } };
        }
        return { error: `${JSON.stringify(ref)} is not a valid link` };
    };

    /**
     * Compiles a list of rows. `prefix` is the row key prefix (`book/id|g`, `book/id|m:night|c`…).
     * @returns {object[] | null} null when malformed (reported through `fail`).
     */
    const compileRows = (node, rows, prefix, fail) => {
        if (!Array.isArray(rows) || rows.some(r => !Array.isArray(r) || !r.length)) {
            fail('rows must be lists of links');
            return null;
        }
        const out = [];
        for (const raw of rows) {
            const row = { key: `${prefix}|${getStringHash(canonical(raw))}`, items: [], waits: [], locks: [], raw };
            for (const ref of raw) {
                const r = compileRef(node, ref);
                if (r.error) { fail(r.error); return null; }
                if (r.item) row.items.push(r.item);
                if (r.wait) row.waits.push(r.wait);
                if (r.lock) row.locks.push({ ...r.lock, key: `${row.key}|${row.locks.length}` });
            }
            out.push(row);
        }
        return out;
    };

    const refKeys = item => item.type === 'pack' ? item.keys : [item.key];

    // 3. Each entry's own rules.
    for (const node of nodes.values()) {
        const c = node.config;
        const fail = message => report(node, message);
        if (c.gate !== undefined) {
            const rows = compileRows(node, c.gate, `${node.key}|g`, m => fail(`gate: ${m}`));
            if (rows) {
                if (rows.some(r => r.items.some(i => i.key === node.key))) fail('gate names this entry itself');
                node.opens.rows = rows;
            }
        }
        if (c.closeGate !== undefined) {
            const rows = compileRows(node, c.closeGate, `${node.key}|c`, m => fail(`close gate: ${m}`));
            if (rows) {
                if (rows.some(r => r.items.some(i => i.key === node.key))) fail('close gate names this entry itself');
                for (const row of rows) {
                    const only = row.items.length === 1 && !row.waits.length && !row.locks.length && row.items[0].type === 'greeting';
                    node.closes.push({ row, kind: only ? 'closesFor' : 'closeGate', source: only ? row.items[0].key : null });
                }
            }
        }
        if (c.gatedBy !== undefined) {
            if (!Array.isArray(c.gatedBy) || c.gatedBy.some(r => !isGreetingRef(r))) fail('gatedBy must be a list of greetings');
            else for (const ref of c.gatedBy) {
                const r = compileRef(node, ref);
                if (r.error) fail(`gatedBy: ${r.error}`);
                else node.opens.all.push({ ...r.item, source: r.item.key });
            }
        }
        if (c.glue !== undefined) {
            const g = c.glue;
            if (!isObject(g) || !['ride', 'hold'].includes(g.mode)) fail('glue must be {"mode": "ride", "host": id} or {"mode": "hold"}');
            else if (g.mode === 'hold') node.glue = { mode: 'hold' };
            else if (typeof g.host !== 'string' || !g.host) fail('ride-along glue needs a host');
            else if (g.host.startsWith('#')) fail('ride-along glue can\'t ride a pack');
            else if (g.host === node.id) fail('rides along with itself');
            else if (!nodes.has(entryKey(node.book, g.host))) fail(`rides along with "${g.host}", which no entry has`);
            else node.glue = { mode: 'ride', host: entryKey(node.book, g.host) };
            if (node.glue && (node.probability < 100)) report(node, 'is glued but has a trigger chance below 100%, so it can still drop out', { warning: true });
            if (node.glue && node.cooldown > 0) report(node, 'has a cooldown, so glue can\'t keep it on every turn', { warning: true });
        }
        if (c.masks !== undefined) {
            if (!Array.isArray(c.masks)) report(node, 'masks must be a list', { blocking: false });
            else node.masks = compileMasks(node, c.masks);
        }
    }

    function compileMasks(node, list) {
        const out = [];
        list.forEach((mask, i) => {
            const name = isObject(mask) && typeof mask.name === 'string' && mask.name ? mask.name : null;
            const skip = message => report(node, `mask ${name ? `"${name}"` : i + 1} ${message}; it is skipped`, { blocking: false });
            if (!isObject(mask)) return skip('is not an object');
            if (!name || !ID_PATTERN.test(name)) return skip(name ? 'has a name that is not valid' : 'has no name');
            if (out.some(m => m.name === name)) return skip('has a name used twice');
            if (typeof mask.content !== 'string' || !mask.content.trim()) return skip('has no content');
            const unknown = Object.keys(mask).filter(k => !['name', 'content', 'gate', 'closeGate'].includes(k));
            if (unknown.length) return skip(`has unknown field${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}`);
            let bad = null;
            const opens = mask.gate === undefined ? [] : compileRows(node, mask.gate, `${node.key}|m:${name}|g`, m => { bad ??= `gate: ${m}`; });
            const closes = mask.closeGate === undefined ? [] : compileRows(node, mask.closeGate, `${node.key}|m:${name}|c`, m => { bad ??= `close gate: ${m}`; });
            if (bad) return skip(`has a bad ${bad}`);
            out.push({ name, content: mask.content, key: `${node.key}/${name}`, opens, closes });
        });
        return out;
    }

    // 4. Rules written on the source: Gates for and Closes for.
    const targetsOf = (node, list, field) => {
        if (!Array.isArray(list) || list.some(x => typeof x !== 'string' || !x)) {
            report(node, `${field} must be a list of entries or #packs`);
            return [];
        }
        const out = new Set();
        for (const target of list) {
            if (target.startsWith('#')) {
                const reading = READING.exec(target);
                if (!reading || reading[2]) { report(node, `${field} "${target}" must name a pack, as #name`); continue; }
                const keys = members(node.book, reading[1]);
                if (!keys.length) { report(node, `${field} targets pack "${target}", which no entry carries`); continue; }
                if (keys.includes(node.key) && field === 'gatesFor') { report(node, `gatesFor ${target} includes this entry itself`); continue; }
                for (const k of keys) if (k !== node.key) out.add(k);
            } else if (target === node.id) {
                report(node, `${field} targets itself`);
            } else if (!nodes.has(entryKey(node.book, target))) {
                report(node, `${field} targets "${target}", which no entry has`);
            } else {
                out.add(entryKey(node.book, target));
            }
        }
        return [...out];
    };
    for (const node of nodes.values()) {
        const c = node.config;
        if (c.gatesFor !== undefined) {
            for (const target of targetsOf(node, c.gatesFor, 'gatesFor')) {
                nodes.get(target).opens.all.push({ type: 'entry', key: node.key, source: node.key });
            }
        }
        if (c.closesFor !== undefined) {
            for (const target of targetsOf(node, c.closesFor, 'closesFor')) {
                const t = nodes.get(target);
                const raw = [node.id];
                t.closes.push({ row: { key: `${t.key}|c|for:${node.id}`, items: [{ type: 'entry', key: node.key }], waits: [], locks: [], raw }, kind: 'closesFor', source: node.key });
            }
        }
    }

    // Greeting rules aimed at a pack (`via: '#pack'`), found on any member, apply to every member.
    for (const node of nodes.values()) {
        const c = node.config;
        const viaPack = ref => isGreetingRef(ref) && typeof ref.via === 'string' ? READING.exec(ref.via)?.[1] : null;
        for (const ref of Array.isArray(c.gatedBy) ? c.gatedBy : []) {
            const pack = viaPack(ref);
            if (!pack) continue;
            const r = compileRef(node, ref);
            if (r.error) continue;
            for (const k of members(node.book, pack)) {
                const t = nodes.get(k);
                if (!t.opens.all.some(i => i.key === r.item.key)) t.opens.all.push({ ...r.item, source: r.item.key });
            }
        }
        for (const raw of Array.isArray(c.closeGate) ? c.closeGate : []) {
            if (!Array.isArray(raw) || raw.length !== 1) continue;
            const pack = viaPack(raw[0]);
            if (!pack) continue;
            const r = compileRef(node, raw[0]);
            if (r.error) continue;
            for (const k of members(node.book, pack)) {
                const t = nodes.get(k);
                if (t.closes.some(cl => cl.source === r.item.key)) continue;
                t.closes.push({ row: { key: `${t.key}|c|${getStringHash(canonical(raw))}`, items: [r.item], waits: [], locks: [], raw }, kind: 'closesFor', source: r.item.key });
            }
        }
    }

    // 5. Switches: each path closes when another path fires.
    const switches = [];
    const pathOwner = new Map();
    for (const node of nodes.values()) {
        const list = node.config.switch;
        if (list === undefined) continue;
        if (!Array.isArray(list) || list.some(x => typeof x !== 'string' || !x) || new Set(list).size < 2) { report(node, 'a switch needs at least two paths'); continue; }
        const paths = [];
        let bad = false;
        for (const path of new Set(list)) {
            if (path.startsWith('#')) { report(node, `a switch path can't be a pack (${path})`); bad = true; }
            else if (path === node.id) { report(node, 'switch lists itself'); bad = true; }
            else if (!nodes.has(entryKey(node.book, path))) { report(node, `switch lists "${path}", which no entry has`); bad = true; }
            else if (pathOwner.has(entryKey(node.book, path))) { report(node, `switch path "${path}" is also in the switch of ${nodes.get(pathOwner.get(entryKey(node.book, path))).id}`); bad = true; }
            else paths.push(entryKey(node.book, path));
        }
        if (bad) continue;
        for (const p of paths) pathOwner.set(p, node.key);
        switches.push({ fork: node.key, paths });
        for (const p of paths) {
            const path = nodes.get(p);
            if (!path.opens.rows.some(r => r.items.some(i => i.key === node.key))) {
                report(path, `switch path "${path.id}" doesn't gate on ${node.id}, so it can be taken before the fork`, { warning: true });
            }
            for (const other of paths) {
                if (other === p) continue;
                path.closes.push({ row: { key: `${p}|c|switch:${nodes.get(other).id}`, items: [{ type: 'entry', key: other }], waits: [], locks: [], raw: [nodes.get(other).id] }, kind: 'switch', source: other });
            }
        }
    }

    // 6. Once: closes after the first firing, from the next message.
    for (const node of nodes.values()) {
        if (node.once) node.closes.push({ row: { key: `${node.key}|c|once`, items: [{ type: 'self', key: node.key }], waits: [], locks: [], raw: ['once'] }, kind: 'once', source: node.key });
    }

    // 7. Ride-along: riders by host.
    const riders = new Map();
    for (const node of nodes.values()) {
        if (node.glue?.mode !== 'ride') continue;
        if (!riders.has(node.glue.host)) riders.set(node.glue.host, []);
        riders.get(node.glue.host).push(node.key);
    }

    // 8. Rules that can never be met: loops through gates, packs and Gates for. Blocked entries count as able
    // to open here, so only new problems are reported.
    const canOpen = new Set([...nodes.values()].filter(n => n.blocked).map(n => n.key));
    const possible = item => {
        if (item.type === 'entry') return canOpen.has(item.key);
        if (item.type === 'pack') {
            const n = item.keys.filter(k => canOpen.has(k)).length;
            return item.mode === 'any' ? n > 0 : item.mode === 'all' ? n === item.keys.length : n >= item.mode;
        }
        return true;
    };
    for (let changed = true; changed;) {
        changed = false;
        for (const node of nodes.values()) {
            if (canOpen.has(node.key)) continue;
            const own = !node.opens.rows.length || node.opens.rows.some(r => r.items.every(possible));
            if (own && node.opens.all.every(possible)) {
                canOpen.add(node.key);
                changed = true;
            }
        }
    }
    for (const node of nodes.values()) {
        if (canOpen.has(node.key)) continue;
        const cycle = findCycle(node.key, nodes, canOpen);
        report(node, cycle
            ? `is in a loop and can never open: ${cycle.map(k => nodes.get(k).id).join(' → ')}`
            : 'can never open: its rules need more entries than can fire');
    }

    // 9. Warnings.
    for (const node of nodes.values()) {
        if (node.glue?.mode === 'hold' && !node.closes.length) report(node, 'holds with nothing that can close it, so it stays on for the rest of the chat', { warning: true });
        for (const row of node.opens.rows) {
            const keys = new Set(row.items.flatMap(refKeys));
            const first = node.closes.find(cl => cl.kind !== 'once' && !cl.row.waits.length && !cl.row.locks.length && cl.row.items.length
                && cl.row.items.every(i => i.type !== 'pack' && keys.has(i.key)));
            if (first) report(node, `its close gate is always met before gate row ${JSON.stringify(row.raw)} opens, so that row can never let it fire`, { warning: true });
        }
    }
    for (const info of greetings.values()) {
        const g = { key: info.key, stKey: null, book: null, id: null, label: info.ref.name || info.ref.char, blocked: false };
        if (info.problem) report(g, `${info.problem}: it doesn't fire until it is re-picked`, { blocking: false });
        else if (info.missing) report(g, `greeting of ${info.ref.name || info.ref.char}, a character that is missing: it never fires`, { warning: true });
    }

    return { nodes, byStKey, issues, packs, switches, riders, greetings };
}

/** A loop of gate/Gates for edges through `start`, among entries that can't open. */
function findCycle(start, nodes, canOpen) {
    const deps = key => {
        const node = nodes.get(key);
        const items = [...node.opens.rows.flatMap(r => r.items), ...node.opens.all];
        return [...new Set(items.flatMap(i => i.type === 'entry' ? [i.key] : i.type === 'pack' ? i.keys : []))].filter(k => !canOpen.has(k));
    };
    const path = [];
    const seen = new Set();
    const visit = key => {
        path.push(key);
        seen.add(key);
        for (const next of deps(key)) {
            if (next === start) return [...path, start];
            if (!seen.has(next)) {
                const found = visit(next);
                if (found) return found;
            }
        }
        path.pop();
        return null;
    };
    return visit(start);
}
