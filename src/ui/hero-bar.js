// Hero mode's piece bar wiring (LAYOUT "Piece bar"): the bar's view of the book, edits checked on a copy before
// they reach the book, taps on the canvas seen by the bar first, new entries and Moments, and the place picker.
// The bar itself is piecebar.js. Moved out of app.js; it reaches the app only through the context given to it.
import {
    PARAM_LIST, addEntry, addMoment, bookSettings, cardKey, entriesOf, idOf, rekeyEntry, setParam, sortEntries, titleOf,
} from './data.js';
import { PIECE_ANCHOR } from './guide.js';
import { PORT } from './canvas-graph.js';
import { addLink } from './links.js';
import { bookEditor, greetingName, packsOf } from './pieces.js';
import { canvasMemory } from './canvas.js';
import { editExisting, startPiece } from './piecebar.js';
import { el } from './dom.js';
import { isMoment } from '../engine/model.js';
import { strategyColor } from './entry-page.js';

/**
 * @param {object} A The app's context (destructured below): its state, the library and the app functions the bar
 *   calls.
 *   canvas() reads the app's current canvas.
 */
export function createHeroBar(A) {
    const {
        H, S, chatGreetings, entryFolder, inspect, layer, library, linkable, main, modelOf, openGuide, openHeroTab,
        render, root, saveSettings, settings, sortBy, tidyNow, canvas,
    } = A;

    /** A card key as the bar sees it: an entry by uid, a pack, or a greeting. */
    function nodeOf(book, key) {
        const data = library.peek(book);
        if (!data || !key) return null;
        if (key.startsWith('pack:')) return { t: 'pack', name: key.slice(5) };
        if (key.startsWith('greet:')) { const g = chatGreetings(data).find(x => x.key === key); return g ? { t: 'greet', ref: g.ref } : null; }
        const e = entriesOf(data).find(x => cardKey(x) === key);
        return e ? { t: 'entry', uid: e.uid, ...(isMoment(e) ? { moment: true } : {}) } : null;
    }

    /**
     * Runs a bar edit: first on a copy, and only when it adds no new problem (a loop, a self-link, a broken
     * switch) on the book itself. A refused edit says why on the strip.
     */
    function barAct(book, fn, quiet = false) {
        const data = library.peek(book);
        if (!data) return false;
        const issues = d => new Map(modelOf(book, d).issues.filter(i => !i.warning && i.blocking !== false).map(i => [`${i.stKey}|${i.message}`, i]));
        const before = issues(data);
        const trial = structuredClone(data);
        let why = null;
        try {
            fn(bookEditor(trial), trial);
            const fresh = [...issues(trial)].filter(([k]) => !before.has(k)).map(([, i]) => i);
            if (fresh.length) {
                const uid = Number(String(fresh[0].stKey ?? '').slice(book.length + 1));
                const who = trial.entries[uid] ? titleOf(trial.entries[uid]) : 'An entry';
                why = `Not done: ${who} ${fresh[0].message}.`;
            }
        } catch (err) { why = err.message; }
        if (why) {
            if (H.bar.edit) { H.bar.edit.note = why; H.bar.edit.noteBad = true; if (!quiet) render(); } else layer.toast(why);
            return false;
        }
        let created = [];
        library.change(book, d => { const ed = bookEditor(d); fn(ed, d); created = ed.created; }, { quiet: true });
        for (const [uid, id] of created) rekeyEntry(settings, book, uid, id);
        if (created.length) saveSettings();
        if (H.bar.edit) { H.bar.edit.note = H.bar.edit.noteBad ? null : H.bar.edit.note; H.bar.edit.noteBad = false; }
        if (!quiet) render();
        return true;
    }

    function barApi(book) {
        const data = () => library.peek(book);
        const nameOfId = id => { const x = entriesOf(data()).find(y => idOf(y) === id); return x ? titleOf(x) : id; };
        return {
            B: H.bar, main, root, canvas: canvas(), layer, desk: S.desk,
            data, editor: () => bookEditor(data()),
            act: (fn, { quiet = false } = {}) => barAct(book, fn, quiet),
            snapshot: () => ({ book, entries: structuredClone(data().entries), original: data().originalData === undefined ? undefined : structuredClone(data().originalData), settings: structuredClone(bookSettings(settings, book)) }),
            restore: snap => {
                library.change(book, d => { d.entries = structuredClone(snap.entries); if (snap.original !== undefined) d.originalData = structuredClone(snap.original); }, { quiet: true });
                settings.books[book] = structuredClone(snap.settings);
                saveSettings();
            },
            render: () => render(),
            nodeOf: key => nodeOf(book, key),
            keyOf: end => (end?.t === 'pack' ? `pack:${end.name}` : end?.t === 'greet' ? `greet:${end.ref.char}:${end.ref.greeting}` : data().entries[end?.uid] ? cardKey(data().entries[end.uid]) : null),
            nameOf: end => (end?.t === 'pack' ? `#${end.name}` : end?.t === 'greet' ? greetingName(end.ref.greeting) : data().entries[end?.uid] ? titleOf(data().entries[end.uid]) : '?'),
            nameOfId,
            candidates: () => {
                const d = data();
                const out = sortEntries(linkable(book, d), sortBy()).map(e => ({ key: cardKey(e), end: { t: 'entry', uid: e.uid }, title: titleOf(e) }));
                for (const p of packsOf(d)) out.push({ key: `pack:${p}`, end: { t: 'pack', name: p }, title: `#${p}` });
                for (const g of chatGreetings(d)) out.push({ key: g.key, end: { t: 'greet', ref: g.ref }, title: `${g.title}: ${g.text.slice(0, 30)}` });
                return out;
            },
            packs: () => packsOf(data()),
            closersOf: uid => {
                const model = modelOf(book, data());
                const node = model.byStKey.get(`${book}.${uid}`);
                return [...new Set((node?.closes ?? []).map(cl => (cl.kind === 'once' ? 'Once' : model.nodes.get(cl.source)?.label ?? 'a greeting')))];
            },
            contentOf: uid => data().entries[uid]?.content,
            openMask: (uid, name) => openHeroTab(book, uid, name),
            showMask: (uid, name, from = null) => {
                const e = data().entries[uid];
                if (!e) return;
                const mem = canvasMemory(bookSettings(settings, book));
                const key = cardKey(e);
                if (from && mem.cards[key]?.layer !== from) return;
                (mem.cards[key] ??= {}).layer = name;
                saveSettings();
            },
            folded: () => !!settings.pieceBarFolded,
            setFolded: v => { settings.pieceBarFolded = v; saveSettings(); },
            toast: t => layer.toast(t),
            place: (k, hit) => dropPiece(book, k, hit),
            entryTemplate: deps.entryTemplate,
            guide: piece => openGuide(PIECE_ANCHOR[piece] ?? 'strip'),
            makeMoment: made => {
                const mem = canvasMemory(bookSettings(settings, book));
                const key = cardKey(made);
                mem.cards[key] = { ...(mem.cards[key] ?? {}), placed: true };
                saveSettings();
            },
        };
    }

    function dropPiece(book, k, hit) {
        if (k === 'moment') { newMoment(book, hit?.card ? nodeOf(book, hit.card) : null); return; }
        const r = startPiece(k, hit, barApi(book));
        if (r.why) { render(); layer.toast(r.why); return; }
        openStrip(book, r.edit);
    }

    /** Opens a piece's strip: the inspector and the panel make way for it. */
    function openStrip(book, edit) {
        H.bar.edit = { ...edit, book };
        H.bar.armed = null;
        H.insp = null;
        H.panel = false;
        render();
    }

    /** A tap on the canvas, seen by the bar first: an armed chip lands, a loose end is picked, a line opens its strip. */
    function barTap(book, hit) {
        const B = H.bar;
        const x = barApi(book);
        if (B.edit) {
            if (hit?.card && B.loosePick) { const end = nodeOf(book, hit.card); if (end && B.loosePick(end)) return true; }
            return !!hit;
        }
        if (B.armed) {
            const k = B.armed;
            B.armed = null;
            if (k === 'moment') { newMoment(book, hit?.card ? nodeOf(book, hit.card) : null); return true; }
            if (!hit) { render(); return false; }
            dropPiece(book, k, hit);
            return true;
        }
        if (S.desk && hit?.cond) { inspect(book, hit.cond.key, PORT[hit.cond.port]?.piece ?? null); return true; }
        if (hit?.link || hit?.cond) {
            const edit = editExisting(hit, x);
            if (edit) { openStrip(book, edit); return true; }
        }
        if (hit?.row) { inspect(book, hit.row.key, PORT[hit.row.port].piece); return true; }
        return false;
    }

    /**
     * A new Moment (CONCEPTS 3.13), from the piece bar: asks its name, places it on the canvas and opens its inspector
     * for the phrases. Dropped on an entry, it asks whether the Moment opens or closes it, and links them.
     */
    function newMoment(book, on = null) {
        if (on && (on.t !== 'entry' || on.moment)) { render(); layer.toast('A Moment reacts on an entry: it opens or closes it.'); return; }
        const data = library.peek(book);
        const target = on ? data?.entries[on.uid] : null;
        layer.askText({
            title: 'New Moment', placeholder: 'What happens: Missing tooth', ok: 'Make',
            help: 'Something that can happen in the story, said in the chat. You add the phrases next.',
            done: name => {
                const made = library.change(book, d => addMoment(d, deps.entryTemplate, name.trim() || 'Moment'));
                if (!made) return;
                const key = cardKey(made);
                const mem = canvasMemory(bookSettings(settings, book));
                mem.cards[key] = { ...(mem.cards[key] ?? {}), placed: true };
                saveSettings();
                const finish = () => { render(); inspect(book, key); };
                if (!target) { finish(); return; }
                layer.sheet(`When ${name.trim()} happens, ${titleOf(target)}…`, sh => {
                    for (const [kind, label] of [['open', 'opens'], ['close', 'closes']]) {
                        sh.append(layer.opt(label, () => {
                            layer.close();
                            barAct(book, (ed, d) => addLink(ed, d, kind, { t: 'entry', uid: made.uid, moment: true }, { t: 'entry', uid: target.uid }, { join: 'and' }));
                            finish();
                        }));
                    }
                });
            },
        });
    }

    /** A new entry in a book, with the book's defaults for new entries. */
    function createEntry(book, name) {
        const defaults = { ...(bookSettings(settings, book).defaults ?? {}) };
        const by = defaults.by;
        delete defaults.by;
        return library.change(book, d => {
            const n = addEntry(d, deps.entryTemplate, defaults);
            n.comment = name;
            if (by) setParam(d, n.uid, PARAM_LIST.find(z => z.field === 'by'), by);
            return n;
        });
    }

    /** A long press on the canvas: pick an entry not on it yet, and it is placed there (or make a new one there). */
    function placePicker(book, data, at) {
        const on = canvas()?.view?.ids ?? new Set();
        const place = (key, title) => {
            const mem = canvasMemory(bookSettings(settings, book));
            mem.cards[key] = { ...(mem.cards[key] ?? {}), placed: true, ...(at ?? {}) };
            delete mem.cards[key].ports;
            saveSettings();
            render();
            layer.toast(`${title} placed`);
        };
        layer.sheet(S.desk ? 'Add to canvas here' : 'Place here', sh => {
            const q = el('input', 'pick-q');
            q.placeholder = 'Search entries';
            q.setAttribute('aria-label', 'Search entries');
            const list = el('div');
            const fill = () => {
                list.replaceChildren();
                const needle = q.value.trim().toLowerCase();
                const free = sortEntries(linkable(book, data), sortBy()).filter(e => !on.has(cardKey(e)) && (!needle || titleOf(e).toLowerCase().includes(needle)));
                for (const e of free.slice(0, 60)) list.append(layer.opt(titleOf(e), () => { layer.close(); place(cardKey(e), titleOf(e)); }, { dot: strategyColor(e), sub: entryFolder(book, e) || undefined }));
                if (!free.length) list.append(el('p', 'help', needle ? 'Nothing matches.' : 'Every entry is on the canvas already.'));
            };
            q.addEventListener('input', fill);
            sh.append(q, layer.opt('New entry here', () => layer.askText({
                title: 'New entry', placeholder: 'Entry name', ok: 'Create',
                done: name => { const x = createEntry(book, name); place(cardKey(x), name); },
            }), { icon: 'plus' }), list);
            if (S.desk) {
                list.classList.add('plimit');
                sh.append(layer.opt('Fit', () => { layer.close(); canvas()?.fit(); }, { icon: 'fit', val: 'F' }));
                sh.append(layer.opt('Tidy layout', () => { layer.close(); tidyNow(); }, { icon: 'tidy', val: 'T' }));
            }
            fill();
            if (S.desk) setTimeout(() => q.focus(), 0);
        }, { help: S.desk ? null : 'Entries that aren\'t on the canvas yet.' });
    }

    return { barAct, barApi, barTap, createEntry, dropPiece, nodeOf, openStrip, placePicker };
}
