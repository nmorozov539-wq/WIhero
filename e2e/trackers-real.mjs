// Trackers with a real model (DeepSeek's own API): does the model keep the lines up, does WI Hero read them, and what
// reaches the prompt. Not a pass/fail check: it prints a transcript of each turn for a person to read. Needs
// DEEPSEEK_KEY in the environment (it is written into the throwaway SillyTavern's secrets only) and a throwaway
// SillyTavern (e2e/README.md). Costs a few cents per run.
import fs from 'node:fs';
import { LOG, ev, page, slash, wait, browser, errors, dismissWelcome, ST_URL } from './lib.mjs';

const KEY = process.env.DEEPSEEK_KEY;
if (!KEY) { console.log('DEEPSEEK_KEY is not set'); process.exit(1); }
const BOOK = 'Real Trackers';
const MODE = process.argv[2] ?? 'own'; // own | byo
const out = [];
const log = s => { out.push(s); console.log(s); };
const values = () => ev(() => Object.fromEntries(wihero.hooks.values()));
let lastMessages = null;
page.on('request', r => {
    if (!r.url().includes('/api/backends/chat-completions/generate')) return;
    try { lastMessages = JSON.parse(r.postData()).messages; } catch { /* not JSON */ }
});

async function connect() {
    await page.goto(ST_URL);
    await dismissWelcome();
    await page.waitForFunction(() => window.wihero && SillyTavern.getContext().characters.length > 0, null, { timeout: 60000 });
    await ev(async key => {
        const { getRequestHeaders } = SillyTavern.getContext();
        await fetch('/api/secrets/write', { method: 'POST', headers: getRequestHeaders(), body: JSON.stringify({ key: 'api_key_deepseek', value: key }) });
    }, KEY);
    await page.reload();
    await dismissWelcome();
    await page.waitForFunction(() => window.wihero && SillyTavern.getContext().characters.length > 0, null, { timeout: 60000 });
    await ev(() => {
        $('#main_api').val('openai').trigger('change');
        $('#chat_completion_source').val('deepseek').trigger('change');
        $('#stream_toggle').prop('checked', false).trigger('input').trigger('change');
        $('#openai_max_tokens').val(1500).trigger('input');
        $('#api_button_openai').trigger('click');
    });
    await page.waitForFunction(() => SillyTavern.getContext().onlineStatus !== 'no_connection', null, { timeout: 30000 });
    await ev(() => { const box = document.getElementById('wihero_enabled'); if (!box.checked) box.click(); });
}

async function setBook(teach) {
    await ev(async ({ b, teach }) => {
        const { deleteWorldInfo, world_names } = await import('/scripts/world-info.js');
        if (world_names.includes(b)) await deleteWorldInfo(b);
        await wihero.library.create(b);
        await wihero.library.get(b);
        const base = { keysecondary: [], constant: true, vectorized: false, selective: true, selectiveLogic: 0, disable: false, order: 100, position: 0, probability: 100, useProbability: true, depth: 4 };
        const w = x => ({ ...x, teach });
        wihero.library.change(b, d => {
            d.entries[0] = { ...base, uid: 0, displayIndex: 0, comment: 'Gold', key: [], content: '10',
                extensions: { wihero: { id: 'gold', written: w({ describe: 'how many gold coins {{user}} carries, as a number' }) } } };
            d.entries[1] = { ...base, uid: 1, displayIndex: 1, comment: 'Location', key: [], content: 'Seraphina\'s glade',
                extensions: { wihero: { id: 'loc', written: w({ describe: 'where {{user}} is now, a few words' }) } } };
            d.entries[2] = { ...base, uid: 2, displayIndex: 2, comment: 'Quest log', key: [], content: 'No quests yet.',
                extensions: { wihero: { id: 'quests', written: w({ shape: 'block', describe: 'open quests, one per line', show: false }) } } };
        });
        await wihero.library.flush();
        wihero.library.setGlobal('WIHero-Sample', false);
        wihero.library.setGlobal(b, true);
        await wihero.hooks.loadModel();
    }, { b: BOOK, teach });
}

async function say(text) {
    const n = await ev(() => SillyTavern.getContext().chat.length);
    await page.fill('#send_textarea', text);
    await page.click('#send_but');
    await page.waitForFunction(n => SillyTavern.getContext().chat.length >= n + 2 && !document.querySelector('#send_but.displayNone'), n, { timeout: 120000 });
    await wait(800);
    const reply = await ev(() => SillyTavern.getContext().chat.at(-1).mes);
    const tail = reply.split('\n').filter(l => /\[|<\/?Quest|<\/?quest/i.test(l)).join(' | ');
    const shown = await page.locator('#chat .last_mes .mes_text').textContent();
    log(`\n> ${text}\n  reply: ${reply.length} chars, tracker lines: ${tail || '(none)'}`);
    log(`  read: ${JSON.stringify(await values())}`);
    log(`  quest block shown in chat: ${/Quest log/i.test(shown) ? 'yes' : 'no'}`);
}

try {
    await connect();
    if (MODE === 'byo') {
        // A preset's own instruction, as Author's Note, and WI Hero only reading.
        await setBook({ on: false, depth: 1 });
        await slash('/go Seraphina');
        await slash('/newchat');
        await wait(1500);
        await slash('/note-depth 1');
        await slash('/note [OOC: at the very end of every reply, write the trackers that changed, each on its own line: [Gold: number] and [Location: place]. For quests write <Quest log> then one quest per line then </Quest log>.]');
    } else {
        await setBook({ on: true, depth: 1 });
        await slash('/go Seraphina');
        await slash('/newchat');
        await wait(1500);
    }
    log(`mode: ${MODE}`);
    for (const line of [
        'I sit up and check my purse. I find 5 more gold coins I forgot about.',
        'I thank you and pay you 3 gold coins for the tea and the healing.',
        'Is there something I can do to help you in return? Give me a task.',
        'I head out of the glade and walk to the river you mentioned.',
        'At the river I find a small chest with 20 gold coins inside. I take them.',
        'I have done what you asked. That task is finished.',
    ]) await say(line);
    // What the last prompt carried: the instruction, the values, and any old lines left in the history.
    const text = (lastMessages ?? []).map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`);
    const old = text.filter(t => /^assistant:/.test(t) && /\[(Gold|Location):|<Quest log>/i.test(t)).length;
    log(`\nlast prompt: ${text.length} messages; assistant messages still carrying tracker lines: ${old}`);
    log(`instruction sent: ${text.some(t => t.includes('Story trackers.')) ? 'yes' : 'no'}`);
    fs.writeFileSync(`${LOG}real-${MODE}-prompt.txt`, text.join('\n\n'));
} catch (e) {
    log(`ABORTED: ${e.message.split('\n')[0]}`);
    await page.screenshot({ path: `${LOG}real-abort.png` }).catch(() => {});
} finally {
    fs.writeFileSync(`${LOG}real-${MODE}.txt`, out.join('\n'));
    const mine = errors.filter(e => /wihero|WI Hero/i.test(e));
    console.log(mine.length ? `WI Hero console errors:\n${mine.join('\n')}` : '\nno WI Hero console errors');
    await browser.close();
}
