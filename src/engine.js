// Gate engine: pure functions over lorebook entries and gate state. No SillyTavern imports.
// See docs/DESIGN.md sections 2.0–2.2 and 3.
//
// An entry takes part when it has a `wihero` field:
//   wihero: { id: 'arrive-town', gates: ['leave-home'], gateMode: 'all' | 'any', closeGates: true }
// `gates` lists ids that must have fired before the entry may fire. When the entry fires,
// it closes the gate entries that fired (a chain advancing), unless `closeGates` is false.
// Closed is final: only a rewind (an older snapshot) brings an entry back.
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
 * @returns {{ nodes: Map<string, object>, byKey: Map<string, object>, issues: object[] }}
 *   `nodes` by id, `byKey` by world.uid for every entry with config.
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
    }

    for (const cycle of findCycles(nodes)) {
        for (const id of cycle) {
            const node = nodes.get(id);
            node.broken = true;
            issues.push({ key: node.key, id, label: node.label, message: `is in a gate loop: ${[...cycle, cycle[0]].join(' → ')}` });
        }
    }

    return { nodes, byKey, issues };
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
    return { v: STATE_VERSION, fired: {}, closed: {}, round: [] };
}

/** Accepts a stored snapshot, or returns null if it isn't one this version can read. */
export function readState(value) {
    if (!value || typeof value !== 'object' || value.v !== STATE_VERSION) return null;
    const object = x => x && typeof x === 'object' && !Array.isArray(x) ? { ...x } : {};
    return {
        v: STATE_VERSION,
        fired: object(value.fired),
        closed: object(value.closed),
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
    if (state.closed[node.id]) return { eligible: false, reason: 'closed' };
    if (!node.gates.length) return { eligible: true, reason: 'open' };
    const passed = node.gates.filter(g => state.fired[g] > 0);
    const open = node.gateMode === 'any' ? passed.length > 0 : passed.length === node.gates.length;
    if (open) return { eligible: true, reason: 'gate open' };
    const waiting = node.gates.filter(g => !(state.fired[g] > 0));
    return { eligible: false, reason: `waiting for ${waiting.join(node.gateMode === 'any' ? ' or ' : ' and ')}` };
}

/**
 * Removes the entries that may not fire from ST's lore lists, in place.
 * Only removes: editing an entry here would change the hash ST keys timed effects by.
 * @param {Record<string, object[]>} lore The WORLDINFO_ENTRIES_LOADED payload.
 * @returns {number} How many entries were removed.
 */
export function removeIneligible(lore, model, state) {
    let removed = 0;
    for (const list of Object.values(lore ?? {})) {
        if (!Array.isArray(list)) continue;
        for (let i = list.length - 1; i >= 0; i--) {
            if (!eligibility(list[i], model, state).eligible) {
                list.splice(i, 1);
                removed++;
            }
        }
    }
    return removed;
}

/**
 * State after one chat generation. Takes effect from the next generation on.
 * @param {object} state State before the generation.
 * @param {(object|string)[]} activated Entries ST activated (WORLD_INFO_ACTIVATED), or their world.uid keys.
 * @returns {object} New state; `round` holds the world.uid keys of everything that fired.
 */
export function advance(state, activated, model) {
    const next = { v: STATE_VERSION, fired: { ...state.fired }, closed: { ...state.closed }, round: [] };
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
    // Closing happens after counting, so an entry and its child firing together both count.
    // Only gates that actually fired close: with gateMode "any", the other paths stay as they are.
    for (const node of firedNodes) {
        if (!node.closeGates) continue;
        for (const gate of node.gates) {
            if (next.fired[gate] > 0) next.closed[gate] = true;
        }
    }
    return next;
}
