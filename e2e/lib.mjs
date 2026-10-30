// Shared setup for the e2e scripts written after gating.mjs: browser, connection to the mock, sending, prompt log.
import { chromium } from 'playwright';
import fs from 'node:fs';
import assert from 'node:assert/strict';

export const ST_URL = process.env.ST_URL || 'http://127.0.0.1:8000';
const MOCK_URL = `http://127.0.0.1:${process.env.MOCK_PORT || 5001}/v1`;
export const LOG = new URL('./log/', import.meta.url).pathname;
export const BOOK_FILE = `${process.env.ST_WORLDS || 'data/default-user/worlds'}/WIHero-Sample.json`;

export const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
export const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
export const errors = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning' && /WI Hero/.test(m.text())) errors.push(m.text().slice(0, 300)); });
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('dialog', d => d.accept());

let step = 0;
export const ok = msg => console.log(`ok ${++step} - ${msg}`);
export const ev = (fn, arg) => page.evaluate(fn, arg);
export const wait = ms => page.waitForTimeout(ms);
export const slash = cmd => ev(c => SillyTavern.getContext().executeSlashCommandsWithOptions(c), cmd);
export const prompts = () => fs.readdirSync(LOG).filter(f => f.endsWith('.json')).sort();
export const lastPrompt = () => JSON.parse(fs.readFileSync(LOG + prompts().pop(), 'utf8')).body.messages.map(m => m.content).join('\n');
/** Which of these tags reached the last prompt. */
export const injected = tags => tags.filter(tag => lastPrompt().includes(`[${tag} `));
export const state = () => ev(() => wihero.state);
export const status = () => ev(() => Object.fromEntries([...document.querySelectorAll('#wihero_entries tr')].slice(1)
    .map(tr => [tr.children[0].firstChild?.textContent ?? '', tr.children[1].firstChild?.textContent ?? ''])));
export const book = () => JSON.parse(fs.readFileSync(BOOK_FILE, 'utf8'));

async function waitGenerated(before) {
    await page.waitForFunction(() => !document.querySelector('#send_but.displayNone')
        && SillyTavern.getContext().chat.at(-1)?.mes?.startsWith('Mock'), null, { timeout: 30000 });
    for (let i = 0; i < 100 && prompts().length <= before; i++) await wait(100);
    assert.ok(prompts().length > before, 'a prompt was sent');
    await wait(500);
}
export async function send(text) {
    const before = prompts().length;
    await page.fill('#send_textarea', text);
    await page.click('#send_but');
    await waitGenerated(before);
}
export async function swipeRight() {
    const before = prompts().length;
    await page.locator('#chat .last_mes .swipe_right').dispatchEvent('click');
    await waitGenerated(before);
}

/** Loads ST, connects to the mock, turns WI Hero on, selects the sample book, opens a new chat and the panel. */
export async function start() {
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
}

/** Runs the steps, reports a failure with the last prompt and state, closes the browser. */
export async function run(steps) {
    try {
        await steps();
        assert.deepEqual(errors.filter(e => /wihero|WI Hero/i.test(e)), []);
        ok('no WI Hero errors or warnings in the console');
        console.log(`\n${step} passed`);
    } catch (error) {
        console.log(`not ok ${step + 1} - ${error.message}`);
        if (prompts().length) console.log('last prompt (tail):\n' + lastPrompt().slice(-1200));
        console.log('state:', JSON.stringify(await state().catch(() => null)));
        console.log('panel:', JSON.stringify(await status().catch(() => null)));
        await page.screenshot({ path: `${LOG}failure.png` }).catch(() => {});
        process.exitCode = 1;
    } finally {
        console.log('console errors:', errors.length ? `\n${errors.join('\n')}` : 'none');
        await browser.close();
    }
}
