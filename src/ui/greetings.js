// Greeting selection and display for Hero mode. Greeting rules stay on the entries that own them; this module only
// decides which character's greetings are shown for the book on the canvas, names them, and repairs refs whose
// character or numbered greeting has gone. Runtime greeting state is never read or written here.
import { btn, el } from './dom.js';
import { greetingLabel, setGreetingName, titleOf, configOf, entriesOf } from './data.js';
import { bookEditor, greetingName } from './pieces.js';
import { greetingFingerprint, greetingsOf } from '../chat-state.js';
import { getStringHash, isObject } from '../engine/util.js';

/** A character file name without its extension, for matching an auxiliary-world link. */
const fileOf = name => String(name ?? '').replace(/\.[^/.]+$/, '');

/** Walk every greeting ref in a stored config, including masks, `gatedBy` and pack-aimed refs. */
function eachRef(config, visit) {
    const walk = x => {
        if (Array.isArray(x)) { for (const v of x) walk(v); return; }
        if (!isObject(x)) return;
        if ('greeting' in x) { visit(x); return; }
        for (const v of Object.values(x)) walk(v);
    };
    walk(config);
}

/** A greeting's display text for a card: opening words, compacted. */
const opening = text => String(text ?? '').replace(/[*_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 90);

/** A small avatar with an initial fallback, for the no-chat character picker. */
function avatarEl(ctx, avatar, name) {
    const box = el('span', 'gav');
    const initial = String(name ?? avatar ?? '?').trim().charAt(0).toUpperCase() || '?';
    let src = null;
    try { src = avatar ? ctx().getThumbnailUrl?.('avatar', avatar) : null; } catch { src = null; }
    if (src) {
        const img = el('img');
        img.src = src;
        img.alt = '';
        img.addEventListener('error', () => { img.remove(); box.textContent = initial; }, { once: true });
        box.append(img);
    } else box.textContent = initial;
    return box;
}

/**
 * @param {object} A { ctx, H, S, library, settings, saveSettings, layer, render, bookSettings, entriesOf, configOf }
 *   `bookSettings` is kept for callers that hand it in; nickname storage goes through data.js helpers.
 */
export function createGreetings(A) {
    const { ctx, H, library, settings, saveSettings, layer, render } = A;

    const characters = () => ctx().characters ?? [];

    /** The character object a greeting avatar/file names, when ST still has one. */
    function characterFor(avatar, file = null, name = null) {
        const chars = characters();
        if (avatar) {
            const byAvatar = chars.find(c => c.avatar === avatar);
            if (byAvatar) return byAvatar;
        }
        if (file) {
            const byFile = chars.find(c => fileOf(c.avatar) === file);
            if (byFile) return byFile;
        }
        if (name) {
            const byName = chars.find(c => c.name === name);
            if (byName) return byName;
        }
        return null;
    }

    /** The current fingerprint of a character's greeting n, or null when it has no such greeting. */
    function fpOf(avatar, n) {
        const ch = characterFor(avatar);
        if (!ch) return null;
        const list = greetingsOf(ch);
        return n >= 0 && n < list.length ? greetingFingerprint(list[n], getStringHash) : null;
    }

    /**
     * A manual pick belongs to one Hero book view; changing books starts the view without one. A draw for another
     * book (a menu's problem count, a background model) must not end the current view's pick.
     */
    function ensureView(book) {
        if (H.book && book !== H.book) return;
        if (H.greetView === book) return;
        H.greetView = book;
        H.greet = null;
        H.greetDismissed = null;
    }

    /** Character links that can be offered for editing: primary and auxiliary links, never a chat link. */
    function linkedCharacters(book) {
        if (!book) return [];
        const out = [];
        const seen = new Set();
        for (const link of library.links(book) ?? []) {
            if (link.kind !== 'char' && link.kind !== 'aux') continue;
            const ch = characterFor(link.avatar ?? null, link.file ?? null, link.name ?? null);
            // Deduplicate by the avatar identity, as ST does; an auxiliary link resolves its character by file name.
            const avatar = link.avatar ?? ch?.avatar ?? null;
            const key = avatar ? `a:${avatar}` : `f:${link.file ?? link.name ?? ''}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ avatar, name: link.name ?? ch?.name ?? link.file ?? avatar ?? 'Character', character: ch });
        }
        return out;
    }

    /** The character whose greetings the current Hero book view shows; a single-character chat wins everywhere. */
    function selection(book) {
        if (book) ensureView(book);
        const c = ctx();
        // A group chat has no greeting selection or greeting UI.
        if (c.groupId) { H.greet = null; H.greetDismissed = null; return null; }
        const chatOpen = !!library.chatOpen?.();
        if (chatOpen) {
            // A manual editing pick never reaches a chat, and opening one clears it.
            H.greet = null;
            H.greetDismissed = null;
            const ch = c.characterId !== undefined ? c.characters?.[c.characterId] : null;
            if (!ch?.avatar) return null;
            const links = book ? library.links(book) ?? [] : [];
            const link = links.find(l => (l.kind === 'char' || l.kind === 'aux') && (l.avatar === ch.avatar || fileOf(l.file ?? '') === fileOf(ch.avatar)));
            return { avatar: ch.avatar, name: ch.name, character: ch, source: 'chat', linked: !!link || links.some(l => l.kind === 'chat') };
        }
        const pick = H.greet;
        if (!pick || pick.book !== book || !pick.avatar) return null;
        const link = linkedCharacters(book).find(l => l.avatar === pick.avatar || l.character?.avatar === pick.avatar);
        if (!link) { H.greet = null; return null; }
        return { avatar: link.avatar ?? link.character?.avatar ?? pick.avatar, name: link.name, character: link.character, source: 'pick', linked: true };
    }

    /** The greetings of the selected/editing character that the book stores, with names and changed-text marks. */
    function chatGreetings(data, book) {
        const sel = selection(book);
        if (!sel?.character) return [];
        const avatar = sel.avatar;
        const ch = sel.character;
        const stored = new Map();
        const walk = x => {
            if (Array.isArray(x)) { x.forEach(walk); return; }
            if (!isObject(x)) return;
            if ('greeting' in x && x.char === avatar) {
                const k = x.greeting;
                if (!stored.has(k)) stored.set(k, new Set());
                stored.get(k).add(x.fp);
                return;
            }
            Object.values(x).forEach(walk);
        };
        for (const e of entriesOf(data ?? {})) walk(configOf(e));
        return greetingsOf(ch).map((text, n) => {
            const fp = greetingFingerprint(text, getStringHash);
            const nick = greetingLabel(settings, book, avatar, n, fp);
            return {
                key: `greet:${avatar}:${n}`,
                ref: { greeting: n, char: avatar, name: ch.name, fp },
                fp,
                title: nick.label,
                canonical: nick.canonical,
                nickname: nick.review ? null : nick.stored?.name ?? null,
                review: nick.review,
                text: opening(text),
                full: String(text ?? ''),
                changed: [...(stored.get(n) ?? [])].some(f => f !== fp),
                missing: false,
            };
        }).filter(g => g.full.trim());
    }

    /** The nickname and canonical label for one greeting. */
    function nickname(book, avatar, n, fp) {
        const current = fp ?? (avatar ? fpOf(avatar, n) : null);
        return greetingLabel(settings, book, avatar, n, current);
    }

    /** Saves (or clears) a nickname for one greeting. Empty or whitespace-only text clears it. */
    function setNickname(book, avatar, n, fp, name) {
        const changed = setGreetingName(settings, book, avatar, n, name, fp);
        if (changed) saveSettings();
        return changed;
    }

    /** Choose a character's greetings for this no-chat book view. */
    function openPicker(book, data, anchorEl) {
        const links = linkedCharacters(book).filter(l => l.avatar && l.character);
        layer.sheet('Choose a character', sh => {
            if (!links.length) { sh.append(el('p', 'help', 'This book is not linked to a character. Link one in the book menu first.')); return; }
            for (const link of links) {
                const row = btn('opt gopt', '', () => {
                    const target = link.avatar ?? link.character?.avatar ?? null;
                    if (!target) { layer.toast('That character is not available'); return; }
                    layer.close();
                    H.greet = { book, avatar: target };
                    H.greetDismissed = null;
                    render();
                });
                row.append(avatarEl(ctx, link.avatar, link.name), el('span', 'grow', link.name));
                row.addEventListener('pointerdown', e => e.stopPropagation());
                sh.append(row);
            }
        }, { at: anchorEl, help: 'Their greetings show on this book while you edit. Nothing is marked as fired.' });
    }

    /** The top-of-canvas greeting control: a prompt for linked characters, or the current manual pick. Null otherwise. */
    function banner(book, data) {
        if (!book || ctx().groupId || library.chatOpen?.()) return null;
        ensureView(book);
        // Only a link whose character ST can find has greetings to offer.
        const links = linkedCharacters(book).filter(l => l.avatar && l.character);
        if (!links.length) return null;
        const pick = selection(book);
        const bar = el('div', 'greetban');
        bar.setAttribute('role', 'status');
        if (pick?.source === 'pick') {
            bar.append(el('span', 'gbtext', `Greetings: ${pick.name}`));
            bar.append(el('span', 'gsep', '·'), btn('linkish', 'Change', ev => { openPicker(book, data, ev.currentTarget); }, 'Change the character'));
            bar.append(el('span', 'gsep', '·'), btn('linkish', 'Hide', () => {
                H.greet = null;
                H.greetDismissed = book;
                render();
            }, 'Hide these greetings'));
            return bar;
        }
        if (H.greetDismissed === book) return null;
        if (links.length === 1) {
            const link = links[0];
            bar.append(el('span', 'gbtext', `Use ${link.name}'s greetings while editing this book?`));
            bar.append(btn('linkish acc', 'Use greetings', () => {
                const target = link.avatar ?? link.character?.avatar ?? null;
                if (!target) { layer.toast('That character is not available'); return; }
                H.greet = { book, avatar: target };
                H.greetDismissed = null;
                render();
            }), btn('linkish', 'Dismiss', () => { H.greetDismissed = book; render(); }));
        } else {
            bar.append(el('span', 'gbtext', 'Choose a character\'s greetings while editing this book'));
            bar.append(btn('linkish acc', 'Choose', ev => openPicker(book, data, ev.currentTarget), 'Choose a character'));
        }
        return bar;
    }

    /** Every stored greeting ref whose character or numbered greeting no longer exists, grouped by char + number. */
    function unavailableGroups(book, data) {
        const groups = new Map();
        for (const e of entriesOf(data ?? {})) {
            const config = configOf(e);
            if (!config) continue;
            eachRef(config, ref => {
                const ch = characterFor(ref.char);
                const list = ch ? greetingsOf(ch) : [];
                if (ch && ref.greeting >= 0 && ref.greeting < list.length) return;
                const key = `${ref.char}\u0000${ref.greeting}`;
                let group = groups.get(key);
                if (!group) {
                    group = { char: ref.char, name: ref.name || ref.char, greeting: ref.greeting, label: greetingName(ref.greeting), entries: [] };
                    groups.set(key, group);
                }
                if (!group.entries.some(x => x.uid === e.uid)) group.entries.push({ uid: e.uid, title: titleOf(e) });
            });
        }
        return [...groups.values()];
    }

    /** Rewrites every ref for one missing character/alternate to a greeting the user picks. */
    function repoint(book, group, to) {
        let count = 0;
        library.change(book, d => {
            const ed = bookEditor(d);
            for (const e of entriesOf(d)) {
                let found = false;
                const config = configOf(e);
                if (config) eachRef(config, ref => { if (ref.char === group.char && ref.greeting === group.greeting) found = true; });
                if (!found) continue;
                ed.update(e.uid, config2 => {
                    eachRef(config2, ref => {
                        if (ref.char !== group.char || ref.greeting !== group.greeting) return;
                        ref.char = to.char;
                        ref.greeting = to.greeting;
                        ref.name = to.name;
                        ref.fp = to.fp;
                        count++;
                    });
                });
            }
        });
        if (H.insp?.key?.startsWith('greet:')) H.insp = null;
        H.pick = [];
        render();
        layer.toast(count ? `${count} greeting rule${count === 1 ? '' : 's'} repointed` : 'No greeting rules repointed');
    }

    /** Pick a character, then one of its greetings, for Repoint. */
    function repointSheet(book, group) {
        const chars = characters().filter(c => c.avatar && greetingsOf(c).some(t => String(t ?? '').trim()));
        layer.sheet('Repoint to', sh => {
            if (!chars.length) { sh.append(el('p', 'help', 'No character cards with greetings are available.')); return; }
            for (const ch of chars) {
                sh.append(layer.opt(ch.name, () => {
                    layer.close();
                    const list = greetingsOf(ch);
                    layer.sheet(`Repoint to ${ch.name}`, s2 => {
                        list.forEach((text, n) => {
                            if (!String(text ?? '').trim()) return;
                            s2.append(layer.opt(greetingName(n), () => {
                                layer.close();
                                repoint(book, group, { char: ch.avatar, name: ch.name, greeting: n, fp: greetingFingerprint(text, getStringHash) });
                            }, { icon: 'chat', sub: opening(text) }));
                        });
                    }, { help: 'Every stored rule for the old greeting is rewritten to this one.' });
                }, { icon: 'user', sub: `${greetingsOf(ch).filter(t => String(t ?? '').trim()).length} greetings` }));
            }
        }, { help: `Choose the greeting that replaces ${group.name} · ${group.label}.` });
    }

    /** The book-menu sheet for orphaned greeting rules. With `peek`, only returns the groups. */
    function unavailable(book, data, { peek = false } = {}) {
        const groups = unavailableGroups(book, data);
        if (peek) return groups;
        layer.sheet('Unavailable greeting rules', sh => {
            if (!groups.length) { sh.append(el('p', 'help', 'Every stored greeting rule points to a greeting that still exists.')); return; }
            for (const group of groups) {
                const names = group.entries.map(x => x.title).join(', ');
                sh.append(layer.opt(`${group.name} · ${group.label}`, () => repointSheet(book, group), {
                    icon: 'chat',
                    sub: `${names}${group.entries.length > 1 ? ` (${group.entries.length} entries)` : ''}`,
                    val: 'Repoint',
                }));
            }
        }, { help: 'These rules stay in the book, but they cannot run until they point at a greeting that exists. Changed greeting text is fixed with Re-pick, not here.' });
        return groups;
    }

    /** Drops a manual pick for a book view, without dismissing the linked-character prompt. */
    function clearSelection(book) {
        if (!book || H.greet?.book === book) H.greet = null;
    }

    return { selection, linkedCharacters, chatGreetings, nickname, setNickname, banner, openPicker, unavailable, clearSelection };
}
