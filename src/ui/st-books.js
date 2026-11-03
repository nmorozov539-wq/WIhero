// WI Hero's way into SillyTavern's books: a working copy per book, saved through ST's own path (TECHNICAL_NOTES 9),
// and the book-level actions (create, rename, duplicate, delete, export, global, links, World Info settings).
// SillyTavern is reached through `ctx()` and the `WI` module namespace passed in (live bindings of world-info.js).
import { upgradeBook } from '../book.js';
import { adoptUiFields } from './data.js';

const SAVE_DELAY = 350;

/**
 * @param {object} deps
 * @param {() => object} deps.ctx SillyTavern.getContext
 * @param {object} deps.WI the world-info.js module namespace
 * @param {object} deps.powerUser power_user
 * @param {object} deps.settings WI Hero's extension settings
 * @param {() => void} deps.saveSettings
 * @param {(name: string, data: object) => Promise<void>} [deps.onFirstSeen] called before a book is first opened or
 *   changed (As imported). Listing books (Home) doesn't count: it would upload a copy of every book at once.
 * @param {() => void} [deps.onChange]
 */
export function createLibrary({ ctx, WI, powerUser, settings, saveSettings, onFirstSeen = async () => {}, onChange = () => {} }) {
    /** name → the working copy WI Hero edits; ST's cache is updated on every save. */
    const copies = new Map();
    const timers = new Map();
    /** Objects WI Hero handed to saveWorldInfo, to tell its own saves from other ones. */
    const ours = new WeakSet();
    const loading = new Map();
    /** Books whose As imported copy was asked for this session (onFirstSeen itself remembers it across sessions). */
    const seeded = new Set();

    const names = () => ctx().getWorldInfoNames();

    async function get(name) {
        if (copies.has(name)) return copies.get(name);
        if (!loading.has(name)) {
            loading.set(name, (async () => {
                const data = await ctx().loadWorldInfo(name);
                if (!data) return null;
                data.entries ??= {};
                if (!copies.has(name)) copies.set(name, data);
                return copies.get(name);
            })().finally(() => loading.delete(name)));
        }
        return loading.get(name);
    }
    const peek = name => copies.get(name) ?? null;

    /**
     * The book is being opened or changed: keep its As imported copy first, once. The copy is taken synchronously
     * (serialized before the first await), so a change made right after doesn't reach it.
     */
    function seen(name, data = copies.get(name)) {
        if (!data || seeded.has(name)) return;
        seeded.add(name);
        onFirstSeen(name, data).catch(e => console.warn('[WI Hero] Could not keep the "As imported" copy of', name, e));
    }

    /** Changes the working copy and saves it a moment later. `quiet`: the screen already shows it (typing). */
    function change(name, fn, { quiet = false } = {}) {
        const data = copies.get(name);
        if (!data) return undefined;
        seen(name, data);
        const out = fn(data);
        schedule(name);
        if (!quiet) onChange();
        return out;
    }

    function schedule(name) {
        clearTimeout(timers.get(name));
        timers.set(name, setTimeout(() => save(name), SAVE_DELAY));
    }

    async function save(name) {
        clearTimeout(timers.get(name));
        timers.delete(name);
        const data = copies.get(name);
        if (!data) return;
        const { ui } = upgradeBook(data);
        if (Object.keys(ui).length) { adoptUiFields(settings, name, data, ui); saveSettings(); }
        const copy = structuredClone(data);
        ours.add(copy);
        await ctx().saveWorldInfo(name, copy, true);
        ctx().reloadWorldInfoEditor?.(name);
    }

    async function flush() {
        await Promise.all([...timers.keys()].map(save));
    }

    /** Another save of the book (ST's own editor, a slash command): drop the working copy so the next read is fresh. */
    function onWorldInfoUpdated(name, data) {
        if (ours.has(data) || timers.has(name)) return;
        copies.delete(name);
        onChange();
    }

    async function sanitize(name) {
        const r = await fetch('/api/files/sanitize-filename', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ fileName: name }) });
        return r.ok ? (await r.json()).fileName : name;
    }

    /** Why a new book name can't be used, or null. */
    function nameProblem(name, current = null) {
        const n = String(name ?? '').trim();
        if (!n) return 'Type a name';
        if (n === current) return null;
        if (names().some(x => x.toLowerCase() === n.toLowerCase() && x !== current)) return 'A book with that name exists';
        return null;
    }

    async function create(name) {
        const clean = await sanitize(name.trim());
        const data = { entries: {} };
        seeded.add(clean);
        await onFirstSeen(clean, data, { fresh: true });
        await ctx().saveWorldInfo(clean, data, true);
        await ctx().updateWorldInfoList();
        return clean;
    }

    /** Writes a whole new content over a book (Restore), keeping the old one for Undo. */
    async function replace(name, data) {
        const old = copies.get(name) ?? await ctx().loadWorldInfo(name);
        seen(name, old);
        copies.set(name, structuredClone(data));
        await save(name);
        onChange();
        return old;
    }

    async function duplicate(name) {
        const data = structuredClone(await get(name));
        let n = `${name} copy`;
        for (let i = 2; names().includes(n); i++) n = `${name} copy ${i}`;
        const clean = await sanitize(n);
        await ctx().saveWorldInfo(clean, data, true);
        await ctx().updateWorldInfoList();
        return clean;
    }

    async function remove(name) {
        clearTimeout(timers.get(name));
        timers.delete(name);
        copies.delete(name);
        return await WI.deleteWorldInfo(name);
    }

    /**
     * Renames a book: saved under the new name, links moved (global, characters, the open chat, personas), old
     * file deleted. ST's own renameWorldInfo isn't exported and asks with popups, so this does the same quietly.
     */
    async function rename(from, to) {
        const target = await sanitize(to.trim());
        if (target === from) return from;
        await flush();
        const data = structuredClone(await get(from));
        const wasGlobal = isGlobal(from);
        await ctx().saveWorldInfo(target, data, true);
        // Primary links first, so ST's delete doesn't unlink the open character.
        const $ = globalThis.jQuery;
        if ($ && $('#character_world').val() === from) $('#character_world').val(target);
        for (const c of ctx().characters ?? []) {
            if (c?.data?.extensions?.world !== from) continue;
            await mergeCharacter(c, { extensions: { world: target } });
        }
        await WI.deleteWorldInfo(from);
        copies.delete(from);
        for (const lore of WI.world_info.charLore ?? []) {
            if (lore.extraBooks?.includes(from)) lore.extraBooks = lore.extraBooks.map(b => (b === from ? target : b));
        }
        if (powerUser) {
            if (powerUser.persona_description_lorebook === from) powerUser.persona_description_lorebook = target;
            for (const d of Object.values(powerUser.persona_descriptions ?? {})) if (d?.lorebook === from) d.lorebook = target;
        }
        const meta = ctx().chatMetadata;
        if (meta?.[WI.METADATA_KEY] === from) { meta[WI.METADATA_KEY] = target; await ctx().saveMetadata(); }
        await ctx().updateWorldInfoList();
        if (wasGlobal) setGlobal(target, true);
        ctx().saveSettingsDebounced();
        return target;
    }

    async function mergeCharacter(c, data) {
        const r = await fetch('/api/characters/merge-attributes', { method: 'POST', headers: ctx().getRequestHeaders(), body: JSON.stringify({ avatar: c.avatar, data }) });
        if (!r.ok) throw new Error(`Couldn't update ${c.name}`);
        await ctx().getOneCharacter?.(c.avatar);
    }

    /** Downloads the same file as ST's own export (D10). */
    async function exportBook(name) {
        await flush();
        const data = await ctx().loadWorldInfo(name);
        const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${name}.json`;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    }

    // ---- global and links

    const isGlobal = name => (WI.selected_world_info ?? []).includes(name);

    // Through ST's own global list, the way its dropdown does it: the slash-command path splits names on commas and
    // matches them ignoring case, so a book called "Kingdom, North" could never be turned on.
    function setGlobal(name, on) {
        if (isGlobal(name) === on) return;
        const i = (WI.world_names ?? []).indexOf(name);
        const $ = globalThis.jQuery;
        const option = i < 0 || !$ ? null : $('#world_info').children().filter((_, o) => o.value === String(i));
        if (option?.length) {
            option.prop('selected', on);
            $('#world_info').trigger('change');
        } else WI.onWorldInfoChange({ state: on ? 'on' : 'off', silent: 'true' }, name);
    }

    const fileOf = avatar => String(avatar ?? '').replace(/\.[^/.]+$/, '');

    /**
     * Characters and chats that turn a book on. Only the open chat is known (ST keeps a chat's book in that chat).
     * @returns {{ kind: 'char' | 'aux' | 'chat', name: string, avatar?: string, file?: string }[]}
     */
    function links(name) {
        const out = [];
        const chars = ctx().characters ?? [];
        for (const c of chars) if (c?.data?.extensions?.world === name) out.push({ kind: 'char', name: c.name, avatar: c.avatar });
        for (const lore of WI.world_info?.charLore ?? []) {
            if (!lore.extraBooks?.includes(name)) continue;
            const c = chars.find(x => fileOf(x.avatar) === lore.name);
            if (!out.some(o => o.avatar && fileOf(o.avatar) === lore.name)) out.push({ kind: 'aux', name: c?.name ?? lore.name, file: lore.name });
        }
        if (ctx().chatMetadata?.[WI.METADATA_KEY] === name) out.push({ kind: 'chat', name: 'This chat' });
        return out;
    }

    async function unlink(name, link) {
        if (link.kind === 'chat') {
            delete ctx().chatMetadata[WI.METADATA_KEY];
            globalThis.jQuery?.('.chat_lorebook_button').removeClass('world_set');
            await ctx().saveMetadata();
        } else if (link.kind === 'aux') {
            const lore = (WI.world_info.charLore ?? []).find(l => l.name === link.file);
            WI.charSetAuxWorlds(link.file, (lore?.extraBooks ?? []).filter(b => b !== name));
        } else if (link.kind === 'char') {
            const c = (ctx().characters ?? []).find(x => x.avatar === link.avatar);
            if (!c) return;
            const $ = globalThis.jQuery;
            const current = ctx().characters[ctx().characterId]?.avatar === c.avatar;
            await mergeCharacter(c, { extensions: { world: '' } });
            if (current && $) { $('#character_world').val(''); WI.setWorldInfoButtonClass?.(undefined, false); }
        }
        onChange();
    }

    const chatOpen = () => !!ctx().chatId || !!ctx().getCurrentChatId?.();
    const chatBook = () => ctx().chatMetadata?.[WI.METADATA_KEY] ?? null;

    async function linkChat(name) {
        ctx().chatMetadata[WI.METADATA_KEY] = name;
        globalThis.jQuery?.('.chat_lorebook_button').addClass('world_set');
        await ctx().saveMetadata();
        onChange();
    }

    // ---- ST's World Info settings (they apply to every book), through ST's own controls so they save as usual

    function wiSettings() {
        return { budget: WI.world_info_budget, depth: WI.world_info_depth, recursive: WI.world_info_recursive };
    }
    function setWiSetting(key, value) {
        const $ = globalThis.jQuery;
        if (!$) return;
        if (key === 'recursive') $('#world_info_recursive').prop('checked', !!value).trigger('input');
        else $(`#world_info_${key}`).val(value).trigger('input');
    }

    return {
        names, get, peek, seen, change, save, flush, onWorldInfoUpdated, nameProblem, create, replace, duplicate, remove, rename,
        exportBook, isGlobal, setGlobal, links, unlink, linkChat, chatOpen, chatBook, wiSettings, setWiSetting,
    };
}
