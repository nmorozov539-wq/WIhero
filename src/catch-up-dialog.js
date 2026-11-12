// A catch-up decision belongs to the chat that offered it, across both model loading and popup awaits.
export function createCatchUpDialog({ ctx, hooks, refresh, fixGap }) {
    const asked = new Set();
    let epoch = 0, timer = null, open = null;
    const owner = () => {
        const c = ctx();
        return JSON.stringify([c.groupId, c.characterId, c.getCurrentChatId?.() ?? c.chatId]);
    };
    async function offer() {
        const at = epoch, chat = owner();
        const current = () => at === epoch && chat === owner() && hooks.active();
        if (!current()) return;
        try { await hooks.loadModel(); } catch { return; }
        if (!current()) return;
        const g = hooks.gap();
        refresh();
        if (!g) return;
        const sig = `${chat}|${g.skipped.join(',')}`;
        if (asked.has(sig)) return;
        asked.add(sig);
        const n = g.skipped.length;
        const text = `<h3>WI Hero was off for ${n} ${n === 1 ? 'reply' : 'replies'}</h3>`
            + `<p>Its story state is from ${g.from < 0 ? 'the start of this chat' : `message #${g.from}`}, so gates the story has passed may still be shut.</p>`
            + '<p><b>Catch up</b> replays the skipped replies one by one, oldest first, matching key words as Preview does. '
            + '<b>Keep as is</b> carries the old state on. <b>Start from here</b> starts the story state again.</p>';
        const c = ctx(), { POPUP_TYPE, POPUP_RESULT } = c;
        const popup = new c.Popup(text, POPUP_TYPE.TEXT, '', {
            okButton: 'Catch up', cancelButton: 'Not now',
            customButtons: [{ text: 'Keep as is', result: POPUP_RESULT.CUSTOM1 }, { text: 'Start from here', result: POPUP_RESULT.CUSTOM2 }],
        });
        open = { popup, cancelled: POPUP_RESULT.CANCELLED };
        let result;
        try { result = await popup.show(); } finally {
            if (open?.popup === popup) open = null;
            if (!current()) asked.delete(sig);
        }
        if (!current()) return;
        const how = { [POPUP_RESULT.AFFIRMATIVE]: 'catchUp', [POPUP_RESULT.CUSTOM1]: 'keep', [POPUP_RESULT.CUSTOM2]: 'fresh' }[result];
        if (how) await fixGap(how, current);
    }
    function chatChanged() {
        epoch++;
        clearTimeout(timer);
        if (open) { void open.popup.complete(open.cancelled); open = null; }
        timer = setTimeout(() => { void offer(); }, 300);
    }
    return { offer, chatChanged };
}
