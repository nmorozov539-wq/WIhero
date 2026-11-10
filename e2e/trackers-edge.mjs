// Trackers' edge cases in a real SillyTavern with the mock model (beside n9): each case is checked on its own and
// reported, so one finding doesn't hide the rest. Setup: e2e/README.md. Needs the mock's /next.
import assert from 'node:assert/strict';
import { LOG, ev, lastPrompt, page, send, slash, start, swipeRight, wait, browser, errors, prompts } from './lib.mjs';

const BOOK = 'Edge Trackers';
const MOCK = `http://127.0.0.1:${process.env.MOCK_PORT || 5001}`;
const next = text => fetch(`${MOCK}/next`, { method: 'POST', body: text });
const values = () => ev(() => Object.fromEntries(wihero.hooks.values()));
const K = id => `${BOOK}/${id}`;
const results = [];
async function check(name, fn) {
    try { await fn(); results.push(`ok - ${name}`); } catch (e) { results.push(`FAIL - ${name}: ${e.message.replace(/\s+/g, " ").slice(0, 300)}`); await page.screenshot({ path: `${LOG}edge-${results.length}.png` }).catch(() => {}); }
}
async function waitReply(before) {
    await page.waitForFunction(() => !document.querySelector('#send_but.displayNone'), null, { timeout: 30000 });
    for (let i = 0; i < 100 && prompts().length <= before; i++) await wait(100);
    await wait(600);
}
async function setBook(entries, teach) {
    await ev(async ({ b, entries, teach }) => {
        const { deleteWorldInfo, world_names } = await import('/scripts/world-info.js');
        if (world_names.includes(b)) await deleteWorldInfo(b);
        await wihero.library.create(b);
        await wihero.library.get(b);
        const base = { keysecondary: [], constant: false, vectorized: false, selective: true, selectiveLogic: 0, disable: false, order: 100, position: 0, probability: 100, useProbability: true, depth: 4 };
        wihero.library.change(b, d => {
            entries.forEach((x, uid) => {
                const w = x.cfg;
                const put = o => { if (o?.written) o.written.teach = teach; };
                put(w); (w.masks ?? []).forEach(put);
                d.entries[uid] = { ...base, uid, displayIndex: uid, comment: x.name, key: x.keys, content: x.content, extensions: { wihero: w } };
            });
        });
        await wihero.library.flush();
        wihero.library.setGlobal('WIHero-Sample', false);
        wihero.library.setGlobal(b, true);
        await wihero.hooks.loadModel();
    }, { b: BOOK, entries, teach });
}
const newChat = async () => {
    await slash('/newchat');
    await page.waitForFunction(() => SillyTavern.getContext().chat.length === 1, null, { timeout: 10000 });
    await wait(800);
};
const hold = { mode: 'hold' };

try {
    await start('WIHero-Sample');
    const teachOn = { on: true, depth: 1 };
    await setBook([
        { name: 'Anna · Inventory', keys: ['anna'], content: 'Anna carries nothing.', cfg: { id: 'anna-inv', glue: hold, written: { describe: 'what Anna carries' } } },
        { name: 'Bob · Inventory', keys: ['bob'], content: 'Bob carries nothing.', cfg: { id: 'bob-inv', glue: hold, written: { describe: 'what Bob carries' } } },
        { name: 'Gold', keys: ['gold'], content: 'Purse: 10 coins', cfg: { id: 'gold', glue: hold, closeGate: [[{ lock: ['purse is stolen'] }]], written: {} } },
        { name: 'Wish', keys: ['wish'], content: 'No wish yet.', cfg: { id: 'wish', by: 'user', glue: hold, written: {} } },
    ], teachOn);
    await newChat();

    await check('two characters\' inventories in one reply, no mix-up', async () => {
        await next('[Anna · Inventory: sword, rope]\n[Bob · Inventory: 3 apples]');
        await send('Anna and Bob pack their bags.');
        const v = await values();
        assert.equal(v[K('anna-inv')], 'sword, rope');
        assert.equal(v[K('bob-inv')], '3 apples');
    });
    await check('a garbled line (no colon) and a line split over two lines are ignored; the value stays', async () => {
        await next('[Anna · Inventory sword only]\n[Bob · Inventory: 2 apples\nand a pear]');
        await send('They walk.');
        const v = await values();
        assert.equal(v[K('anna-inv')], 'sword, rope');
        assert.equal(v[K('bob-inv')], '3 apples');
    });
    await check('label typed in a different case with extra spaces still reads', async () => {
        await next('[anna  ·  inventory:   sword ]');
        await send('Anna drops the rope.');
        assert.equal((await values())[K('anna-inv')], 'sword');
    });
    await check('deleting the last reply rewinds the value', async () => {
        await next('[Anna · Inventory: nothing]');
        await send('Anna drops everything.');
        assert.equal((await values())[K('anna-inv')], 'nothing');
        await slash('/del 1');
        await wait(600);
        assert.equal((await values())[K('anna-inv')], 'sword');
    });
    await check('regenerate rereads the new reply', async () => {
        await next('[Gold: 4 coins]');
        await send('I count my gold.');
        assert.equal((await values())[K('gold')], '4 coins');
        const before = prompts().length;
        await next('[Gold: 5 coins]');
        await slash('/regenerate');
        await waitReply(before);
        assert.equal((await values())[K('gold')], '5 coins');
    });
    await check('continue reads a line added at the end', async () => {
        const before = prompts().length;
        await next('[Gold: 6 coins]');
        await slash('/continue');
        await waitReply(before);
        assert.match(await ev(() => SillyTavern.getContext().chat.at(-1).mes), /\[Gold: 6 coins\]/);
        assert.equal((await values())[K('gold')], '6 coins');
    });
    await check('editing an older message changes nothing', async () => {
        await send('Nothing happens.');
        await ev(async () => {
            const c = SillyTavern.getContext();
            const id = c.chat.findLastIndex((m, i) => i < c.chat.length - 1 && !m.is_user && /\[Gold:/.test(m.mes));
            c.chat[id].mes = c.chat[id].mes.replace(/\[Gold:[^\]]*\]/, '[Gold: 999 coins]');
            await c.eventSource.emit(c.eventTypes.MESSAGE_EDITED, id);
        });
        await wait(400);
        assert.equal((await values())[K('gold')], '6 coins');
    });
    await check('hiding old messages (/hide) changes nothing', async () => {
        await slash('/hide 0-4');
        await wait(400);
        assert.equal((await values())[K('gold')], '6 coins');
        assert.equal((await values())[K('anna-inv')], 'sword');
        await slash('/unhide 0-4');
    });
    await check('a user-side tracker (Who triggers: only you) reads the user\'s line in the same reply, never the model\'s', async () => {
        await next('[Wish: a castle]');
        await send('I make a wish. [Wish: a pony]');
        let v = await values();
        assert.equal(v[K('wish')], 'a pony');
        assert.match(lastPrompt(), /a pony/, 'sent in the reply to the same message');
        await send('Again.');
        v = await values();
        assert.equal(v[K('wish')], 'a pony');
    });
    await check('a closed tracker ignores its line', async () => {
        await next('The purse is stolen!');
        await send('Watch out.');
        await send('Hm.');
        await next('[Gold: 50 coins]');
        await send('I find coins?');
        assert.equal((await values())[K('gold')], '6 coins', 'closed: not read');
        assert.doesNotMatch(lastPrompt(), /\[Gold: (6 coins|Purse)/, 'and not sent');
    });
    await check('a branch keeps the values', async () => {
        const id = await ev(() => SillyTavern.getContext().chat.length - 1);
        await slash(`/branch-create ${id}`);
        await wait(2000);
        const v = await values();
        assert.equal(v[K('anna-inv')], 'sword');
        assert.equal(v[K('wish')], 'a pony');
    });
    await check('WI Hero off: no instruction sent, lines stay in the history', async () => {
        await ev(() => { const b = document.getElementById('wihero_enabled'); if (b.checked) b.click(); });
        await send('Off now.');
        assert.doesNotMatch(lastPrompt(), /Story trackers/);
        assert.match(lastPrompt(), /\[Anna · Inventory: sword, rope\]/);
        await ev(() => { const b = document.getElementById('wihero_enabled'); if (!b.checked) b.click(); });
        // The catch-up popup for the reply WI Hero missed: Catch up replays it, trackers included.
        const catchUp = page.locator('.popup:has-text("WI Hero was off") .popup-button-ok');
        await catchUp.waitFor({ timeout: 5000 });
        await catchUp.click();
        await wait(800);
        assert.equal((await values())[K('anna-inv')], 'sword', 'caught up');
    });
    await check('bring-your-own mode: no instruction, lines kept in the history, values still read and sent', async () => {
        await setBook([
            { name: 'Gold', keys: ['gold'], content: 'Purse: 10 coins', cfg: { id: 'gold', glue: hold, written: {} } },
        ], { on: false, depth: 1 });
        await newChat();
        await next('[Gold: 8 coins]');
        await send('Gold?');
        await send('Next.');
        const p = lastPrompt();
        assert.doesNotMatch(p, /Story trackers/);
        assert.match(p, /\[Gold: 8 coins\]/, 'the preset manages its own lines');
        assert.ok(p.split('[Gold: 8 coins]').length >= 3, 'the value is sent as the entry too');
    });
    await check('a tracker in another syntax (HTML comment) reads', async () => {
        await ev(async b => {
            wihero.library.change(b, d => { d.entries[0].extensions.wihero.written.syntax = { line: '<!-- {label}={value} -->', open: '<x {label}>', close: '</x>' }; });
            await wihero.library.flush();
            await wihero.hooks.loadModel();
        }, BOOK);
        await next('<!-- Gold=11 coins -->');
        await send('Gold again.');
        assert.equal((await values())[K('gold')], '11 coins');
    });
    await check('no WI Hero console errors', async () => {
        assert.deepEqual(errors.filter(e => /wihero|WI Hero/i.test(e)), []);
    });
} catch (e) {
    results.push(`ABORTED: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `${LOG}edge-abort.png` }).catch(() => {});
} finally {
    console.log(results.join('\n'));
    if (errors.length) console.log('console errors:\n' + errors.slice(0, 10).join('\n'));
    await browser.close();
}
