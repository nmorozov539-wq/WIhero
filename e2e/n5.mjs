// N5's in-ST checks (ROADMAP N5, BUILD_SPEC 13): at 390px wide, the Preview tab seeded from the open chat agrees
// with what the chat really fired, and every block reason of CONCEPTS 7 shows up for the sample book: waiting on
// an entry, lock not armed, lock waiting, wait not run out, closed earlier, close gate met, closed this turn by
// another entry, wrong side, turned off, and the switch already picked. Setup: e2e/README.md.
import assert from 'node:assert/strict';
import { LOG, ev, ok, page, run, send, start, wait } from './lib.mjs';

const W = '#wihero-editor';
const BOOK = 'WIHero-Sample';
const $ = sel => page.locator(`${W} ${sel}`);
const opt = text => $(`.opt:has(.lab:text-is("${text}"))`);
const shot = name => page.screenshot({ path: `${LOG}n5-${name}.png` });

/** Titles of the entries the last reply really fired (its snapshot's round). */
const realFires = () => ev(async b => {
    const d = await SillyTavern.getContext().loadWorldInfo(b);
    const round = SillyTavern.getContext().chat.at(-1).extra.wihero.round;
    return round.filter(k => k.startsWith(`${b}.`)).map(k => d.entries[k.slice(b.length + 1)].comment).sort();
}, BOOK);
/** The report page's rows: { Fires: [[title, why]], Blocked: …, 'Would change': … }. */
async function report() {
    await $('.pfoot button').click();
    await $('.rbody').waitFor();
    const out = await page.evaluate(sel => {
        const body = document.querySelector(sel).shadowRoot.querySelector('.rbody');
        const r = { start: body.querySelector('.rstate.start')?.textContent };
        let cur = null;
        for (const n of body.children) {
            if (n.tagName === 'H3') { cur = n.textContent.replace(/ · \d+$/, ''); r[cur] = []; }
            else if (n.classList.contains('rrow')) r[cur].push([n.querySelector('b').textContent, n.querySelector('small')?.textContent ?? '']);
        }
        return r;
    }, W);
    return out;
}
const back = async () => { await page.keyboard.press('Escape'); await wait(200); };
/** Types into a slot (user or reply) and leaves it. */
async function type(side, text) {
    const slot = $(`.slot.${side}`);
    if (!await slot.locator('textarea').count()) await slot.locator('.htext').click();
    await slot.locator('textarea').fill(text);
    await $('.pvhead h2').click();
    await wait(400);
}
/** Taps a highlight and returns the sheet's first line. */
async function tap(side, phrase) {
    await $(`.slot.${side} .hlx:text-is("${phrase}")`).first().click();
    const t = await $('.sheet .why').textContent();
    await back();
    return t;
}
const blockedWhy = (r, title) => r.Blocked.find(([t]) => t.startsWith(title))?.[1];

await run(async () => {
    await start(BOOK);
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.locator('#extensions-settings-button .drawer-content.openDrawer').count()) await page.click('#extensions-settings-button .drawer-toggle');
    await ev(() => { wihero.settings.openInHero = true; });
    ok('setup: a new Seraphina chat with the sample book, at 390 × 844');

    // Two real turns: the road, then the mill (the bridge's wait is still running).
    await send('We take the road.');
    await send('The mill and a bridge. A fork, an omen, a storm.');
    await page.click('#WI-SP-button .drawer-toggle');
    await $(`.item[data-book="${BOOK}"]`).click();
    await $('.card').first().waitFor();
    await $('.tab.fixed[aria-label="Preview"]').click();
    await $('.ppage .pvhead').waitFor();
    assert.equal(await $('.tab.active').getAttribute('aria-label'), 'Preview');
    assert.equal(await $('.srcchip span').textContent(), 'Seraphina chat · after 3 messages');
    assert.equal(await $('.slot.user .htext').textContent(), 'The mill and a bridge. A fork, an omen, a storm.');
    assert.match(await $('.slot.reply .htext').textContent(), /^Mock reply/);
    assert.match(await $('.pnote').textContent(), /checked against WIHero-Sample\. Nothing is saved\./);
    await shot('chat');
    let r = await report();
    assert.deepEqual(r.Fires.map(([t]) => t).sort(), await realFires(), 'Preview fires what the chat fired');
    assert.equal(blockedWhy(r, 'Bridge'), 'Because its wait hasn\'t run out: 1 more message');
    assert.match(r.start, /Already fired: Road: leaving the village/);
    assert.ok(r['Would change'].some(([t, when]) => t.startsWith('Road: leaving the village closes for good') && when === 'From the next message'));
    await shot('report');
    await back();
    assert.ok(await $('.ppage .pvhead').count(), 'Back leaves the report page for the preview');
    ok('seeded from the open chat, Preview fires exactly what the last reply fired; the wait not run out is shown');

    // A third real turn that runs into most of the rules.
    const third = 'Back on the road with the omen. The mill wheel, left or right? A cave. The shrine. The storm passes.';
    await page.click('#WI-SP-button .drawer-toggle'); // hides WI Hero, keeping its tabs (D6)
    await send(third);
    await page.click('#WI-SP-button .drawer-toggle');
    await $('.ppage .pvhead').waitFor();
    await $('.srcchip').click();
    await opt('Seraphina chat · after 5 messages').click();
    await wait(300);
    assert.equal(await $('.slot.user .htext').textContent(), third);
    r = await report();
    assert.deepEqual(r.Fires.map(([t]) => t).sort(), await realFires(), 'Preview agrees again');
    assert.equal(blockedWhy(r, 'Road'), 'Because it was closed earlier in the chat, by Mill: arrival');
    assert.equal(blockedWhy(r, 'Omen'), 'Because it fires once, and it already fired');
    assert.equal(blockedWhy(r, 'Mill: arrival'), 'Because Mill: the secret closes it this turn, and closing beats opening');
    assert.equal(blockedWhy(r, 'Right path'), 'Because Fork (switch: left or right)\'s switch already picked Left path');
    assert.equal(blockedWhy(r, 'Cave'), 'Because its lock is armed and waiting for "red beard"');
    assert.equal(blockedWhy(r, 'Shrine'), 'Because the entry is turned off (plain entry)');
    assert.equal(blockedWhy(r, 'Storm'), 'Because its close gate is met ("storm passes" is said)');
    await back();
    assert.ok(await $('.slot.user .hlx.no:text-is("road")').count(), 'a blocked phrase is struck');
    assert.ok(await $('.slot.user .hlx.plain:text-is("shrine")').count(), 'a plain entry is dotted');
    assert.match(await tap('user', 'right'), /^"right": Right path doesn't fire, because Fork .*'s switch already picked Left path\.$/);
    await $('.slot.user .hlx:text-is("left")').first().click();
    assert.match(await $('.sheet .rstate').first().textContent(), /^It also: right path closes for good/);
    await opt('Show on canvas').click();
    await $('.card.hit, .card[data-id="id:left"]').first().waitFor();
    assert.equal(await $('.tab.active').getAttribute('aria-label'), 'Canvas');
    ok('closed earlier, Once, closed this turn, the switch, a lock waiting, turned off and close gate met; a highlight explains itself and shows its card');

    // The reply only counts from the next message (D1): a phrase there, and who triggers.
    await $('.tab.fixed[aria-label="Preview"]').click();
    await type('reply', 'A whisper. A guard with a red beard shouts.');
    assert.equal(await tap('reply', 'whisper'), '"whisper": it is in the reply, so it counts from the next message. Then Whisper (only your messages) doesn\'t fire, because only your messages trigger it, and this was in the reply.');
    assert.equal(await tap('reply', 'red beard'), '"red beard": opens the lock on Cave (lock: "red beard", after the mill)\'s gate from the next message.');
    assert.ok(await $('.slot.reply .hlx:text-is("red beard") svg').count(), 'a lock phrase has the lock icon');
    await shot('reply');
    ok('in the reply, a lock opens from the next message and a user-only entry is the wrong side');

    // Fresh start: nothing has fired.
    await $('.srcchip').click();
    await opt('Fresh start').click();
    await wait(300);
    assert.equal(await $('.slot.user .htext .ph').textContent(), 'Type what you would write');
    await type('user', 'To the mill!');
    await type('reply', 'A man with a red beard.');
    assert.equal(await tap('user', 'mill'), '"mill": Mill: arrival doesn\'t fire, because its gate is waiting for Road: leaving the village.');
    assert.match(await tap('reply', 'red beard'), /^"red beard": the lock on Cave .*'s gate isn't armed yet: it arms once Mill: arrival has fired\.$/);
    r = await report();
    assert.match(r.start, /nothing has fired or closed yet/);
    assert.ok(r.Fires.some(([t, why]) => t === 'Sky (permanent)' && /^Permanent/.test(why)));
    await back();
    assert.ok(await $('.also .achip:text-is("Sky (permanent) · permanent")').count(), 'Also active lists the permanent entry');
    await shot('fresh');
    ok('Fresh start: waiting on an entry and a lock not armed; Also active');

    // Greetings of the open character, and nothing written to the chat or the book.
    await $('.srcchip').click();
    assert.ok(await opt('Start at Greeting').count(), 'the character\'s greetings are offered');
    await opt('Start at Greeting').click();
    await wait(300);
    const before = await ev(() => JSON.stringify(SillyTavern.getContext().chat.map(m => m.extra?.wihero ?? null)));
    await type('user', 'road');
    assert.equal(await ev(() => JSON.stringify(SillyTavern.getContext().chat.map(m => m.extra?.wihero ?? null))), before, 'nothing is saved');
    await back();
    assert.equal(await $('.tab.active').getAttribute('aria-label'), 'Canvas', 'Back from Preview goes to the Canvas');
    ok('a greeting start is offered; Preview saves nothing; Back goes to the Canvas');
    await ev(() => { wihero.settings.openInHero = false; SillyTavern.getContext().saveSettingsDebounced(); });
    await wait(1500);
});
