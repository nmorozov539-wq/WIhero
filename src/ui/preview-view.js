// Hero mode's Preview tab (N5, LAYOUT "Preview tab", BUILD_SPEC 15.5): where it can start from, and running the
// engine on a pretend exchange. Moved out of app.js; it reaches the app only through the context given to it.
import { buildModel } from '../engine/model.js';
import { el } from './dom.js';
import { cardKey, titleOf } from './data.js';
import { greetingsOf, openingGreeting } from '../chat-state.js';
import { greetingName } from './pieces.js';
import { runPreview } from './preview.js';
import { renderPreviewPage } from './preview-page.js';
import { strategyColor } from './entry-page.js';

/**
 * @param {object} A The app's context: { ctx, S, H, main, layer, library, settings, scan, render, heroBook, need,
 *   loadingNote, entriesShown, buildBookModel, openHeroTab, showOnCanvas, inspect }.
 */
export function createPreview(A) {
    const { ctx, S, H, main, layer, library, settings, scan, render, heroBook, need, loadingNote, entriesShown, buildBookModel, openHeroTab, showOnCanvas, inspect } = A;

    /** Where Preview can start from (BUILD_SPEC 15.5): the open chat, Fresh start, and each greeting of its character. */
    function previewSeeds() {
        const c = ctx();
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
                base, greeting: openingGreeting(chat, ch), user: u < 0 ? '' : chat[u].mes ?? '', reply: reply?.mes ?? '',
            });
        }
        seeds.push({ id: 'fresh', label: 'Fresh start', sub: 'From the beginning, nothing fired yet', base: [], greeting: null, user: '', reply: '' });
        if (ch?.avatar && library.chatOpen()) {
            greetingsOf(ch).forEach((text, n) => {
                if (!String(text ?? '').trim()) return;
                const mes = c.substituteParams ? c.substituteParams(text) : text;
                seeds.push({
                    id: `greet:${n}`, label: `Start at ${greetingName(n)}`, sub: String(mes).replace(/\s+/g, ' ').trim().slice(0, 80),
                    base: [{ is_user: false, name: ch.name, mes }], greeting: `@${ch.avatar}:${n}`, user: '', reply: '',
                });
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
        const shown = entriesShown(book, data);
        const entries = shown.map(e => ({ ...e, world: book }));
        const model = buildBookModel(entries);
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
                for (const x of seeds) sh.append(layer.opt(x.label, () => { layer.close(); seedPreview(x); render(); }, { cur: x.id === seed.id, sub: x.sub }));
            }, { help: 'Preview reads the open chat\'s latest exchange and how far its story has got, or starts from the beginning.' }),
            openEntry: k => { const e = byStKey.get(k); if (e) openHeroTab(book, e.uid); },
            showOnCanvas: k => { const e = byStKey.get(k); if (e) showOnCanvas(book, cardKey(e)); },
            desk: S.desk,
            // Desktop: a highlight or a report row jumps to the card on the canvas.
            jump: k => { const e = byStKey.get(k); if (e) { showOnCanvas(book, cardKey(e)); inspect(book, cardKey(e)); } },
        });
    }

    return { previewSeeds, seedPreview, renderPreviewTab };
}
