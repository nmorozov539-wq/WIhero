// Behavior fingerprint: four small scenarios played through the engine with the stand-in scan, hashed over what a
// later run must reproduce (which entries fire and are injected, the masks and written text, what closes and holds,
// sticky state, and the final state). Deterministic: the same four scenarios give the same hash on every run.
//
// This does not claim parity with the old harness's 897800cddace9896: those files are gone, so this is a fresh
// fingerprint over these four scenarios. Changing any observable decision changes the hash; that is the point.
import { createHash } from 'node:crypto';
import { buildModel, FIELD } from '../../src/engine/model.js';
import { advance, holdingKeys, keepAtLoad, settleScan, slotValues, stateForScan } from '../../src/engine/turn.js';
import { e } from './fixture.mjs';

/** The small stand-in scan from test/sim.js, copied so tools do not import test files. */
class Sim {
    constructor(entries, options = {}) {
        this.entries = entries;
        this.options = options;
        this.model = buildModel(entries, options.modelOptions);
        this.chat = [{ is_user: false, mes: options.greetingText ?? 'Hello.', name: 'Char' }];
        this.sticky = new Set();
    }

    get stateOpts() { return { greeting: this.options.greeting ?? null }; }
    get state() { return stateForScan(this.chat, this.model, this.stateOpts); }

    send(text, reply = 'Reply.') {
        this.chat.push({ is_user: true, mes: text, name: 'User' });
        return this.generate(reply);
    }

    generate(reply, type = 'normal') {
        const replacing = type === 'swipe' || type === 'continue';
        const chat = replacing ? this.chat.slice(0, -1) : this.chat;
        const working = stateForScan(chat, this.model, this.stateOpts);
        this.lastWorking = working;
        const loaded = this.entries.filter(entry => keepAtLoad(entry, this.model, working, chat, this.sticky));
        const key = entry => `${entry.world}.${entry.uid}`;
        const holds = new Set(holdingKeys(this.model, working));
        const text = chat.filter(m => !m.is_system).slice(-2).map(m => m.mes).join('\n').toLowerCase();
        const map = new Map();
        for (const entry of loaded) {
            if (entry.disable) continue;
            if (entry.constant || holds.has(key(entry)) || this.sticky.has(key(entry)) || entry.key.some(k => text.includes(k.toLowerCase()))) map.set(key(entry), entry);
        }
        let settled;
        for (let pass = 0; pass < 5; pass++) {
            settled = settleScan(this.model, working, { activated: [...map.keys()], chat, sticky: this.sticky, byDropped: this.byDropped?.(map, chat) });
            for (const k of settled.drop) map.delete(k);
            const forced = settled.force.map(k => loaded.find(x => key(x) === k)).filter(x => x && !x.disable);
            if (!forced.length) break;
            for (const x of forced) map.set(key(x), x);
        }
        this.lastSettle = settled;
        this.lastMasks = settled.masks;
        let fired = [...map.keys()];
        let mesId;
        if (replacing) {
            mesId = this.chat.length - 1;
            const message = this.chat[mesId];
            if (type === 'continue') {
                fired = [...new Set([...(message.extra?.[FIELD]?.round ?? []), ...fired])];
                message.mes += reply;
            } else {
                message.mes = reply;
            }
        } else {
            this.chat.push({ is_user: false, mes: reply, name: 'Char' });
            mesId = this.chat.length - 1;
        }
        const next = advance(working, { fired, victims: settled.victims }, this.model, this.chat, mesId);
        this.chat[mesId].extra = { [FIELD]: next };
        this.lastFired = fired.map(k => Number(k.split('.').pop()));
        return this.lastFired;
    }
}

/** A Moment as it is stored: phrases as keys, no content, switched off, "Moment: …". */
const moment = (uid, phrases, config = {}) => ({
    ...e(uid, phrases, { id: config.id ?? `m${uid}`, moment: true, ...config }, { comment: `Moment: ${phrases[0]}` }),
    content: '',
    disable: true,
});

const sortedMap = map => [...(map ?? new Map()).entries()].map(([k, v]) => [k, v]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const sortedObject = object => Object.fromEntries(Object.entries(object ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/** Recursively sort object keys so the hash does not depend on insertion order. */
function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
    return value;
}

/** The observable state after a turn: fired counts, closures, holds, masks, written pointers and tracker values. */
function capture(sim) {
    const state = sim.state;
    const values = slotValues(sim.model, state, sim.chat);
    return {
        fired: sortedObject(state.fired),
        closed: Object.fromEntries(Object.entries(state.closed).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, v.by])),
        holding: Object.keys(state.holding).sort(),
        masksClosed: Object.keys(state.masks.closed).sort(),
        masksPick: sortedObject(state.masks.pick),
        written: sortedObject(state.written),
        values: [...values.entries()].sort(([a], [b]) => (a < b ? -1 : 1)),
        round: [...state.round].sort(),
        sticky: [...sim.sticky].sort(),
    };
}

/** One turn, with everything the engine decided in it. */
function turn(sim, text, reply) {
    sim.send(text, reply);
    return {
        user: text,
        reply,
        fired: [...sim.lastFired].sort((a, b) => a - b),
        masks: sortedMap(sim.lastMasks),
        text: sortedMap(sim.lastSettle.text),
        victims: sortedMap(sim.lastSettle.victims),
        state: capture(sim),
    };
}

// 1. Plain gating: a chain of Waits for rows, an AND row, a permanent entry, and Closes when.
function plainGating() {
    const sim = new Sim([
        e(0, 'road', { id: 'road' }),
        e(1, 'mill town', { id: 'mill', gate: [['road']] }),
        e(2, 'miller', { id: 'miller', gate: [['road', 'mill']] }),
        e(3, 'inn', { id: 'inn', closeGate: [['miller']] }),
        e(4, 'tower', { id: 'tower', constant: true }),
    ]);
    return { name: 'plain-gating', turns: [
        turn(sim, 'the quiet road'),
        turn(sim, 'the mill town'),
        turn(sim, 'an inn'),
        turn(sim, 'the miller'),
        turn(sim, 'nothing happens'),
    ] };
}

// 2. Moments: one said in the user message, one armed by a gate and said in a reply, and gates that depend on them.
function moments() {
    const sim = new Sim([
        moment(0, ['missing tooth'], { id: 'tooth' }),
        e(1, 'dentist', { id: 'dentist', gate: [['tooth']] }),
        moment(2, ['storm breaks'], { id: 'storm', by: 'char', gate: [['road']] }),
        e(3, 'flood', { id: 'flood', gate: [['storm']] }),
        e(4, 'north road', { id: 'road' }),
    ]);
    return { name: 'moments', turns: [
        turn(sim, 'find a dentist'),
        turn(sim, 'a dentist for my missing tooth'),
        turn(sim, 'the dentist again'),
        turn(sim, 'the north road'),
        turn(sim, 'flood?', 'The storm breaks.'),
        turn(sim, 'flood now'),
    ] };
}

// 3. Written values and masks: a tracker main, a hand-held main, two written masks whose gate is another tracker.
function writtenAndMasks() {
    const sim = new Sim([
        e(0, 'gold', { id: 'gold', glue: { mode: 'hold' }, written: {} }, { comment: 'Gold', content: '10' }),
        e(1, 'ship', { id: 'ship', constant: true, masks: [
            { name: 'Night', written: { label: 'Hull Night' } },
            { name: 'Day', written: { label: 'Hull Day' }, gate: [['gold']] },
        ] }, { comment: 'Ship' }),
    ]);
    return { name: 'written-masks', turns: [
        turn(sim, 'the ship', 'Systems ready. [Hull Night: 88]'),
        turn(sim, 'gold', 'You find coins. [Gold: 7]'),
        turn(sim, 'the ship again', 'Hull holds. [Hull Day: 42]'),
        turn(sim, 'ship, report', 'All quiet.'),
        turn(sim, 'gold again', 'More coins. [Gold: 3]'),
    ] };
}

// 4. Closures and sticky: Once, Closes when, a hold closed by another entry, and a sticky that keeps a closed entry.
function closuresAndSticky() {
    const sim = new Sim([
        e(0, 'ferry', { id: 'ferry' }),
        e(1, 'blaze', { id: 'blaze', once: true }),
        e(2, 'smoke', { id: 'smoke', closeGate: [['ferry']] }),
        e(3, 'anchor', { id: 'anchor', glue: { mode: 'hold' }, closeGate: [['ferry']] }),
    ]);
    const turns = [];
    turns.push(turn(sim, 'a blaze'));
    sim.sticky.add('Book.1'); // ST holds the entry by a timed sticky after it closes
    turns.push(turn(sim, 'nothing'));
    sim.sticky.clear();
    turns.push(turn(sim, 'still nothing'));
    turns.push(turn(sim, 'the anchor'));
    turns.push(turn(sim, 'smoke'));
    turns.push(turn(sim, 'nothing again'));
    turns.push(turn(sim, 'the ferry'));
    turns.push(turn(sim, 'the end'));
    return { name: 'closures-sticky', turns };
}

const SCENARIOS = [plainGating, moments, writtenAndMasks, closuresAndSticky];
const NAMES = ['plain-gating', 'moments', 'written-masks', 'closures-sticky'];

/** Runs the four scenarios and returns the payload and its hash. */
export function fingerprint() {
    const scenarios = SCENARIOS.map(make => make());
    const payload = stable({ scenarios });
    const behaviorHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
    return { behaviorHash, scenarios: payload.scenarios };
}

export async function run({ sink }) {
    const { behaviorHash } = fingerprint();
    sink.add({
        bench: 'behavior',
        metric: 'hash',
        fixture: { scenarios: SCENARIOS.length, names: NAMES, turns: 'plain, Moments, written/masks, closures/sticky' },
        behaviorHash,
    });
}
