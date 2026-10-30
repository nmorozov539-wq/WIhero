// End-to-end check of gates and chains in a real SillyTavern 1.19.0 with the mock model.
// Setup: see e2e/README.md. Env: ST_URL (default http://127.0.0.1:8000), MOCK_PORT (5001), CHROMIUM.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ST_URL = process.env.ST_URL || 'http://127.0.0.1:8000';
const MOCK_URL = `http://127.0.0.1:${process.env.MOCK_PORT || 5001}/v1`;
const LOG = new URL('./log/', import.meta.url).pathname;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('dialog', d => d.accept());

let step = 0;
const ok = msg => console.log(`ok ${++step} - ${msg}`);
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = ms => page.waitForTimeout(ms);
const slash = cmd => ev(c => SillyTavern.getContext().executeSlashCommandsWithOptions(c), cmd);
const promptCount = () => fs.readdirSync(LOG).length;
function lastPrompt() {
    const file = fs.readdirSync(LOG).sort().pop();
    return JSON.parse(fs.readFileSync(LOG + file, 'utf8')).body.messages.map(m => m.content).join('\n');
}
/** Which sample entries reached the last prompt. */
const injected = () => ['WIH-0', 'WIH-1', 'WIH-2', 'WIH-3', 'WIH-4'].filter(tag => lastPrompt().includes(tag));
const state = () => ev(() => wihero.state);
const status = () => ev(() => Object.fromEntries([...document.querySelectorAll('#wihero_entries tr')].slice(1)
    .map(tr => [tr.children[0].textContent, tr.children[1].textContent])));

async function waitGenerated(before) {
    await page.waitForFunction(() => !document.querySelector('#send_but.displayNone')
        && SillyTavern.getContext().chat.at(-1)?.mes?.startsWith('Mock'), null, { timeout: 30000 });
    for (let i = 0; i < 100 && promptCount() <= before; i++) await wait(100);
    assert.ok(promptCount() > before, 'a prompt was sent');
    await wait(500);
}
async function send(text) {
    const before = promptCount();
    await page.fill('#send_textarea', text);
    await page.click('#send_but');
    await waitGenerated(before);
}
async function swipeRight() {
    const before = promptCount();
    await page.locator('#chat .last_mes .swipe_right').dispatchEvent('click');
    await waitGenerated(before);
}

async function connect() {
    await ev(url => {
        $('#main_api').val('openai').trigger('change');
        $('#chat_completion_source').val('custom').trigger('change');
        $('#custom_api_url_text').val(url).trigger('input');
        $('#custom_model_id').val('mock').trigger('input');
        $('#stream_toggle').prop('checked', false).trigger('input').trigger('change');
        $('#api_button_openai').trigger('click');
    }, MOCK_URL);
    await page.waitForFunction(() => SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 20000 });
}

try {
    // ── Setup: connect to the mock, sample lorebook as the only global book, new chat ──
    await page.goto(ST_URL);
    // Fresh data shows the first-run welcome popup, which holds back loading the characters.
    const welcome = page.locator('.popup:has-text("Welcome to SillyTavern") .popup-button-ok');
    await welcome.waitFor({ timeout: 15000 }).then(() => welcome.click(), () => {});
    await page.waitForFunction(() => window.wihero && SillyTavern.getContext().characters.length > 0, null, { timeout: 60000 });
    await connect();
    // A failed earlier run can leave the extension switched off in the saved settings.
    await ev(() => { const box = document.getElementById('wihero_enabled'); if (!box.checked) box.click(); });
    await slash('/world silent=true WIHero-Sample');
    await slash('/go Seraphina');
    await page.waitForFunction(() => SillyTavern.getContext().getCurrentChatId()?.startsWith('Seraphina'), null, { timeout: 20000 });
    await slash('/newchat');
    await page.waitForFunction(() => SillyTavern.getContext().chat.length === 1, null, { timeout: 10000 });
    await wait(1500);
    if (!await page.isVisible('#wihero_entries')) {
        await page.click('#extensions-settings-button .drawer-toggle');
        await wait(300);
        await page.click('.wihero-settings .inline-drawer-toggle');
        await wait(300);
    }
    ok('setup');

    assert.deepEqual(await status(), { road: 'open', mill: 'waiting for road', tunnel: 'waiting for mill', storm: 'open' });
    ok('story start: road open, mill and tunnel waiting');

    // ── Turn 1: "mill" is mentioned but its gate is closed ──
    await send('We stand on the road out of the village, talking about the mill.');
    assert.deepEqual(injected(), ['WIH-0', 'WIH-1']);
    assert.deepEqual((await state()).fired, { road: 1 });
    assert.deepEqual(await status(), { road: 'open', mill: 'gate open', tunnel: 'waiting for mill', storm: 'open' });
    ok('turn 1: road fires, mill is held back, mill opens for next turn');

    // ── Turn 2: mill fires and closes road ──
    await send('We reach the mill.');
    assert.ok(injected().includes('WIH-2'), 'mill injected');
    assert.ok(!injected().includes('WIH-3'), 'tunnel not injected yet');
    let s = await state();
    assert.deepEqual(s.closed, { road: true });
    assert.equal(s.fired.mill, 1);
    assert.equal((await status()).road, 'closed');
    ok('turn 2: mill fires, road closes');

    // ── Turn 3: road is mentioned again but stays closed; tunnel fires and closes mill ──
    await send('Back on the road we look at the mill wheel.');
    assert.ok(!injected().includes('WIH-1'), 'closed road not injected');
    assert.ok(injected().includes('WIH-2') && injected().includes('WIH-3'), 'mill and tunnel injected');
    s = await state();
    assert.deepEqual(s.closed, { road: true, mill: true });
    assert.equal(s.fired.tunnel, 1);
    ok('turn 3: closed road stays out, tunnel fires, mill closes');

    // ── Swipe: the new swipe gates with the state from before the reply ──
    const turn3 = s;
    await swipeRight();
    assert.ok(injected().includes('WIH-2') && injected().includes('WIH-3'), 'swipe sees the same gates');
    assert.deepEqual(await state(), turn3);
    ok('swipe: same gates as the swiped reply, same resulting state');

    // ── Delete the last reply: state rewinds to turn 2 ──
    await slash('/del 1');
    await wait(800);
    s = await state();
    assert.deepEqual(s.closed, { road: true });
    assert.equal((await status()).mill, 'gate open');
    ok('delete: state rewinds to after turn 2');

    // ── Quiet generations don't move gates ──
    const before = await state();
    const prompts = promptCount();
    await slash('/gen lock=on mill wheel');
    for (let i = 0; i < 100 && promptCount() <= prompts; i++) await wait(100);
    await wait(800);
    assert.deepEqual(await state(), before);
    ok('quiet generation leaves the state alone');

    // ── Snapshots survive a reload ──
    const chatId = await ev(() => SillyTavern.getContext().getCurrentChatId());
    await page.reload();
    await page.waitForFunction(() => window.wihero && SillyTavern.getContext().characters.length > 0, null, { timeout: 60000 });
    await page.waitForFunction(id => SillyTavern.getContext().getCurrentChatId() === id, chatId, { timeout: 20000 }).catch(async () => {
        await slash('/go Seraphina');
        await wait(1500);
    });
    await connect(); // auto-connect is off on fresh data, and Send stays hidden until connected
    assert.deepEqual(await state(), before);
    ok('reload: state is read back from the saved chat');

    // ── Turning the extension off lets ST scan everything ──
    await ev(() => { document.getElementById('wihero_enabled').click(); });
    await send('The road, the mill, the wheel.');
    assert.deepEqual(injected(), ['WIH-1', 'WIH-2', 'WIH-3']);
    await ev(() => { document.getElementById('wihero_enabled').click(); });
    ok('disabled: every entry is scanned');

    // ── Glue: the storm is held every turn from its first firing until it passes ──
    await send('A storm rolls in.');
    assert.ok(injected().includes('WIH-4'), 'storm injected');
    assert.ok(!injected().includes('WIH-1'), 'closed road stays out');
    assert.ok((await state()).glued.storm, 'storm glued');
    assert.equal((await status()).storm, 'glued');
    ok('glue: storm fires and is glued');

    await send('We wait inside.');
    assert.ok(injected().includes('WIH-4'), 'glued storm forced in without its keyword');
    assert.ok(!injected().includes('WIH-1'), 'closed road stays out');
    assert.ok((await state()).glued.storm, 'storm still glued');
    ok('glue: storm held on a turn without its keyword');

    await send('At last the storm passes.');
    assert.ok(injected().includes('WIH-4'), 'storm injected on the closing turn');
    s = await state();
    assert.equal(s.closed.storm, true);
    assert.ok(!s.glued.storm, 'glue released');
    assert.equal((await status()).storm, 'closed');
    ok('glue: close keyword releases the glue and closes the storm');

    await send('Is that another storm?');
    assert.ok(!injected().includes('WIH-4'), 'closed storm not injected');
    assert.ok(!injected().includes('WIH-1'), 'closed road stays out');
    ok('glue: closed storm stays out even when mentioned');

    assert.deepEqual(errors.filter(e => /wihero|WI Hero/i.test(e)), []);
    ok('no WI Hero errors in the console');
    console.log(`\n${step} passed`);
} catch (error) {
    console.log(`not ok ${step + 1} - ${error.message}`);
    if (fs.readdirSync(LOG).length) console.log('last prompt:\n' + lastPrompt().slice(0, 3000));
    console.log('state:', JSON.stringify(await state().catch(() => null)));
    process.exitCode = 1;
} finally {
    console.log('console errors:', errors.length ? `\n${errors.join('\n')}` : 'none');
    await browser.close();
}
