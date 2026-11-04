// The chat bubble (BUILD_SPEC 17.3): a book in a circle over the chat with how many World Info entries reached the
// model with the last reply. Tap it for their names. It reads what WI Hero stored on the reply (src/st-hooks.js
// SENT_FIELD), so it follows swipes, deletes and branches, and works whether or not the engine runs.
import { SENT_FIELD } from './st-hooks.js';

const isReply = m => m && !m.is_user && !m.is_system;

/** The newest reply a generation wrote (a greeting before the first user message isn't one), or null. */
export function lastReply(chat) {
    chat ??= [];
    const firstUser = chat.findIndex(m => m?.is_user && !m.is_system);
    if (firstUser < 0) return null;
    for (let i = chat.length - 1; i > firstUser; i--) if (isReply(chat[i])) return chat[i];
    return null;
}

/** What the bubble shows for a chat: { count: number | null, sent: [] | null }; null count when nothing is known. */
export function bubbleData(chat) {
    const reply = lastReply(chat);
    const sent = reply?.extra?.[SENT_FIELD];
    return Array.isArray(sent) ? { count: sent.length, sent } : { count: null, sent: null };
}

const node = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
};

/**
 * @param {object} deps { ctx, settings, saveSettings, gap: () => gap | null, onFixGap: (how) => Promise }
 */
export function createBubble({ ctx, settings, saveSettings = () => {}, gap, onFixGap }) {
    const root = node('div', 'wihero-bubble-root');
    root.id = 'wihero_bubble_root';
    const button = node('div', 'wihero-bubble interactable');
    button.id = 'wihero_bubble';
    button.tabIndex = 0;
    button.setAttribute('role', 'button');
    button.title = 'World Info sent to the model with the last reply';
    const icon = node('i', 'fa-solid fa-book');
    const count = node('span', 'wihero-bubble-n');
    const dot = node('span', 'wihero-bubble-dot');
    button.append(icon, count, dot);
    const menu = node('div', 'wihero-bubble-menu');
    menu.hidden = true;
    root.append(menu, button);
    let open = false;

    const toggle = () => { open = !open; render(); };
    let dragged = false;
    button.addEventListener('click', e => { e.stopPropagation(); if (dragged) { dragged = false; return; } toggle(); });
    button.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    menu.addEventListener('click', e => e.stopPropagation());
    document.addEventListener('click', () => { if (open) { open = false; render(); } });

    const chatOpen = () => !!(ctx().chatId ?? ctx().getCurrentChatId?.());

    // Above the input, whatever its height: a hidden form (0 high) keeps the last place, and a resize moves it.
    let watched = null;
    const lift = () => {
        const form = document.getElementById('form_sheld');
        const h = form?.offsetHeight;
        if (h) base = h + 10;
        else if (base === null) base = 64;
        const up = Math.max(0, Math.min(settings.bubblePos?.up ?? 0, (root.parentElement?.clientHeight ?? 600) - base - 60));
        root.style.bottom = `${base + up}px`;
        root.classList.toggle('wihero-bubble-right', settings.bubblePos?.side === 'right');
    };
    let base = null;

    // Drag it anywhere up and down either edge; it lands on the nearer edge, and the spot is kept.
    button.addEventListener('pointerdown', e => {
        if (e.button > 0) return;
        const sheld = root.parentElement;
        if (!sheld) return;
        const y0 = e.clientY;
        const x0 = e.clientX;
        const up0 = settings.bubblePos?.up ?? 0;
        let moving = false;
        const move = ev => {
            if (!moving && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 8) return;
            if (!moving) { moving = true; button.setPointerCapture?.(e.pointerId); root.classList.add('wihero-bubble-moving'); }
            const r = sheld.getBoundingClientRect();
            settings.bubblePos = { side: ev.clientX > r.left + r.width / 2 ? 'right' : 'left', up: Math.max(0, up0 + y0 - ev.clientY) };
            lift();
        };
        const end = () => {
            button.removeEventListener('pointermove', move);
            button.removeEventListener('pointerup', end);
            button.removeEventListener('pointercancel', end);
            if (!moving) return;
            root.classList.remove('wihero-bubble-moving');
            dragged = true;
            setTimeout(() => { dragged = false; }, 300);
            saveSettings();
        };
        button.addEventListener('pointermove', move);
        button.addEventListener('pointerup', end);
        button.addEventListener('pointercancel', end);
    });
    function place() {
        const sheld = document.getElementById('sheld');
        if (!sheld) return false;
        if (root.parentElement !== sheld) sheld.append(root);
        const form = document.getElementById('form_sheld');
        if (form && watched !== form && globalThis.ResizeObserver) {
            watched = form;
            new ResizeObserver(lift).observe(form);
        }
        lift();
        return true;
    }

    function fillMenu(data, g) {
        menu.replaceChildren();
        if (g) {
            const box = node('div', 'wihero-bubble-gap');
            const n = g.skipped.length;
            box.append(node('div', '', `WI Hero was off for ${n} ${n === 1 ? 'reply' : 'replies'}. Its story state is behind the chat.`));
            const row = node('div', 'wihero-bubble-actions');
            for (const [how, label] of [['catchUp', 'Catch up'], ['keep', 'Keep as is'], ['fresh', 'Start from here']]) {
                const b = node('div', 'menu_button', label);
                b.dataset.how = how;
                b.addEventListener('click', async () => { await onFixGap(how); render(); });
                row.append(b);
            }
            box.append(row);
            menu.append(box);
        }
        const head = node('div', 'wihero-bubble-head', data.count === null ? 'World Info' : `Sent with the last reply · ${data.count}`);
        menu.append(head);
        if (data.count === null) {
            menu.append(node('div', 'wihero-bubble-empty', 'WI Hero didn\'t see the last reply being written, so it doesn\'t know what was sent.'));
            return;
        }
        if (!data.count) {
            menu.append(node('div', 'wihero-bubble-empty', 'No World Info entries were sent with the last reply.'));
            return;
        }
        const books = new Set(data.sent.map(x => x.world));
        const list = node('div', 'wihero-bubble-list');
        for (const x of data.sent) {
            const row = node('div', 'wihero-bubble-row');
            row.append(node('span', 'wihero-bubble-title', x.title));
            if (x.mask) row.append(node('span', 'wihero-bubble-mask', ` · ${x.mask}`));
            if (books.size > 1) row.append(node('small', '', x.world));
            list.append(row);
        }
        menu.append(list);
    }

    function render() {
        const show = settings.bubble !== false && chatOpen() && place();
        root.hidden = !show;
        if (!show) { open = false; return; }
        const data = bubbleData(ctx().chat);
        const g = gap();
        count.textContent = data.count === null ? '–' : String(data.count);
        root.classList.toggle('wihero-has-gap', !!g);
        button.setAttribute('aria-label', data.count === null ? 'World Info sent: unknown' : `World Info sent: ${data.count}`);
        menu.hidden = !open;
        if (open) fillMenu(data, g);
    }

    return { render, get element() { return root; } };
}
