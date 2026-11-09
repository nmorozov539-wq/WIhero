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
    return out === mes.trim() ? null : out;
}

/**
 * @param {{ ctx: () => object, model: () => object, active: () => boolean }} deps
 */
export function createChatHider({ ctx, model, active }) {
    /** Renders message `id` again without its hidden trackers' lines. */
    function hide(id) {
        const c = ctx();
        const m = c.chat?.[Number(id)];
        const box = document.querySelector(`#chat .mes[mesid="${Number(id)}"] .mes_text`);
        if (!m || !box || typeof c.messageFormatting !== 'function') return;
        const text = active() ? shownText(m.mes, model()) : null;
        if (text === null) {
            // Hidden before and not now (shown again, or WI Hero off): the message as ST renders it.
            if (box.dataset.wiheroHidden) { delete box.dataset.wiheroHidden; box.innerHTML = c.messageFormatting(m.mes, m.name, m.is_system, m.is_user, Number(id)); }
            return;
        }
        box.dataset.wiheroHidden = '1';
        box.innerHTML = c.messageFormatting(text, m.name, m.is_system, m.is_user, Number(id));
    }
    /** Every message on screen: after a chat opens, a book changes, or WI Hero is switched on. */
    function all() {
        for (const node of document.querySelectorAll('#chat .mes[mesid]')) hide(node.getAttribute('mesid'));
    }
    return { hide, all };
}
