// WI Hero's way into SillyTavern's books: a working copy per book, saved through ST's own path (TECHNICAL_NOTES 9),
// and the book-level actions (create, rename, duplicate, delete, export, global, links, World Info settings).
// SillyTavern is reached through `ctx()` and the `WI` module namespace passed in (live bindings of world-info.js).
import { upgradeBook } from '../book.js';
import { adoptUiFields } from './data.js';

const SAVE_DELAY = 350;
/** A failed save is tried again after this, a few times, before the book is left unsaved until its next change. */
const RETRY_DELAY = 5000;
const RETRIES = 3;

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
 * @param {(name: string, error: unknown, final: boolean, what?: 'save' | 'export') => void} [deps.onSaveError] a save
 *   (or export) of `name` failed; `final` when it won't be tried again until the book changes.
 */
export function createLibrary({ ctx, WI, powerUser, settings, saveSettings, onFirstSeen = async () => {}, onChange = () => {}, onSaveError = (name, e) => console.error('[WI Hero] Could not save', name, e) }) {
    /** name → the working copy WI Hero edits; ST's cache is updated on every save. */
    const copies = new Map();
    const timers = new Map();
    /** name → failed saves in a row. */
    const failures = new Map();
    /** Objects WI Hero handed to saveWorldInfo, to tell its own saves from other ones. */
    const ours = new WeakSet();
    const loading = new Map();
    /** Books whose As imported copy was asked for this session (onFirstSeen itself remembers it across sessions). */
    const seeded = new Set();

    const names = () => ctx().getWorldInfoNames();
    /** Goes up on every change to a working copy, so what is worked out from a book can be kept until then. */
    let version = 0;

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
        let out;
        try { out = fn(data); } finally { version++; }
        schedule(name);
        if (!quiet) onChange();
        return out;
    }

    function schedule(name, delay = SAVE_DELAY) {
        clearTimeout(timers.get(name));
        timers.set(name, setTimeout(() => save(name), delay));
    }

    async function save(name) {
        clearTimeout(timers.get(name));
        timers.delete(name);
        const data = copies.get(name);
        if (!data) return;
        const { ui } = upgradeBook(data);
        if (Object.keys(ui).length) { adoptUiFields(settings, name, data, ui); saveSettings(); }
        // When it was last edited here, for Home's tiles and list (ST keeps no date of its own).
        (settings.books[name] ??= { defaults: {}, folders: {} }).edited = Date.now();
        saveSettings();
        const copy = structuredClone(data);
        ours.add(copy);
        try {
            await ctx().saveWorldInfo(name, copy, true);
        } catch (e) {
            // Never rejects: callers (the debounce, flush on close) don't wait for it. The working copy keeps the edit.
            const n = (failures.get(name) ?? 0) + 1;
            const final = n >= RETRIES;
            failures.set(name, final ? 0 : n);
            if (!final && !timers.has(name)) schedule(name, RETRY_DELAY);
            onSaveError(name, e, final);
            return false;
        }
        failures.delete(name);
        ctx().reloadWorldInfoEditor?.(name);
        return true;
    }

    /** Saves every pending book now. Rejects when one fails (already reported), so a book action waiting on it stops. */
    async function flush() {
        const done = await Promise.all([...timers.keys()].map(save));
        if (done.includes(false)) throw Object.assign(new Error('a book could not be saved'), { reported: true });
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

    const create = (...a) => quietly(() => createNow(...a));
    // While WI Hero makes, copies, renames or deletes a book, ST refreshes its own editor's book list, and that
    // fires the dropdown's change as if the user picked a book there: `busy()` tells the listener to let it pass.
    let busyN = 0;
    let busyTill = 0;
    async function quietly(fn) {
        busyN++;
        try { return await fn(); } finally { busyN--; busyTill = Date.now() + 500; }
    }
    const busy = () => busyN > 0 || Date.now() < busyTill;

    async function createNow(name) {
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

    const duplicate = (...a) => quietly(() => duplicateNow(...a));
    async function duplicateNow(name) {
        const data = structuredClone(await get(name));
        let n = `${name} copy`;
        for (let i = 2; names().includes(n); i++) n = `${name} copy ${i}`;
        const clean = await sanitize(n);
        await ctx().saveWorldInfo(clean, data, true);
        await ctx().updateWorldInfoList();
        return clean;
    }

    const remove = (...a) => quietly(() => removeNow(...a));
    async function removeNow(name) {
        clearTimeout(timers.get(name));
        timers.delete(name);
        copies.delete(name);
        return await WI.deleteWorldInfo(name);
    }

    /**
     * Renames a book: saved under the new name, links moved (global, characters, the open chat, personas), old
     * file deleted. ST's own renameWorldInfo isn't exported and asks with popups, so this does the same quietly.
     */
    /**
     * Imports a lorebook file through ST's own import (its endpoint, and its converters for NovelAI, Agnai and Risu
     * books and NovelAI's PNG lorebooks; ST asks before overwriting a book of the same name). Returns the book's
     * name, or null when nothing was imported.
     */
    const importFile = file => quietly(async () => {
        if (typeof WI.importWorldInfo !== 'function') throw new Error('This SillyTavern has no lorebook import');
        const before = new Set(names());
        await WI.importWorldInfo(file);
        const fresh = names().find(n => !before.has(n));
        if (fresh) return fresh;
        // Overwritten under the same name (ST asked first), or not imported at all.
        const base = await sanitize(file.name.replace(/\.[^.]+$/, ''));
        if (!names().includes(base)) return null;
        copies.delete(base); // read it again from ST: its content may be new
        return base;
    });
    const rename = (...a) => quietly(() => renameNow(...a));
    async function renameNow(from, to) {
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
        let data;
        try {
            await flush();
            data = await ctx().loadWorldInfo(name);
            if (!data) throw new Error('it came back empty');
        } catch (e) {
            // Every caller starts it without waiting, so it reports here.
            if (!e?.reported) onSaveError(name, e, true, 'export');
            return false;
        }
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

    /** ST's own World Info settings (they apply to every book), read live. */
    function wiSettings() {
        return {
            depth: WI.world_info_depth, recursive: WI.world_info_recursive, maxRecursion: WI.world_info_max_recursion_steps,
            minActivations: WI.world_info_min_activations, minActivationsDepth: WI.world_info_min_activations_depth_max,
            caseSensitive: WI.world_info_case_sensitive, wholeWords: WI.world_info_match_whole_words,
            includeNames: WI.world_info_include_names, groupScoring: WI.world_info_use_group_scoring,
            budget: WI.world_info_budget, budgetCap: WI.world_info_budget_cap, overflowAlert: WI.world_info_overflow_alert,
            bookOrder: WI.world_info_character_strategy, maxContext: Number(ctx().maxContext) || null,
        };
    }
    /** Each setting's control in ST's World Info panel, and the event ST listens to on it. */
    const WI_CONTROLS = {
        depth: ['#world_info_depth', 'input'], recursive: ['#world_info_recursive', 'input', true], maxRecursion: ['#world_info_max_recursion_steps', 'input'],
        minActivations: ['#world_info_min_activations', 'input'], minActivationsDepth: ['#world_info_min_activations_depth_max', 'input'],
        caseSensitive: ['#world_info_case_sensitive', 'input', true], wholeWords: ['#world_info_match_whole_words', 'input', true],
        includeNames: ['#world_info_include_names', 'input', true], groupScoring: ['#world_info_use_group_scoring', 'change', true],
        budget: ['#world_info_budget', 'input'], budgetCap: ['#world_info_budget_cap', 'input'], overflowAlert: ['#world_info_overflow_alert', 'change', true],
        bookOrder: ['#world_info_character_strategy', 'change'],
    };
    /** Changes a setting through ST's own control, so ST saves it and keeps its rules (min activations vs. max recursion). */
    function setWiSetting(key, value) {
        const $ = globalThis.jQuery;
        const c = WI_CONTROLS[key];
        if (!$ || !c) return;
        const [sel, event, check] = c;
        if (check) $(sel).prop('checked', !!value).trigger(event);
        else $(sel).val(value).trigger(event);
    }

    const edited = name => settings.books?.[name]?.edited ?? null;

    return {
        edited, names, get, peek, seen, change, get version() { return version; }, save, flush, onWorldInfoUpdated, nameProblem, create, replace, duplicate, remove, rename, busy, importFile,
        exportBook, isGlobal, setGlobal, links, unlink, linkChat, chatOpen, chatBook, wiSettings, setWiSetting,
    };
}
