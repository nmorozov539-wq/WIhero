// Hero mode's Preview tab (N5, LAYOUT "Preview tab", BUILD_SPEC 15.5): where it can start from, and running the
// engine on a pretend exchange. Moved out of app.js; it reaches the app only through the context given to it.
import { el } from './dom.js';
import { explainNode } from './explain-meta.js';
import { cardKey, titleOf } from './data.js';
import { openingGreeting } from '../chat-state.js';
import { runPreview } from './preview.js';
import { renderPreviewPage } from './preview-page.js';
import { strategyColor } from './entry-page.js';

/**
 * @param {object} A The app's context: { ctx, S, H, main, layer, library, settings, scan, render, heroBook, need,
 *   loadingNote, linkable, buildBookModel, openHeroTab, showOnCanvas, inspect, chatGreetings, greetingSelection }.
 */
export function createPreview(A) {
    const { ctx, S, H, main, layer, library, settings, scan, render, heroBook, need, loadingNote, linkable, buildBookModel, openHeroTab, showOnCanvas, inspect, onCanvas, chatGreetings, greetingSelection } = A;

    /** Where Preview can start from (BUILD_SPEC 15.5): the open chat, Fresh start, and each greeting of its character. */
    function previewSeeds() {
        const c = ctx();
        const book = heroBook();
        const data = book ? library.peek(book) : null;
        const sel = book ? greetingSelection(book) : null;
        const chat = library.chatOpen() ? c.chat ?? [] : [];
        const ch = !c.groupId && c.characterId !== undefined ? c.characters?.[c.characterId] : null;
        const seeds = [];
        if (chat.length) {
            const u = chat.findLastIndex(m => m?.is_user && !m.is_system);
            const base = u < 0 ? chat : chat.slice(0, u);
            const reply = u < 0 ? null : chat.slice(u + 1).find(m => m && !m.is_user && !m.is_system);
            const name = c.groupId ? 'Group chat' : `${ch?.name ?? 'Open'} chat`;
            seeds.push({
                id: 'chat', label: `${name} · after ${base.length} message${base.length === 1 ? '' : 's'}`, sub: 'The open chat\'s latest exchange and how far its story has got',
                base, greeting: c.groupId ? null : openingGreeting(chat, ch), user: u < 0 ? '' : chat[u].mes ?? '', reply: reply?.mes ?? '',
                avatar: c.groupId ? null : ch?.avatar ?? null,
            });
        }
        // A manual no-chat edit pick is not runtime state; Fresh start compiles no greetings without a real chat.
        const freshAvatar = sel?.avatar ?? (library.chatOpen() && !c.groupId ? ch?.avatar ?? null : null);
        seeds.push({ id: 'fresh', label: 'Fresh start', sub: 'From the beginning, nothing fired yet', base: [], greeting: null, user: '', reply: '', avatar: freshAvatar });
        for (const g of (data ? chatGreetings(data, book) : [])) {
            const mes = c.substituteParams ? c.substituteParams(g.full) : g.full;
            seeds.push({
                id: `greet:${g.ref.char}:${g.ref.greeting}`, label: `Start at ${g.title}`,
                sub: [g.nickname ? g.canonical : '', String(mes).replace(/\s+/g, ' ').trim().slice(0, 80)].filter(Boolean).join(' · '),
                base: [{ is_user: false, name: g.ref.name, mes }], greeting: `@${g.ref.char}:${g.ref.greeting}`, user: '', reply: '',
                avatar: g.ref.char,
            });
        }
        return seeds;
    }

    function seedPreview(seed) {
        H.pv = { seed: seed.id, user: seed.user, reply: seed.reply, edit: null, page: null };
    }

    function renderPreviewTab() {
        main.dataset.page = 'hero:preview';
        const book = heroBook();
        if (!book) { const v = el('div', 'view'); v.append(el('div', 'empty-note', 'No books yet. Switch to Normal mode to make one.')); main.append(v); return; }
        const data = need(book);
        if (!data) { const v = el('div', 'view'); v.append(el('div', 'empty-note', loadingNote(book))); main.append(v); return; }
        const seeds = previewSeeds();
        let seed = seeds.find(x => x.id === H.pv?.seed);
        if (!seed) { seed = seeds[0]; seedPreview(seed); }
        // Engine inputs include Moments; ordinary-list visibility must not remove story logic.
        const shown = linkable(book, data);
        const entries = shown.map(e => ({ ...e, world: book }));
        const model = buildBookModel(entries, { activeAvatar: seed.avatar ?? null });
        const g = scan?.globals?.() ?? {};
        const run = runPreview({
            entries, model, base: seed.base, greeting: seed.greeting, renamed: settings.renamed ?? {},
            user: H.pv.user, reply: H.pv.reply, globals: { ...g, parseRegexFromString: scan?.parseRegexFromString },
        });
        const byStKey = new Map(shown.map(e => [`${book}.${e.uid}`, e]));
        renderPreviewPage(main, {
            run, pv: H.pv, book, seedLabel: seed.label, layer,
            info: k => {
                const e = byStKey.get(k);
                return e ? { title: titleOf(e), color: strategyColor(e), logic: !!model.byStKey.get(k), uid: e.uid } : null;
            },
            set: patch => { Object.assign(H.pv, patch); render(); },
            pickSeed: () => layer.sheet('Start from', sh => {
                for (const x of seeds) {
                    const o = layer.opt(x.label, () => { layer.close(); seedPreview(x); render(); }, { cur: x.id === seed.id, sub: x.sub });
                    explainNode(o, 'blocked.command', { title: x.label, text: 'Starts the pretend exchange from here.' });
                    sh.append(o);
                }
            }, { help: 'Preview reads the open chat\'s latest exchange and how far its story has got, or starts from the beginning.' }),
            openEntry: k => { const e = byStKey.get(k); if (e) openHeroTab(book, e.uid); },
            showOnCanvas: k => { const e = byStKey.get(k); if (e) showOnCanvas(book, cardKey(e)); },
            onCanvas: k => { const e = byStKey.get(k); return !e || onCanvas(book, cardKey(e)); },
            desk: S.desk,
            // Desktop: a highlight or a report row jumps to the card on the canvas.
            jump: k => { const e = byStKey.get(k); if (e) { showOnCanvas(book, cardKey(e)); inspect(book, cardKey(e)); } },
        });
    }

    return { previewSeeds, seedPreview, renderPreviewTab };
}
