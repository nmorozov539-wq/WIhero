import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCatchUpDialog } from '../src/catch-up-dialog.js';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function setup(t, loadModel = async () => {}) {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let id = 'Old';
    const popups = [], decisions = [];
    class Popup {
        constructor() { this.answer = deferred(); popups.push(this); }
        show() { return this.answer.promise; }
        async complete(result) { this.answer.resolve(result); }
    }
    const context = { getCurrentChatId: () => id, characterId: 1, Popup,
        POPUP_TYPE: { TEXT: 1 }, POPUP_RESULT: { AFFIRMATIVE: 1, CANCELLED: null, CUSTOM1: 2, CUSTOM2: 3 } };
    const controller = createCatchUpDialog({ ctx: () => context,
        hooks: { active: () => true, loadModel, gap: () => ({ from: 2, skipped: [4] }) },
        refresh() {}, fixGap: async (how, current) => { if (current()) decisions.push([id, how]); } });
    return { controller, popups, decisions, switchChat: next => { id = next; controller.chatChanged(); } };
}

test('a pending model load cannot offer the previous chat after a switch', async t => {
    const loaded = deferred();
    const { controller, popups, switchChat } = setup(t, () => loaded.promise);
    const offering = controller.offer();
    switchChat('New'); loaded.resolve(); await offering;
    assert.equal(popups.length, 0);
});

test('chat switch closes an open offer and ignores its decision; the new chat can still offer', async t => {
    const { controller, popups, decisions, switchChat } = setup(t);
    const offering = controller.offer();
    await Promise.resolve();
    assert.equal(popups.length, 1);
    switchChat('New');
    await offering;
    assert.deepEqual(decisions, []);
    const next = controller.offer(); await Promise.resolve();
    await popups[1].complete(2); await next;
    assert.deepEqual(decisions, [['New', 'keep']]);
});

test('a return to the same chat still invalidates an older offer', async t => {
    const { controller, popups, decisions, switchChat } = setup(t);
    const offering = controller.offer(); await Promise.resolve();
    switchChat('Other'); switchChat('Old');
    await popups[0].complete(1); await offering;
    assert.deepEqual(decisions, []);
});
