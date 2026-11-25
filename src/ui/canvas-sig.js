// The Hero canvas's inputs as one stable string (V2): the canvas elements, the cards' saved geometry, whether the
// canvas was arranged, the hidden entries and the chat's identity. Book bookkeeping, entry text, top-level settings
// and chat state are left out, so a content edit or opening the inspector does not redraw the cards.
//
// The entry side is expensive to build, so modelOf computes it once per model and keeps it on the model as
// `canvasElementSig`; a Hero draw only combines that string with the cheap saved-memory side below.
import { canvasBook } from './canvas-graph.js';
import { blockingUids } from './model-issues.js';

const LIST_FIELDS = ['keys', 'gate', 'gatesFor', 'closeGate', 'closesFor', 'fromGreetings', 'switch', 'packs'];
const FLAG_FIELDS = ['off', 'problem', 'once'];
const VALUE_FIELDS = ['folder', 'note', 'by', 'glue'];

const isObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
const sortedKeys = o => (o ? Object.keys(o).sort() : []);

function sortedObject(o) {
    const out = {};
    for (const k of sortedKeys(o)) out[k] = o[k];
    return out;
}

/** A mask's shape is its name and its rows; its text is body content, not geometry. */
function maskShape(mask) {
    if (!isObject(mask)) return mask;
    const out = {};
    if (mask.name !== undefined) out.name = mask.name;
    if (mask.gate !== undefined) out.gate = mask.gate;
    if (mask.closeGate !== undefined) out.closeGate = mask.closeGate;
    return out;
}

/** An element as the canvas draws it: every visible field, without the entry it came from or its text. Empty
 *  lists and off flags are left out of the shape; they still tell apart an element that gains or loses one. */
function elementShape(e) {
    const out = { id: e.id, title: e.title };
    if (e.strategy !== undefined && e.strategy !== 'keys') out.strategy = e.strategy;
    for (const key of LIST_FIELDS) if (Array.isArray(e[key]) && e[key].length) out[key] = e[key];
    for (const key of FLAG_FIELDS) if (e[key]) out[key] = e[key];
    for (const key of VALUE_FIELDS) if (e[key]) out[key] = e[key];
    if (e.closesAfter !== null && e.closesAfter !== undefined) out.closesAfter = e.closesAfter;
    if (Array.isArray(e.masks) && e.masks.length) out.masks = e.masks.map(maskShape);
    if (e.moment) out.moment = { phrases: e.moment.phrases ?? [], by: e.moment.by ?? null };
    return out;
}

function cardShape(card) {
    if (!isObject(card)) return card ?? null;
    const out = {};
    for (const key of ['x', 'y']) if (card[key] !== undefined) out[key] = card[key];
    if (card.ports !== undefined) out.ports = isObject(card.ports) ? sortedObject(card.ports) : card.ports;
    if (card.layer !== undefined) out.layer = card.layer;
    if (card.links !== undefined) {
        if (isObject(card.links)) {
            out.links = {};
            for (const key of sortedKeys(card.links)) out.links[key] = card.links[key];
        } else out.links = card.links;
    }
    if (card.placed !== undefined) out.placed = card.placed;
    return out;
}

function elementsOf(elements) {
    const list = elements instanceof Map ? [...elements.values()] : Array.isArray(elements) ? elements : elements ? [...elements] : [];
    // Greeting cards come from the open chat, not the book; their badges and text are V6, not canvas geometry.
    return list.filter(e => !e?.greeting).map(elementShape)
        .sort((a, b) => String(a.id ?? '').localeCompare(String(b.id ?? '')) || String(a.title ?? '').localeCompare(String(b.title ?? '')));
}

function cardsOf(cards) {
    const out = {};
    for (const key of sortedKeys(cards)) out[key] = cardShape(cards[key]);
    return out;
}

/**
 * The canvas's elements for a book's entries: the signature's entry side. It is built over every entry (the hidden
 * set is part of the cheap side), with no greeting cards: those come from the open chat, and their badges are V6.
 * @param {string} book
 * @param {{ entries: object }} data
 * @param {object} model the book's model, for its blocking problems
 * @param {(entry: object) => string} folderOf
 */
export function canvasElements(book, data, model, folderOf) {
    return canvasBook(data, { folderOf, problems: blockingUids(book, model), greetings: [] }).E;
}

/** The entry side as one string. Cards, the hidden set and chat identity are not in it. */
export function canvasElementSig(elements) {
    return JSON.stringify(elementsOf(elements));
}

/** The cheap side, worked out per Hero draw: saved card geometry, arrangement, hidden entries and chat identity. */
export function canvasMemorySig({ cards, placed, hidden, chat } = {}) {
    return JSON.stringify({
        cards: cardsOf(cards),
        placed: !!placed,
        hidden: [...(hidden ?? [])].map(String).sort(),
        chat: chat ?? null,
    });
}

/**
 * The whole canvas signature. The entry side comes from `model.canvasElementSig` when modelOf has built it; `elements`
 * is only called for a model built elsewhere, and its result is kept on the model like modelOf's. The memory side is
 * cheap and stays per draw.
 * @param {{ model?: object, elements?: Iterable|Map|(() => Iterable|Map), cards?: object, placed?: boolean,
 *   hidden?: Iterable, chat?: unknown }} input
 */
export function canvasInputSig({ model, elements, cards, placed, hidden, chat } = {}) {
    let entry = model?.canvasElementSig;
    if (typeof entry !== 'string') {
        entry = canvasElementSig(typeof elements === 'function' ? elements() : elements);
        if (model) model.canvasElementSig = entry;
    }
    return `${entry}\n${canvasMemorySig({ cards, placed, hidden, chat })}`;
}
