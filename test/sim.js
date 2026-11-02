// A small stand-in for SillyTavern's World Info scan, to play chats through the engine in tests.
// Keyword matching is plain substring over the last two messages (ST's default scan depth 2).
import { buildModel, FIELD } from '../src/engine/model.js';
import { advance, holdingKeys, keepAtLoad, settleScan, stateForScan } from '../src/engine/turn.js';

/** An entry in shorthand: `e(0, 'mill', { id: 'mill', gate: [['road']] })`. Keys default to the id. */
export function e(uid, keys, config, extra = {}) {
    const entry = { uid, world: extra.world ?? 'Book', comment: extra.comment ?? (typeof keys === 'string' ? keys : keys?.[0] ?? `e${uid}`), key: keys === null ? [] : [].concat(keys), content: `[${uid}]`, ...extra };
    if (config !== undefined) entry.extensions = { [FIELD]: config };
    return entry;
}

export class Sim {
    /**
     * @param {object[]} entries
     * @param {object} [options] { greeting: key the chat opened with, modelOptions }
     */
    constructor(entries, options = {}) {
        this.entries = entries;
        this.options = options;
        this.model = buildModel(entries, options.modelOptions);
        this.chat = [{ is_user: false, mes: options.greetingText ?? 'Hello.', name: 'Char' }];
        this.sticky = new Set();
    }

    rebuild(entries = this.entries) {
        this.entries = entries;
        this.model = buildModel(entries, this.options.modelOptions);
    }

    get stateOpts() { return { greeting: this.options.greeting ?? null }; }

    /** The state the next generation would start from (after the last snapshot). */
    get state() { return stateForScan(this.chat, this.model, this.stateOpts); }

    /** Sends a user message and generates a reply. Returns the uids that were injected. */
    send(text, reply = 'Reply.') {
        this.chat.push({ is_user: true, mes: text, name: 'User' });
        return this.generate(reply);
    }

    /** Swipes the last reply: the state rewinds to before it. */
    swipe(reply = 'Swipe.') {
        return this.generate(reply, 'swipe');
    }

    /** Continues the last reply: same message, fired set is the union. */
    continue(more = ' More.') {
        return this.generate(more, 'continue');
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
        // ST's scan: keyword matches, constants, forced holds, then our settle after each loop.
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

    /** Uids injected last turn, with the mask chosen for each (name or null). */
    maskOf(uid) { return this.lastMasks.get(`Book.${uid}`); }
}
