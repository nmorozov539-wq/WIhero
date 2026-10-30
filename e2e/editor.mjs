// End-to-end check of the entry editor in a real SillyTavern 1.19.0 with the mock model:
// a new entry is gated through the UI, saved to disk, read back after a reload, gates in a chat, and is cleared again.
// Setup: as gating.mjs (e2e/README.md), with a fresh copy of the sample book. Env: ST_URL, MOCK_PORT, CHROMIUM, ST_WORLDS.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';

const ST_URL = process.env.ST_URL || 'http://127.0.0.1:8000';
const MOCK_URL = `http://127.0.0.1:${process.env.MOCK_PORT || 5001}/v1`;
const BOOK_FILE = `${process.env.ST_WORLDS || 'data/default-user/worlds'}/WIHero-Sample.json`;
const LOG = new URL('./log/', import.meta.url).pathname;
const SHOTS = new URL('../docs/img/', import.meta.url).pathname;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning' && /WI Hero/.test(m.text())) errors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('dialog', d => d.accept());

let step = 0;
const ok = msg => console.log(`ok ${++step} - ${msg}`);
const ev = (fn, arg) => page.evaluate(fn, arg);
const wait = ms => page.waitForTimeout(ms);
const slash = cmd => ev(c => SillyTavern.getContext().executeSlashCommandsWithOptions(c), cmd);
const prompts = () => fs.readdirSync(LOG).filter(f => f.endsWith('.json')).sort();
const lastPrompt = () => JSON.parse(fs.readFileSync(LOG + prompts().pop(), 'utf8')).body.messages.map(m => m.content).join('\n');
const onDisk = uid => JSON.parse(fs.readFileSync(BOOK_FILE, 'utf8')).entries[uid];
const status = () => ev(() => Object.fromEntries([...document.querySelectorAll('#wihero_entries tr')].slice(1)
    .map(tr => [tr.children[0].textContent, tr.children[1].textContent])));

async function send(text) {
    const before = prompts().length;
    await page.fill('#send_textarea', text);
    await page.click('#send_but');
    await page.waitForFunction(() => !document.querySelector('#send_but.displayNone')
        && SillyTavern.getContext().chat.at(-1)?.mes?.startsWith('Mock'), null, { timeout: 30000 });
    for (let i = 0; i < 100 && prompts().length <= before; i++) await wait(100);
    assert.ok(prompts().length > before, 'a prompt was sent');
    await wait(500);
}

async function start() {
    await page.goto(ST_URL);
    const welcome = page.locator('.popup:has-text("Welcome to SillyTavern") .popup-button-ok');
    await welcome.waitFor({ timeout: 15000 }).then(() => welcome.click(), () => {});
    await page.waitForFunction(() => window.wihero && SillyTavern.getContext().characters.length > 0, null, { timeout: 60000 });
    await ev(url => {
        $('#main_api').val('openai').trigger('change');
        $('#chat_completion_source').val('custom').trigger('change');
        $('#custom_api_url_text').val(url).trigger('input');
        $('#custom_model_id').val('mock').trigger('input');
        $('#stream_toggle').prop('checked', false).trigger('input').trigger('change');
        $('#api_button_openai').trigger('click');
    }, MOCK_URL);
    await page.waitForFunction(() => SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 20000 });
    await ev(() => { const box = document.getElementById('wihero_enabled'); if (!box.checked) box.click(); });
}

/** Opens the World Info drawer on the sample book. */
async function openBook() {
    if (!await page.isVisible('#world_popup_entries_list')) await page.click('#WIDrawerIcon');
    await ev(() => SillyTavern.getContext().reloadWorldInfoEditor('WIHero-Sample', true));
    await page.waitForSelector('#world_popup_entries_list .world_entry[uid="0"]', { timeout: 10000 });
}

/** Opens an entry's edit area (ST renders it on open) and returns its locator. */
async function openEntry(uid) {
    const entry = page.locator(`#world_popup_entries_list .world_entry[uid="${uid}"]`);
    await entry.waitFor({ timeout: 10000 });
    if (!await entry.locator('.world_entry_edit').count()) await entry.locator('.inline-drawer-icon').first().click();
    await entry.locator('.world_entry_edit').waitFor({ timeout: 5000 });
    return entry;
}

/** Our block in an entry, expanded. */
async function openBlock(entry) {
    const block = entry.locator('.wihero-entry');
    await block.locator('.inline-drawer-toggle').waitFor({ timeout: 5000 });
    if (!await block.locator('.inline-drawer-content').isVisible()) await block.locator('.inline-drawer-toggle').click();
    await block.locator('input[name="wihero_id"]').waitFor({ state: 'visible', timeout: 5000 });
    return block;
}

async function shot(locator, name) {
    await locator.scrollIntoViewIfNeeded();
    await wait(400);
    await locator.screenshot({ path: `${LOG}${name}` });
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.copyFileSync(`${LOG}${name}`, `${SHOTS}${name}`);
}

try {
    const book = JSON.parse(fs.readFileSync(BOOK_FILE, 'utf8'));
    assert.ok(!Object.values(book.entries).some(e => e.key?.includes('well')), 'start from a fresh copy of the sample book');
    await start();
    await slash('/world silent=true WIHero-Sample');
    ok('setup');

    // ── A new entry, gated on "road" through the UI ──
    await openBook();
    const uid = await ev(() => Math.max(...[...document.querySelectorAll('#world_popup_entries_list .world_entry')]
        .map(e => Number(e.getAttribute('uid')))) + 1);
    await page.click('#world_popup_new');
    let entry = await openEntry(uid);
    await entry.locator('textarea[name="comment"]').fill('Old Well');
    await entry.locator('textarea.keyprimarytextpole').fill('well');
    await entry.locator('textarea[name="content"]').fill('[WIH-9 An old well.]');
    await entry.locator('.wihero-entry .inline-drawer-toggle').waitFor({ timeout: 5000 });
    await shot(entry.locator('.wihero-entry'), 'editor-collapsed.png');
    let block = await openBlock(entry);
    assert.equal(await block.locator('.wihero-chip', { hasText: 'old-well' }).isVisible(), true, 'slug suggested from the title');
    await block.locator('.wihero-chip', { hasText: 'old-well' }).click();
    assert.equal(await block.locator('input[name="wihero_id"]').inputValue(), 'old-well');
    await block.locator('input[name="wihero_gates"]').fill('nowhere');
    await block.locator('.wihero-entry-issues li').first().waitFor({ timeout: 3000 });
    assert.equal(await block.locator('.wihero-entry-issues').innerText(), 'gates on "nowhere", which no entry has');
    await shot(block, 'editor-problem.png');
    ok('editor: id suggested from the title, unknown gate flagged live');

    await block.locator('input[name="wihero_gates"]').fill('');
    await block.locator('.wihero-suggestions .wihero-chip', { hasText: /^road$/ }).first().click();
    assert.equal(await block.locator('input[name="wihero_gates"]').inputValue(), 'road');
    assert.equal(await block.locator('.wihero-entry-issues li').count(), 0);
    assert.ok(await block.locator('input[name="wihero_close_gates"]').isChecked(), 'closeGates on by default');
    await block.locator('.wihero-save').click();
    for (let i = 0; i < 50 && !onDisk(uid)?.wihero; i++) await wait(100);
    const saved = onDisk(uid);
    assert.deepEqual(saved.wihero, { id: 'old-well', gates: ['road'] });
    assert.deepEqual(saved.key, ['well']);
    assert.equal(saved.content, '[WIH-9 An old well.]');
    ok('save: the book on disk has the wihero field and ST\'s own fields');

    entry = page.locator(`#world_popup_entries_list .world_entry[uid="${uid}"]`);
    await entry.locator('.wihero-entry input[name="wihero_id"]').waitFor({ state: 'visible', timeout: 6000 });
    await wait(1500);
    assert.equal((await status())['old-well'], 'waiting for road', 'panel lists the new entry');
    // An ST field edited after our save keeps our config: the editor was reloaded with it.
    await entry.locator('textarea[name="content"]').fill('[WIH-9 An old, old well.]');
    await wait(2500);
    assert.deepEqual(onDisk(uid).wihero, { id: 'old-well', gates: ['road'] });
    assert.equal(onDisk(uid).content, '[WIH-9 An old, old well.]');
    ok('after saving, the entry reopens, the panel lists it, and a later ST edit keeps the config');

    // ── Read back after a reload ──
    await page.reload();
    await start();
    await openBook();
    block = await openBlock(await openEntry(uid));
    assert.equal(await block.locator('input[name="wihero_id"]').inputValue(), 'old-well');
    assert.equal(await block.locator('input[name="wihero_gates"]').inputValue(), 'road');
    ok('reload: the form shows the saved config');

    // ── It gates in a chat ──
    await page.click('#WIDrawerIcon');
    await slash('/go Seraphina');
    await page.waitForFunction(() => SillyTavern.getContext().getCurrentChatId()?.startsWith('Seraphina'), null, { timeout: 20000 });
    await slash('/newchat');
    await page.waitForFunction(() => SillyTavern.getContext().chat.length === 1, null, { timeout: 10000 });
    await wait(1500);
    await send('We look at the well.');
    assert.ok(!lastPrompt().includes('WIH-9'), 'well waits for road');
    await send('We follow the road.');
    assert.ok(lastPrompt().includes('WIH-1'), 'road fires');
    await send('We drink from the well.');
    assert.ok(lastPrompt().includes('WIH-9'), 'well fires once road has');
    assert.ok((await ev(() => wihero.state)).closed.road, 'well closes road');
    ok('chat: the entry waits for road, fires after it, and closes it');

    // ── Remove: back to vanilla ──
    await openBook();
    block = await openBlock(await openEntry(uid));
    await block.locator('.wihero-remove').click();
    for (let i = 0; i < 50 && onDisk(uid)?.wihero; i++) await wait(100);
    assert.ok(!('wihero' in onDisk(uid)), 'wihero field removed');
    assert.deepEqual(onDisk(uid).key, ['well'], 'the entry itself stays');
    ok('remove: the wihero field is gone and the entry is vanilla again');

    assert.deepEqual(errors.filter(e => /wihero|WI Hero/i.test(e)), []);
    ok('no WI Hero errors or warnings in the console');
    console.log(`\n${step} passed`);
} catch (error) {
    console.log(`not ok ${step + 1} - ${error.message}`);
    if (prompts().length) console.log('last prompt (tail):\n' + lastPrompt().slice(-1500));
    console.log('panel:', JSON.stringify(await status().catch(() => null)));
    console.log('state:', JSON.stringify(await ev(() => wihero.state).catch(() => null)));
    await page.screenshot({ path: `${LOG}editor-failure.png` }).catch(() => {});
    process.exitCode = 1;
} finally {
    console.log('console errors:', errors.length ? `\n${errors.join('\n')}` : 'none');
    await browser.close();
}
