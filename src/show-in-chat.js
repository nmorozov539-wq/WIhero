// Show in chat (TRACKERS 4): a tracker set not to show has its lines taken out of the chat on screen. Display only:
// the message keeps them, so they are still read, and they show again while WI Hero is off.

/**
 * The text of a message as shown, with hidden trackers' lines taken out; null when nothing is hidden in it.
 * @param {string} mes
 * @param {object} model buildModel's result
 */
export function shownText(mes, model) {
    if (!mes || !model?.trackers?.size) return null;
    let out = mes;
    for (const t of model.trackers.values()) {
        if (!t.reader) continue;
        const hidden = new Set(t.slots.filter(s => !s.bad && !s.show).map(s => s.key));
        if (hidden.size) out = t.reader.stripOnly(out, hidden);
    }
    return out === mes ? null : out;
}

/**
 * The last render of each message box. The key holds the message text, whether WI Hero is on, the model (by
 * identity), the message's author fields and the text that was rendered; all of it must match to skip a write.
 */
export function createRenderMemo() {
    let memos = new WeakMap();
    return {
        same(box, key) {
            const m = memos.get(box);
            return !!m && m.mes === key.mes && m.active === key.active && m.model === key.model
                && m.name === key.name && m.is_system === key.is_system && m.is_user === key.is_user && m.out === key.out;
        },
        set(box, key) { memos.set(box, { ...key }); },
        /** Drops every box: after a chat change, or when ST's formatting may have changed. */
        clear() { memos = new WeakMap(); },
    };
}

/** Coalesces ids added in the same task into one flush. */
export function createQueue(flush) {
    const pending = new Set();
    let timer = null;
    return {
        add(id) {
            pending.add(Number(id));
            if (timer !== null) return;
            timer = setTimeout(() => {
                timer = null;
                const ids = [...pending];
                pending.clear();
                flush(ids);
            }, 0);
        },
        clear() {
            if (timer !== null) clearTimeout(timer);
            timer = null;
            pending.clear();
        },
    };
}

/**
 * @param {{ ctx: () => object, model: () => object, active: () => boolean }} deps
 */
export function createChatHider({ ctx, model, active }) {
    const memo = createRenderMemo();
    function render(id, m, on) {
        const c = ctx();
        const msg = c.chat?.[id];
        const box = document.querySelector(`#chat .mes[mesid="${id}"] .mes_text`);
        if (!msg || !box || typeof c.messageFormatting !== 'function') return;
        const out = on ? shownText(msg.mes, m) : null;
        const key = { mes: msg.mes, active: on, model: m, name: msg.name, is_system: msg.is_system, is_user: msg.is_user, out };
        if (memo.same(box, key)) return;
        if (out === null) {
            // Hidden before and not now (shown again, or WI Hero off): the message as ST renders it.
            if (box.dataset.wiheroHidden) {
                delete box.dataset.wiheroHidden;
                box.innerHTML = c.messageFormatting(msg.mes, msg.name, msg.is_system, msg.is_user, id);
            }
            memo.set(box, key);
            return;
        }
        box.dataset.wiheroHidden = '1';
        box.innerHTML = c.messageFormatting(out, msg.name, msg.is_system, msg.is_user, id);
        memo.set(box, key);
    }
    /** Renders message `id` again without its hidden trackers' lines. */
    function hide(id) {
        render(Number(id), model(), active());
    }
    /** Every message on screen: after a chat opens, a book changes, or WI Hero is switched on. */
    function all() {
        const m = model();
        const on = active();
        for (const node of document.querySelectorAll('#chat .mes[mesid]')) render(Number(node.getAttribute('mesid')), m, on);
    }
    return { hide, all, clear: () => memo.clear() };
}
