// Gate engine: pure functions over lorebook entries and gate state. No SillyTavern imports.
// See docs/DESIGN.md sections 2.0–2.2 and 3.
//
// An entry takes part when it has a `wihero` field:
//   wihero: { id: 'arrive-town', gates: ['leave-home'], gateMode: 'all' | 'any', closeGates: true }
// `gates` lists ids that must have fired before the entry may fire. When the entry fires,
// it closes the gate entries that fired (a chain advancing), unless `closeGates` is false.
// Closed is final: only a rewind (an older snapshot) brings an entry back.
//
// Glue keeps an entry injected every turn from its first firing until a close condition, then closes it:
//   glue: { closeKeywords: ['we leave'], closeWhenFired: ['x'], closeWhenAllFired: ['x', 'y'] }
// `glue: true` (or {}) glues with no close condition. A glued entry is never closed by a chain advancing.
//
// A railway switch on a fork entry: when one of its paths fires, the others close for good.
//   switch: ['left', 'right']
// Only one path fires per turn: a tie keeps the first in switch order (switchLosers).
//
// Masks are alternate content for an entry, active by their own gates or when selected (state.masks):
//   masks: [{ name: 'ruined', content: '...', gates: ['storm'], gateMode: 'all' }]
// A malformed mask is reported and skipped; the entry itself still works with its base content.
// Entries without `wihero` are never touched.

export const FIELD = 'wihero';
export const STATE_VERSION = 1;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

/** Key ST uses for an entry within the loaded books. */
export const entryKey = entry => `${entry.world}.${entry.uid}`;

const label = entry => entry.comment || (Array.isArray(entry.key) && entry.key[0]) || `uid ${entry.uid}`;

/**
 * Reads the gate config of every entry and checks it.
 * @param {object[]} entries ST entries, each with `world` and `uid`.
 * @returns {{ nodes: Map<string, object>, byKey: Map<string, object>, issues: object[], switches: object[], switchOf: Map<string, object> }}
 *   `nodes` by id, `byKey` by world.uid for every entry with config.
 *   `switches` are { fork, paths } for every working switch, `switchOf` maps a path id to its switch.
 *   A node is { id, key, world, uid, label, gates, gateMode, closeGates, broken }.
 *   A broken node can never fire: its config is wrong, so letting it through could leak a spoiler.
 */
export function buildModel(entries) {
    const issues = [];
    const byKey = new Map();
    const nodes = new Map();
    const duplicates = new Set();

    for (const entry of entries ?? []) {
        const config = entry?.[FIELD];
        if (config === undefined || config === null) continue;
        const node = {
            id: null,
            key: entryKey(entry),
            world: entry.world,
            uid: entry.uid,
            label: label(entry),
            gates: [],
            gateMode: 'all',
            closeGates: true,
            glue: null,
            switch: [],
            masks: [],
            broken: false,
        };
        byKey.set(node.key, node);
        const problem = message => {
            node.broken = true;
            issues.push({ key: node.key, id: node.id, label: node.label, message });
        };

        if (typeof config !== 'object' || Array.isArray(config)) {
            problem('config is not an object');
            continue;
        }
        if (typeof config.id !== 'string' || !ID_PATTERN.test(config.id)) {
            problem(config.id === undefined ? 'has no id' : `id "${config.id}" is not valid`);
        } else {
            node.id = config.id;
        }
        if (config.gates !== undefined) {
            if (!Array.isArray(config.gates) || config.gates.some(g => typeof g !== 'string' || !g)) {
                problem('gates must be a list of ids');
            } else {
                node.gates = [...new Set(config.gates)];
            }
        }
        if (config.gateMode !== undefined) {
            if (config.gateMode === 'all' || config.gateMode === 'any') node.gateMode = config.gateMode;
            else problem(`gateMode "${config.gateMode}" must be "all" or "any"`);
        }
        if (config.closeGates !== undefined) {
            if (typeof config.closeGates === 'boolean') node.closeGates = config.closeGates;
            else problem('closeGates must be true or false');
        }
        if (config.glue !== undefined && config.glue !== false) {
            const glue = readGlue(config.glue);
            if (typeof glue === 'string') {
                problem(glue);
            } else {
                node.glue = glue;
                if (entry.useProbability !== false && Number(entry.probability ?? 100) < 100) {
                    issues.push({ key: node.key, id: node.id, label: node.label, warning: true,
                        message: 'is glued but has a trigger chance below 100%, so it can still drop out' });
                }
                if (Number(entry.cooldown) > 0) {
                    issues.push({ key: node.key, id: node.id, label: node.label, warning: true,
                        message: "has a cooldown, so glue can't hold it every turn" });
                }
            }
        }

        if (config.switch !== undefined) {
            if (!Array.isArray(config.switch) || config.switch.some(x => typeof x !== 'string' || !x) || new Set(config.switch).size < 2) {
                problem('switch must list at least two ids');
            } else {
                node.switch = [...new Set(config.switch)];
            }
        }

        if (config.masks !== undefined) {
            const note = message => issues.push({ key: node.key, id: node.id, label: node.label, message });
            if (!Array.isArray(config.masks)) note('masks must be a list');
            else node.masks = readMasks(config.masks, note);
        }

        if (node.id === null) continue;
        if (nodes.has(node.id)) {
            duplicates.add(node.id);
            const first = nodes.get(node.id);
            if (!first.broken) {
                first.broken = true;
                issues.push({ key: first.key, id: first.id, label: first.label, message: `id "${node.id}" is used by more than one entry` });
            }
            problem(`id "${node.id}" is used by more than one entry`);
        } else {
            nodes.set(node.id, node);
        }
    }

    for (const node of byKey.values()) {
        if (node.id === null || duplicates.has(node.id) && nodes.get(node.id) !== node) continue;
        for (const gate of node.gates) {
            if (gate === node.id) {
                node.broken = true;
                issues.push({ key: node.key, id: node.id, label: node.label, message: 'gates on itself' });
            } else if (!nodes.has(gate)) {
                node.broken = true;
                issues.push({ key: node.key, id: node.id, label: node.label, message: `gates on "${gate}", which no entry has` });
            }
        }
        for (const id of node.glue ? [...node.glue.closeWhenFired, ...node.glue.closeWhenAllFired] : []) {
            if (!nodes.has(id)) {
                node.broken = true;
                issues.push({ key: node.key, id: node.id, label: node.label, message: `glue closes on "${id}", which no entry has` });
            }
        }
    }

    for (const node of byKey.values()) {
        node.masks = node.masks.filter(mask => {
            const unknown = mask.gates.find(gate => !nodes.has(gate));
            if (unknown) issues.push({ key: node.key, id: node.id, label: node.label, message: `mask "${mask.name}" gates on "${unknown}", which no entry has` });
            return !unknown;
        });
    }

    const pathOwners = new Map();
    for (const node of nodes.values()) {
        for (const path of node.switch) {
            if (!pathOwners.has(path)) pathOwners.set(path, []);
            pathOwners.get(path).push(node);
        }
    }
    for (const node of nodes.values()) {
        for (const path of node.switch) {
            const issue = (message, warning = false) => {
                if (!warning) node.broken = true;
                issues.push({ key: node.key, id: node.id, label: node.label, message, ...(warning && { warning }) });
            };
            if (path === node.id) issue('switch lists itself');
            else if (!nodes.has(path)) issue(`switch lists "${path}", which no entry has`);
            else if (pathOwners.get(path).length > 1) issue(`switch path "${path}" is also in the switch of ${pathOwners.get(path).filter(n => n !== node).map(n => n.id).join(', ')}`);
            else if (!nodes.get(path).gates.includes(node.id)) issue(`switch path "${path}" doesn't gate on ${node.id}, so it can be taken before the fork`, true);
        }
    }

    for (const cycle of findCycles(nodes)) {
        for (const id of cycle) {
            const node = nodes.get(id);
            node.broken = true;
            issues.push({ key: node.key, id, label: node.label, message: `is in a gate loop: ${[...cycle, cycle[0]].join(' → ')}` });
        }
    }

    const switches = [...nodes.values()].filter(n => n.switch.length && !n.broken).map(fork => ({ fork: fork.id, paths: fork.switch }));
    const switchOf = new Map(switches.flatMap(sw => sw.paths.map(path => [path, sw])));
    return { nodes, byKey, issues, switches, switchOf };
}

/** Parses a glue config, or returns what's wrong with it. */
function readGlue(value) {
    if (value === true) value = {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'glue must be true or an object';
    const glue = { closeKeywords: [], closeWhenFired: [], closeWhenAllFired: [] };
    for (const field of Object.keys(glue)) {
        if (value[field] === undefined) continue;
        if (!Array.isArray(value[field]) || value[field].some(x => typeof x !== 'string' || !x)) return `glue.${field} must be a list of strings`;
        glue[field] = [...new Set(value[field])];
    }
    for (const keyword of glue.closeKeywords) {
        if (keywordMatcher(keyword) === null) return `glue.closeKeywords: "${keyword}" is not a valid regex`;
    }
    const unknown = Object.keys(value).filter(k => !(k in glue));
    if (unknown.length) return `glue has unknown field${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}`;
    return glue;
}

/** The well-formed masks of a config; each malformed one is reported through `note` and left out. */
function readMasks(list, note) {
    const masks = [];
    list.forEach((mask, i) => {
        const name = typeof mask?.name === 'string' && mask.name ? mask.name : null;
        const problem = message => note(`mask ${name ? `"${name}"` : i + 1}: ${message}`);
        if (!mask || typeof mask !== 'object' || Array.isArray(mask)) return problem('is not an object');
        if (!name || !ID_PATTERN.test(name)) return problem(name ? 'name is not valid' : 'has no name');
        if (masks.some(m => m.name === name)) return problem('name is used twice');
        if (typeof mask.content !== 'string' || !mask.content.trim()) return problem('has no content');
        if (mask.gates !== undefined && (!Array.isArray(mask.gates) || mask.gates.some(g => typeof g !== 'string' || !g))) return problem('gates must be a list of ids');
        if (mask.gateMode !== undefined && mask.gateMode !== 'all' && mask.gateMode !== 'any') return problem('gateMode must be "all" or "any"');
        const unknown = Object.keys(mask).filter(k => !['name', 'content', 'gates', 'gateMode'].includes(k));
        if (unknown.length) return problem(`has unknown field${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}`);
        masks.push({ name, content: mask.content, gates: [...new Set(mask.gates ?? [])], gateMode: mask.gateMode ?? 'all' });
    });
    return masks;
}

/**
 * Keyword test like ST's: `/pattern/flags` is a regex, anything else a case-insensitive substring.
 * @returns {((text: string) => boolean) | null} null for a broken regex.
 */
export function keywordMatcher(keyword) {
    const regex = /^\/(.+)\/([a-z]*)$/s.exec(keyword);
    if (!regex) {
        const needle = keyword.toLowerCase();
        return text => text.toLowerCase().includes(needle);
    }
    try {
        const pattern = new RegExp(regex[1], regex[2]);
        return text => { pattern.lastIndex = 0; return pattern.test(text); };
    } catch {
        return null;
    }
}

/** Gate loops, each as a list of ids. Self-gates are reported separately and skipped here. */
function findCycles(nodes) {
    const cycles = [];
    const color = new Map(); // undefined = unvisited, 1 = on stack, 2 = done
    const stack = [];

    const visit = id => {
        color.set(id, 1);
        stack.push(id);
        for (const gate of nodes.get(id).gates) {
            if (gate === id || !nodes.has(gate)) continue;
            if (color.get(gate) === 1) {
                cycles.push(stack.slice(stack.indexOf(gate)));
            } else if (!color.has(gate)) {
                visit(gate);
            }
        }
        stack.pop();
        color.set(id, 2);
    };

    for (const id of nodes.keys()) {
        if (!color.has(id)) visit(id);
    }
    return cycles;
}

/** State at the start of a chat: nothing fired, nothing closed. Entries without gates are open. */
export function initialState() {
    return { v: STATE_VERSION, fired: {}, closed: {}, glued: {}, masks: {}, round: [] };
}

/** Accepts a stored snapshot, or returns null if it isn't one this version can read. */
export function readState(value) {
    if (!value || typeof value !== 'object' || value.v !== STATE_VERSION) return null;
    const object = x => x && typeof x === 'object' && !Array.isArray(x) ? { ...x } : {};
    return {
        v: STATE_VERSION,
        fired: object(value.fired),
        closed: object(value.closed),
        glued: object(value.glued),
        masks: object(value.masks),
        round: Array.isArray(value.round) ? [...value.round] : [],
    };
}

/**
 * Whether ST may scan this entry now. Entries without config always may.
 * @returns {{ eligible: boolean, reason: string }}
 */
export function eligibility(entry, model, state) {
    const node = model.byKey.get(entryKey(entry));
    if (!node) return { eligible: true, reason: 'not gated' };
    if (node.broken) return { eligible: false, reason: 'config problem' };
    if (state.closed[node.id]) return { eligible: false, reason: closedReason(node, model, state) };
    if (state.glued[node.id]) return { eligible: true, reason: 'glued' };
    if (!node.gates.length) return { eligible: true, reason: 'open' };
    if (gatesPassed(node, state)) return { eligible: true, reason: 'gate open' };
    const waiting = node.gates.filter(g => !(state.fired[g] > 0));
    return { eligible: false, reason: `waiting for ${waiting.join(node.gateMode === 'any' ? ' or ' : ' and ')}` };
}

/** Whether the gates of an entry or a mask have fired (all of them, or any for gateMode "any"). */
function gatesPassed({ gates, gateMode }, state) {
    const passed = gates.filter(g => state.fired[g] > 0).length;
    return gateMode === 'any' ? passed > 0 : passed === gates.length;
}

/**
 * The mask an entry injects now, or null for its base content. A selected mask (state.masks) wins;
 * otherwise the last listed mask whose gates have fired. A mask without gates is only active when selected,
 * and a selected name that isn't a well-formed mask means base content.
 */
export function activeMask(node, state) {
    if (!node || node.broken) return null;
    const selected = state.masks?.[node.id];
    if (selected !== undefined) return node.masks.find(m => m.name === selected) ?? null;
    return node.masks.findLast(m => m.gates.length && gatesPassed(m, state)) ?? null;
}

/** State with a mask selected for an entry, or the selection cleared (name empty). */
export function selectMask(state, id, name) {
    const next = structuredClone(state);
    next.masks ??= {};
    if (name) next.masks[id] = name;
    else delete next.masks[id];
    return next;
}

/** "closed", or which path a switch took instead of this one. */
function closedReason(node, model, state) {
    const taken = model.switchOf?.get(node.id)?.paths.find(path => path !== node.id && state.fired[path] > 0);
    return taken ? `closed (switch: took ${taken})` : 'closed';
}

/**
 * world.uid keys to drop from one scan's activated entries so each switch fires at most one path:
 * of the paths activated together, the first in switch order stays.
 * @param {string[]} keys world.uid keys ST activated so far in the scan.
 */
export function switchLosers(model, keys) {
    const active = new Set(keys.map(key => model.byKey.get(key)?.id).filter(Boolean));
    const losers = [];
    for (const sw of model.switches ?? []) {
        const [, ...others] = sw.paths.filter(path => active.has(path));
        losers.push(...others.map(id => model.nodes.get(id).key));
    }
    return losers;
}

/** State with an entry no longer closed: the manual escape hatch. */
export function reopen(state, id) {
    const next = structuredClone(state);
    delete next.closed[id];
    return next;
}

/**
 * Removes the entries that may not fire from ST's lore lists, in place.
 * Only removes: editing an entry here would change the hash ST keys timed effects by.
 * @param {Record<string, object[]>} lore The WORLDINFO_ENTRIES_LOADED payload.
 * @param {Set<string> | Map<string, unknown>} [keep] world.uid keys never to remove (entries ST holds by sticky).
 * @returns {number} How many entries were removed.
 */
export function removeIneligible(lore, model, state, keep) {
    let removed = 0;
    for (const list of Object.values(lore ?? {})) {
        if (!Array.isArray(list)) continue;
        for (let i = list.length - 1; i >= 0; i--) {
            if (!keep?.has(entryKey(list[i])) && !eligibility(list[i], model, state).eligible) {
                list.splice(i, 1);
                removed++;
            }
        }
    }
    return removed;
}

/** world.uid keys of the entries that are glued and so must be force-activated. */
export function gluedKeys(model, state) {
    return Object.keys(state.glued)
        .map(id => model.nodes.get(id))
        .filter(node => node && !node.broken && !state.closed[node.id])
        .map(node => node.key);
}

/**
 * State after one chat generation. Takes effect from the next generation on.
 * @param {object} state State before the generation.
 * @param {(object|string)[]} activated Entries ST activated (WORLD_INFO_ACTIVATED), or their world.uid keys.
 * @param {string} [text] The turn's new messages, checked for glue close keywords.
 * @returns {object} New state; `round` holds the world.uid keys of everything that fired.
 */
export function advance(state, activated, model, text = '') {
    const next = {
        v: STATE_VERSION,
        fired: { ...state.fired },
        closed: { ...state.closed },
        glued: Object.fromEntries(Object.entries(state.glued ?? {}).map(([id, g]) => [id, { seen: [...g.seen] }])),
        masks: { ...state.masks },
        round: [],
    };
    const firedNodes = [];
    for (const item of activated ?? []) {
        const key = typeof item === 'string' ? item : entryKey(item);
        if (next.round.includes(key)) continue;
        next.round.push(key);
        const node = model.byKey.get(key);
        if (!node || node.id === null || node.broken) continue;
        next.fired[node.id] = (next.fired[node.id] ?? 0) + 1;
        firedNodes.push(node);
    }
    const firedNow = new Set(firedNodes.map(n => n.id));

    // Glue that was already holding: check its close conditions against this turn.
    for (const [id, glued] of Object.entries(next.glued)) {
        const glue = model.nodes.get(id)?.glue;
        if (!glue) {
            delete next.glued[id];
            continue;
        }
        for (const other of glue.closeWhenAllFired) {
            if (firedNow.has(other) && !glued.seen.includes(other)) glued.seen.push(other);
        }
        const release = glue.closeKeywords.some(k => keywordMatcher(k)?.(text))
            || glue.closeWhenFired.some(other => firedNow.has(other))
            || glue.closeWhenAllFired.length > 0 && glue.closeWhenAllFired.every(other => glued.seen.includes(other));
        if (release) {
            delete next.glued[id];
            next.closed[id] = true;
        }
    }
    // New glue starts from the entry's first firing; its close conditions count from the next turn.
    for (const node of firedNodes) {
        if (node.glue && !state.glued?.[node.id] && !next.closed[node.id]) next.glued[node.id] = { seen: [] };
    }
    // A switch closes every path but the one taken (the first in switch order, should two fire together).
    for (const sw of model.switches ?? []) {
        const taken = sw.paths.find(path => firedNow.has(path));
        if (!taken) continue;
        for (const path of sw.paths) {
            if (path === taken) continue;
            next.closed[path] = true;
            delete next.glued[path];
        }
    }
    // Closing happens after counting, so an entry and its child firing together both count.
    // Only gates that actually fired close: with gateMode "any", the other paths stay as they are.
    // Glued gates stay open: glue is the override for a chain advancing.
    for (const node of firedNodes) {
        if (!node.closeGates) continue;
        for (const gate of node.gates) {
            if (next.fired[gate] > 0 && !next.glued[gate]) next.closed[gate] = true;
        }
    }
    return next;
}
