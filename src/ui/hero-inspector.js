// Hero mode's inspector (N4): one card's story logic, opened from the canvas, the panel or a tab, and what it
// needs around it: the chat's greetings, closed reasons, taking a card off the canvas, showing a card. Moved out of
// app.js; it reaches the app only through the context given to it.
import { PIECE_ANCHOR } from './guide.js';
import { askNote, bookEditor, greetingName, greetingRules, packsOf } from './pieces.js';
import { bookSettings, cardKey, configOf, entriesOf, idOf, rekeyEntry, titleOf } from './data.js';
import { buildGraph, canvasSet, momentName } from './canvas-graph.js';
import { canvasMemory } from './canvas.js';
import { closedText, logicLines } from './logic-text.js';
import { trackerContext } from './tracker-ui.js';
import { el } from './dom.js';
import { getStringHash, isObject } from '../engine/util.js';
import { greetingFingerprint, greetingsOf } from '../chat-state.js';
import { GREETINGS, isMoment } from '../engine/model.js';
import { renderGreetingInspector, renderInspector } from './inspector.js';
import { strategyColor } from './entry-page.js';

/**
 * @param {object} A The app's context (destructured below): its state, the canvas, the library and hooks, and the
 *   app functions the inspector calls.
 *   canvas() and isRenderQueued() read the app's current canvas and whether a draw is queued.
 */
export function createHeroInspector(A) {
    const {
        H, S, chatStatus, ctx, dataSheet, deleteEntries, deskSettings, heroData, heroInspector, hooks, inspShown,
        layer, leave, library, linkable, main, modelOf, openGuide, openHeroTab, panelState, problemsOf, warningsOf, render,
        saveSettings, settings, canvas, isRenderQueued, dropPiece,
    } = A;

    /**
     * The inspector's "Take off canvas": a card placed by hand comes off; a linked card stays while it has links, and
     * the button says why (`why`: what to remove first) instead of hiding.
     */
    function takeOffFor(book, title, why) {
        const key = H.insp.key;
        const view = canvas()?.view;
        const mem = canvasMemory(bookSettings(settings, book));
        const linked = view?.g.edges.some(x => x.from === key || x.to === key) || (view?.m.byId(key)?.packs.length ?? 0) > 0;
        if (!linked) return mem.cards[key]?.placed ? () => { delete mem.cards[key]; saveSettings(); H.insp = null; render(); layer.toast(`${title} taken off the canvas`); } : null;
        return () => layer.sheet('It stays while it has links', sh => {
            for (const w of why) sh.append(el('p', 'help', w));
        }, { help: 'A card with story links is always on the canvas, so the links can be seen. Once it has none, it can be taken off.' });
    }

    /** The open chat's character's greetings (BUILD_SPEC 15.4): none with no chat or in a group chat. */
    function chatGreetings(data) {
        const c = ctx();
        if (!GREETINGS) return []; // retired for v1 (#33): no greeting cards, panel rows or picker options
        if (!library.chatOpen() || c.groupId || c.characterId === undefined) return [];
        const ch = c.characters?.[c.characterId];
        if (!ch?.avatar) return [];
        // Fingerprints the book has for this character's greetings, to spot a changed one.
        const stored = new Map();
        const walk = x => {
            if (Array.isArray(x)) { x.forEach(walk); return; }
            if (!isObject(x)) return;
            if ('greeting' in x && x.char === ch.avatar) { const k = x.greeting; if (!stored.has(k)) stored.set(k, new Set()); stored.get(k).add(x.fp); return; }
            Object.values(x).forEach(walk);
        };
        for (const e of entriesOf(data)) walk(configOf(e));
        const opening = t => String(t ?? '').replace(/[*_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);
        return greetingsOf(ch).map((text, n) => {
            const fp = greetingFingerprint(text, getStringHash);
            return {
                key: `greet:${ch.avatar}:${n}`, ref: { greeting: n, char: ch.avatar, name: ch.name, fp }, fp,
                title: greetingName(n), text: opening(text), full: text,
                changed: [...(stored.get(n) ?? [])].some(f => f !== fp),
            };
        }).filter(g => g.full.trim());
    }

    /** Runs `fn(editor, data)` on a book; entries that got an id have their folder and canvas place rekeyed. */
    function editBook(book, fn) {
        let created = [];
        const out = library.change(book, d => { const ed = bookEditor(d); const r = fn(ed, d); created = ed.created; return r; }, { quiet: true });
        if (created.length) {
            for (const [uid, id] of created) {
                rekeyEntry(settings, book, uid, id);
                if (H.insp?.book === book && H.insp.key === `uid:${uid}`) H.insp.key = `id:${id}`;
            }
            saveSettings();
        }
        render();
        return out;
    }

    /** Opens the inspector on a card (from the canvas, a port, a pack sheet or Problems). */
    function inspect(book, key, piece = null, { tab = null } = {}) {
        const data = library.peek(book);
        let open = null;
        if (piece && data && !key.startsWith('greet:')) {
            const e = entriesOf(data).find(x => cardKey(x) === key);
            const c = e ? configOf(e) ?? {} : {};
            const has = piece === 'masks' ? Array.isArray(c.masks) && c.masks.length : piece === 'glue' || piece === 'written' ? isObject(c[piece]) || c[piece] === true : Array.isArray(c[piece]) && c[piece].length;
            if (has) open = piece;
        }
        const keep = H.insp?.key === key ? H.insp : null;
        H.insp = { book, key, open, full: keep?.full ?? false, scroll: 0, tab: tab ?? H.insp?.tab ?? 'logic', focusText: tab === 'text' };
        if (S.desk) {
            H.pick = [key];
            if (H.dinsp === null && deskSettings().heroInsp !== false && !inspShown()) H.dinsp = true; // a narrow drawer hid it: a click asks for it
        }
        H.panel = false;
        if (S.mode !== 'hero' || H.active !== 'canvas' || H.book !== book) { S.mode = 'hero'; H.active = 'canvas'; H.book = book; }
        else if (canvas() && data && main.dataset.page === 'hero:canvas' && !isRenderQueued()) {
            // Already on this canvas: only the inspector changes, so leave the cards and links as they are.
            panelState();
            if (S.desk) {
                canvas().setPicked(new Set([key]), true);
                for (const r of main.querySelectorAll('.prow')) r.classList.toggle('on', r.dataset.key === key);
                heroInspector(book, data);
                canvas().reveal(key);
                return;
            }
            main.querySelector('.insp')?.remove();
            inspectorFor(book, data);
            canvas().reveal(key, 0.5);
            return;
        }
        render();
        if (S.desk) canvas()?.setPicked(new Set([key]), true);
        canvas()?.reveal?.(key, S.desk ? 1 : 0.5);
    }

    const stateKeyToCard = k => (k.startsWith('@') ? `greet:${k.slice(1)}` : `id:${k.slice(k.indexOf('/') + 1)}`);

    /** What closed an entry in the open chat, with Reopen (D18). */
    function closedInfo(node, e) {
        const loaded = hooks.model;
        if (!node?.key || !loaded.nodes.has(node.key) || !ctx().chat?.length) return null;
        const c = hooks.state().closed[node.key];
        if (!c) return null;
        return {
            by: closedText(c.by, key => loaded.nodes.get(key)?.label ?? (key.startsWith('@') ? 'a greeting' : null)),
            reopen: async () => { await hooks.reopenEntry(node.key); layer.toast(`${titleOf(e)} is open again in this chat`); render(); },
        };
    }

    function inspectorFor(book, data, box = main) {
        const I = H.insp;
        const view = canvas()?.view;
        const shown = linkable(book, data);
        const others = except => shown.filter(x => x.uid !== except).map(x => ({ uid: x.uid, title: titleOf(x), dot: strategyColor(x) }));
        const nameOfId = id => { const x = entriesOf(data).find(y => idOf(y) === id); return x ? titleOf(x) : id; };
        const common = {
            layer, full: I.full, scroll: I.scroll, nameOfId, packs: packsOf(data),
            guide: key => openGuide(key ? PIECE_ANCHOR[key] ?? key : null),
            setFull: v => { I.full = v; render(); },
            onScroll: v => { I.scroll = v; },
            close: () => { H.insp = null; if (S.desk) canvas()?.setPicked(new Set(), true); render(); },
            inspect: key => inspect(book, key),
            edit: fn => editBook(book, fn),
            desk: S.desk,
            tab: I.tab ?? 'logic',
            focusText: !!I.focusText,
            setTab: k => { I.tab = k; I.focusText = k === 'text'; I.scroll = 0; heroInspector(book, data); I.focusText = false; },
        };
        I.focusText = false;
        if (I.key.startsWith('greet:')) {
            const g = chatGreetings(data).find(x => x.key === I.key);
            if (!g) { H.insp = null; return; }
            const r = greetingRules(data, g.ref);
            const byUid = uid => entriesOf(data).find(x => x.uid === uid);
            const usedBy = r.usedBy.map(byUid).filter(Boolean);
            const gwhy = [];
            if (r.gatesFor.length || r.closesFor.length) gwhy.push('Remove its Gates for and Closes for (above).');
            if (usedBy.length) gwhy.push(`Remove the pieces in other entries that point at it: ${[...new Set(usedBy.map(titleOf))].join(', ')}.`);
            renderGreetingInspector(box, {
                ...common, g, others: others(null), takeOff: takeOffFor(book, g.title, gwhy),
                rules: { gatesFor: r.gatesFor, closesFor: r.closesFor, usedBy: r.usedBy.map(byUid).filter(Boolean).map(x => ({ title: titleOf(x), key: cardKey(x), dot: strategyColor(x) })) },
            });
            return;
        }
        const e = shown.find(x => cardKey(x) === I.key);
        if (!e) { H.insp = null; return; }
        const model = modelOf(book, data);
        const node = model.byStKey.get(`${book}.${e.uid}`);
        const lines = node ? logicLines(node, model) : [];
        const nameOf = k => model.nodes.get(k)?.label ?? (k.startsWith('@') ? model.greetings?.get(k)?.ref ? `${greetingName(model.greetings.get(k).ref.greeting)} of ${model.greetings.get(k).ref.name || model.greetings.get(k).ref.char}` : 'a greeting' : k);
        const sources = [];
        if (node?.key) {
            for (const i of node.opens.all) if (i.source && i.source !== node.key) sources.push({ name: nameOf(i.source), key: stateKeyToCard(i.source), what: i.type === 'greeting' ? 'Starts this' : 'Gates for this', family: 'open' });
            for (const cl of node.closes) if (cl.source && cl.source !== node.key && (cl.kind === 'closesFor' || cl.kind === 'switch')) sources.push({ name: nameOf(cl.source), key: stateKeyToCard(cl.source), what: cl.kind === 'switch' ? 'Another path of its fork' : 'Closes this', family: 'close' });
            for (const k of model.riders?.get(node.key) ?? []) sources.push({ name: nameOf(k), key: stateKeyToCard(k), what: 'Rides along with this', family: 'glue' });
        }
        // The other end of the rules this entry starts (#1, #17): a gate on another entry waits for it, or it is a
        // path of a switch. The rule lives on the other entry; the row jumps there with its editor open.
        const outgoing = [];
        let pathOf = null;
        if (node?.key) {
            const names = row => row.items.some(i => i.key === node.key);
            for (const n of model.nodes.values()) {
                if (n === node || n.book !== node.book) continue;
                const card = stateKeyToCard(n.key);
                if (n.opens.rows.some(names)) outgoing.push({ name: `Opens ${n.label}`, key: card, piece: 'gate', what: `${n.label}'s gate waits for this`, family: 'open' });
                if (n.closes.some(cl => cl.kind === 'closeGate' && names(cl.row))) outgoing.push({ name: `Closes ${n.label}`, key: card, piece: 'closeGate', what: `${n.label}'s close gate waits for this`, family: 'close' });
                if (n.masks.some(m => [...m.opens, ...m.closes].some(names))) outgoing.push({ name: `Turns on a mask of ${n.label}`, key: card, piece: 'masks', what: `A mask of ${n.label} waits for this`, family: 'mask' });
            }
            const sw = model.switches?.find(s => s.paths.includes(node.key));
            if (sw) pathOf = { name: nameOf(sw.fork), id: model.nodes.get(sw.fork)?.id, open: () => dropPiece(book, 'switch', { card: stateKeyToCard(sw.fork) }) };
        }
        const mem = canvasMemory(bookSettings(settings, book));
        renderInspector(box, {
            ...common, entry: e,
            setText: v => library.change(book, d => { d.entries[e.uid].content = v; }, { quiet: true }), config: configOf(e) ?? {}, title: isMoment(e) ? momentName(e) : titleOf(e), open: I.open, lines, sources, outgoing, pathOf,
            inspectAt: (key, piece) => inspect(book, key, piece),
            happened: isMoment(e) && H.chatState ? !!chatStatus(book)(I.key)?.happened : null,
            rename: v => library.change(book, d => { d.entries[e.uid].comment = isMoment(e) ? `Moment: ${v}` : v; }),
            deleteMoment: () => {
                const unused = model.issues.some(i => i.stKey === `${book}.${e.uid}` && /nothing uses/.test(i.message));
                if (!unused) { layer.toast('Remove its links first: other cards use this Moment.'); return; }
                H.insp = null;
                deleteEntries(book, [e.uid]);
            },
            others: others(e.uid), greetings: chatGreetings(data),
            problems: problemsOf(model, e.uid, book).map(i => i.message.replace(/^./, ch => ch.toUpperCase())),
            warnings: warningsOf(model, e.uid, book).map(i => i.message.replace(/^./, ch => ch.toUpperCase())),
            closed: closedInfo(node, e),
            setOpen: k => { I.open = k; render(); },
            openEntry: mask => openHeroTab(book, e.uid, mask ?? null),
            data: () => dataSheet(e),
            note: () => askNote(layer, library, book, e.uid, configOf(e)?.note),
            takeOff: takeOffFor(book, titleOf(e), [
                ...(lines.length ? ['Remove its own pieces (the rows above).'] : []),
                ...(sources.length ? [`Remove the pieces in other entries that point at it: ${[...new Set(sources.map(x => x.name))].join(', ')}.`] : []),
                ...(view?.m.byId(I.key)?.packs.length ? ['Take it out of its packs.'] : []),
            ]),
            showMask: name => { (mem.cards[I.key] ??= {}).layer = name; saveSettings(); render(); canvas()?.reveal?.(I.key, 0.5); },
            renamedMask: (from, to) => { if (mem.cards[I.key]?.layer === from) { mem.cards[I.key].layer = to; saveSettings(); } },
            tracker: trackerContext({ book, node, model, hooks, ctx, layer, editBook: fn => editBook(book, fn), after: () => render(), toast: t => layer.toast(t) }),
        });
    }

    /** Switches to the canvas of `book` and finds the card, placing it first when it isn't on the canvas. */
    function showOnCanvas(book, key) {
        if (S.mode !== 'hero') { leave(); S.mode = 'hero'; S.select = null; S.search = null; }
        H.book = book;
        H.active = 'canvas';
        H.panel = false;
        const data = library.peek(book);
        if (data) {
            const { m } = heroData(book, data);
            const mem = canvasMemory(bookSettings(settings, book));
            const placedByHand = Object.entries(mem.cards).filter(([, c]) => c.placed).map(([k]) => k);
            if (!canvasSet(m, buildGraph(m), placedByHand).has(key) && m.byId(key)) { mem.cards[key] = { placed: true }; saveSettings(); }
        }
        render();
        canvas()?.centerOn(key);
    }

    return { chatGreetings, inspect, inspectorFor, showOnCanvas };
}
