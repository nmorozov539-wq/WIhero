// N2's in-ST checks (ROADMAP N2, BUILD_SPEC 13): at 390px wide, without ST's own editor, a book is made, filled
// and organized; a snapshot is taken and restored with Undo; problems show as badges; the color modes, Back and
// hiding work; and it reads in more than one ST theme. Setup: see e2e/README.md.
import assert from 'node:assert/strict';
import { LOG, ev, ok, page, run, wait } from './lib.mjs';

const W = '#wihero-editor';
const BOOK = 'N2 Test';
const SHELF = 'N2 Shelf';
const $ = sel => page.locator(`${W} ${sel}`);
const opt = text => $(`.opt:has(.lab:text-is("${text}"))`);
const toastText = () => $('.toast.show span').textContent();
const book = name => ev(async n => { await wihero.library.flush(); return SillyTavern.getContext().loadWorldInfo(n); }, name);
const entryBy = (data, title) => Object.values(data.entries).find(e => e.comment === title);
const visible = () => ev(() => !document.getElementById('wihero-editor').hidden);
const shot = name => page.screenshot({ path: `${LOG}n2-${name}.png` });

async function ask(value) {
    await $('.dlg input').fill(value);
    await $('.dlg .pri').click();
    await wait(300);
}
async function menu(...path) {
    await $('.tabbar .iconbtn').click();
    for (const p of path) { await opt(p).click(); await wait(200); }
}
/** Types into the open entry page: title, then key words, then content. */
async function fillEntry(title, keys, content) {
    await $('.en h1').click();
    await page.keyboard.type(title);
    await $('.en .kbox').first().click();
    await page.keyboard.type(keys);
    await page.keyboard.press('Enter');
    await $('.en textarea').fill(content);
    await wait(100);
}
const rowTitles = () => $('.view .item.ent .t .nm').allTextContents();

await run(async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(process.env.ST_URL || 'http://127.0.0.1:8000');
    const welcome = page.locator('.popup:has-text("Welcome to SillyTavern") .popup-button-ok');
    await welcome.waitFor({ timeout: 15000 }).then(() => welcome.click(), () => {});
    await page.waitForFunction(() => window.wihero?.app && SillyTavern.getContext().characters.length > 0, null, { timeout: 60000 });
    // Leftovers of an earlier run.
    await ev(async names => {
        const { deleteWorldInfo, world_names } = await import('/scripts/world-info.js');
        for (const n of names) if (world_names.includes(n)) await deleteWorldInfo(n);
        for (const n of names) delete wihero.settings.books[n];
        wihero.settings.colorMode = 'standard';
        wihero.settings.openInHero = false;
        wihero.settings.contentFont = 'serif';
    }, [BOOK, SHELF, `${SHELF} copy`]);
    ok('setup at 390 × 844');

    // ── Opening ──
    await page.click('#WI-SP-button .drawer-toggle');
    await $('.view h1:text-is("World Info")').waitFor();
    assert.ok(await visible());
    assert.ok(!await page.locator('#WorldInfo').evaluate(n => n.classList.contains('openDrawer')), 'ST\'s own drawer stays closed');
    ok('the World Info button opens WI Hero on Home, not ST\'s drawer');

    // ── Make a book ──
    await $('.bottombar button[aria-label="New book"]').click();
    await ask(BOOK);
    await $(`.bkname h1:text-is("${BOOK}")`).waitFor();
    assert.ok(await ev(n => SillyTavern.getContext().getWorldInfoNames().includes(n), BOOK));
    assert.equal(await $('.tab.active .name').textContent(), BOOK);
    ok('+ New on Home makes a book and opens it in a new tab');

    // ── Fill it ──
    await $('.bottombar button[aria-label="New entry"]').click();
    await $('.en h1').waitFor();
    await fillEntry('Road', 'road, path', 'A muddy road winds north.');
    await $('.en-top button[aria-label="Up to the book"]').click();
    await $('.bottombar button[aria-label="New entry"]').click();
    await fillEntry('Mill', 'mill', 'An old water mill.');
    await $('.en .linkish:has-text("Add condition")').click();
    await page.keyboard.type('river');
    await page.keyboard.press('Enter');
    await $('.condline .thin').click();
    await opt('But none of').click();
    await $('.disc:has(h2:text-is("Parameters"))').click();
    await $('.prm:has(span:text-is("Probability"))').click();
    await ask('40');
    assert.equal(await $('.disc:has(h2:text-is("Parameters")) .sum').textContent(), 'Probability 40%');
    await $('.en-top button[aria-label="Up to the book"]').click();
    await $('.bottombar button[aria-label="New entry"]').click();
    await fillEntry('Weather lore', 'weather', 'Storms come from the west.');
    await $('.srow .thin').click();
    await opt('Permanent').click();
    assert.equal(await $('.en .kbox').count(), 0, 'Permanent hides the key words');
    await $('.en-top button[aria-label="Up to the book"]').click();
    await $('.bottombar button[aria-label="New entry"]').click();
    await $('.en h1').waitFor();
    await $('.en-top button[aria-label="Up to the book"]').click();
    let data = await book(BOOK);
    assert.equal(Object.keys(data.entries).length, 3, 'an entry left empty is discarded');
    const road = entryBy(data, 'Road');
    assert.deepEqual([road.key, road.content], [['road', 'path'], 'A muddy road winds north.']);
    const mill = entryBy(data, 'Mill');
    assert.deepEqual([mill.keysecondary, mill.selectiveLogic, mill.probability, mill.useProbability], [['river'], 2, 40, true]);
    assert.equal(entryBy(data, 'Weather lore').constant, true);
    assert.deepEqual(await rowTitles(), ['Road', 'Mill', 'Weather lore']);
    ok('entries are written on their page: name, key words, condition, strategy, a parameter, content; an empty one is discarded');

    // ── Organize ──
    await $('.bottombar button[aria-label="Select"]').click();
    await $('.item.ent:has(.nm:text-is("Road"))').click();
    await $('.item.ent:has(.nm:text-is("Mill"))').click();
    assert.equal(await $('.selhead .cnt').textContent(), '2 selected');
    await $('.selbar button:has-text("Move")').click();
    await opt('New folder').click();
    await ask('Places');
    await $('.section button:has-text("Places · 2")').waitFor();
    assert.deepEqual(await ev(n => Object.values(wihero.settings.books[n].folders), BOOK), ['Places', 'Places']);
    await menu('Group by');
    assert.deepEqual(await $('.view .section').allTextContents(), ['Keywords · 2', 'Permanent · 1']);
    await menu('Group by');
    await menu('Group by');
    await $('.item.ent:has(.nm:text-is("Weather lore")) .switch').click();
    await wait(100);
    assert.equal((await book(BOOK)).entries[entryBy(data, 'Weather lore').uid].disable, true);
    await menu('Show disabled entries');
    assert.deepEqual(await rowTitles(), ['Road', 'Mill']);
    await menu('Show disabled entries');
    ok('selection moves entries into a new folder; group by strategy; the row switch turns an entry off; off entries can be hidden');

    // Duplicate, delete with Undo.
    await $('.item.ent:has(.nm:text-is("Road")) .more').click();
    await opt('Duplicate').click();
    await $('.item.ent:has(.nm:text-is("Road copy"))').waitFor();
    await $('.item.ent:has(.nm:text-is("Road copy")) .more').click();
    await opt('Delete').click();
    assert.equal(await toastText(), 'Deleted Road copy');
    await $('.toast button:text-is("Undo")').click();
    await $('.item.ent:has(.nm:text-is("Road copy"))').waitFor();
    await $('.item.ent:has(.nm:text-is("Road copy")) .more').click();
    await opt('Delete').click();
    assert.ok(entryBy(await book(BOOK), 'Road copy'), 'the delete waits for the toast');
    await wait(5600);
    assert.equal(entryBy(await book(BOOK), 'Road copy'), undefined);
    ok('Duplicate, and Delete with an Undo toast: undone, then done once the toast is gone');

    // ── Search ──
    await $('.bottombar button[aria-label="Search"]').click();
    await $('.search input').fill('mill');
    await $('.search .item:has-text("Mill")').first().click();
    await $('.en h1:text-is("Mill")').waitFor();
    assert.equal(await $('.tab.active .name').textContent(), 'Mill');
    await page.keyboard.press('Escape');
    ok('search finds an entry by name and opens it in a new tab; Escape closes that tab');

    // ── Snapshots ──
    await menu('Snapshots');
    await opt('Take snapshot').click();
    await ask('before');
    assert.equal(await toastText(), 'Snapshot "before" taken');
    await $('.item.ent:has(.nm:text-is("Road"))').click();
    await $('.en textarea').fill('The road is gone.');
    await $('.en-top button[aria-label="Up to the book"]').click();
    assert.equal(entryBy(await book(BOOK), 'Road').content, 'The road is gone.');
    await menu('Snapshots');
    await opt('before').click();
    await opt('Restore').click();
    await page.waitForFunction(() => document.querySelector('#wihero-editor').shadowRoot.querySelector('.toast.show')?.textContent.startsWith('Restored'));
    assert.equal(entryBy(await book(BOOK), 'Road').content, 'A muddy road winds north.');
    await $('.toast button:text-is("Undo")').click();
    await wait(800);
    assert.equal(entryBy(await book(BOOK), 'Road').content, 'The road is gone.');
    ok('a snapshot is taken, restored, and the restore undone');

    // ── Problems ──
    await ev(async n => {
        const c = SillyTavern.getContext();
        const d = await c.loadWorldInfo(n);
        d.entries[99] = { uid: 99, key: ['tower'], keysecondary: [], comment: 'Tower', content: 'x', extensions: { wihero: { id: 'tower', gate: [['nowhere']] } } };
        await c.saveWorldInfo(n, d, true);
    }, BOOK);
    await $('.item.ent:has(.nm:text-is("Tower")) .bang').waitFor();
    await menu('Problems (1)');
    await opt('Tower').click();
    await $('.en .prob:has-text("nowhere")').waitFor();
    assert.ok(await $('.disc:has(h2:text-is("Story logic"))').count());
    await page.keyboard.press('Escape');
    ok('an edit from outside shows up; a problem puts "!" on the row, Problems (1) in the menu, and its text on the page');

    // ── Display ──
    await menu('Colors', 'Red-green safe');
    assert.equal(await ev(() => wihero.settings.colorMode), 'red-green');
    assert.equal(await $('.wih').evaluate(n => getComputedStyle(n).getPropertyValue('--p-open').trim()), '#56b4e9');
    await menu('Colors', 'Standard');
    await menu('Content font');
    assert.equal(await ev(() => wihero.settings.contentFont), 'sans');
    await menu('Content font');
    ok('Colors switches the piece colors (D22) and Content font the entries\' font, both saved');

    // ── Book actions ──
    await $('.chip2[aria-label="Active globally"]').click();
    assert.ok(await ev(async n => (await import('/scripts/world-info.js')).selected_world_info.includes(n), BOOK));
    await $('.bkname').click();
    await opt('Rename').click();
    await ask(SHELF);
    await $(`.bkname h1:text-is("${SHELF}")`).waitFor();
    assert.deepEqual(await ev(async ([a, b]) => { const { selected_world_info, world_names } = await import('/scripts/world-info.js'); return [world_names.includes(a), world_names.includes(b), selected_world_info.includes(b)]; }, [BOOK, SHELF]), [false, true, true]);
    assert.equal(await ev(n => wihero.settings.books[n]?.snapshots?.length, SHELF), 1, 'its snapshots came along');
    assert.equal(await ev(([a]) => wihero.settings.renamed[a], [BOOK]), SHELF);
    await $('.chip2[aria-label="Active globally"]').click();
    ok('Global turns the book on everywhere; Rename keeps it global, its snapshots and the chats\' state');

    // ── Back and hiding ──
    await $('.bkname').click();
    assert.ok(await $('.sheet').count());
    await page.keyboard.press('Escape');
    assert.equal(await $('.sheet').count(), 0, 'Escape closes the sheet first');
    await page.click('#WI-SP-button .drawer-toggle');
    assert.ok(!await visible(), 'the World Info button closes it again');
    await page.click('#WI-SP-button .drawer-toggle');
    assert.equal(await $(`.bkname h1`).textContent(), SHELF, 'and reopening returns to exactly where it was (D6)');
    await page.goBack();
    await wait(300);
    assert.ok(await visible(), 'Android Back steps back inside WI Hero');
    assert.equal(await $('.tab.active').getAttribute('aria-label'), 'Home');
    ok('Back and Escape step back one layer; the World Info button hides and shows it as it was');

    // ── Delete a book with Undo ──
    await $(`.item[data-book="${SHELF}"] .more`).click();
    await opt('Delete').click();
    assert.equal(await $(`.item[data-book="${SHELF}"]`).count(), 0);
    await $('.toast button:text-is("Undo")').click();
    await $(`.item[data-book="${SHELF}"]`).waitFor();
    await $(`.item[data-book="${SHELF}"] .more`).click();
    await opt('Delete').click();
    await wait(6000);
    assert.ok(!await ev(n => SillyTavern.getContext().getWorldInfoNames().includes(n), SHELF));
    assert.equal(await ev(n => wihero.settings.books[n], SHELF), undefined);
    ok('a book is deleted from Home with Undo, its settings and snapshots with it');

    // ── Themes ──
    const overflow = () => ev(() => [...document.getElementById('wihero-editor').shadowRoot.querySelectorAll('.view, .tabbar, .bottombar')].some(n => n.scrollWidth > n.clientWidth + 1));
    const fg = () => $('.wih').evaluate(n => getComputedStyle(n).color);
    await $('.item[data-book="WIHero-N1"]').click();
    await $('.item.ent').first().waitFor();
    await page.waitForFunction(() => wihero.settings.books['WIHero-N1']?.snapshots?.some(s => s.imported));
    const imported = await ev(() => wihero.settings.books['WIHero-N1'].snapshots.find(s => s.imported));
    assert.equal(imported.name, 'As imported', 'a book opened the first time keeps an As imported copy');
    const back = await ev(async p => (await fetch(`/${p.replace(/^\/+/, "")}`)).json(), imported.path);
    assert.equal(Object.keys(back.entries).length, 8);
    ok('an existing book got its As imported copy the first time it was opened');
    await shot('theme-default');
    assert.ok(!await overflow());
    for (const theme of ['Azure', 'Celestial Macaron']) {
        await ev(t => $('#themes').val(t).trigger('change'), theme);
        await wait(800);
        const body = await ev(() => getComputedStyle(document.body).getPropertyValue('--SmartThemeBodyColor').trim());
        const ours = await fg();
        const norm = c => c.replace(/\s/g, '').replace(/^rgba\((\d+,\d+,\d+),1\)$/, 'rgb($1)');
        assert.equal(norm(ours), norm(body), `${theme}: WI Hero's text is the theme's text color`);
        assert.ok(!await overflow(), `${theme}: nothing is wider than the screen`);
        await shot(`theme-${theme.toLowerCase().replace(/\s+/g, '-')}`);
    }
    // A light theme: ST ships none, so its colors are set the way ST's theme editor sets them.
    await ev(() => {
        const s = document.documentElement.style;
        s.setProperty('--SmartThemeBodyColor', 'rgb(40, 40, 46)');
        s.setProperty('--SmartThemeBlurTintColor', 'rgba(246, 244, 238, 0.97)');
        s.setProperty('--SmartThemeQuoteColor', 'rgb(176, 84, 0)');
    });
    await $('.item.ent').first().click();
    await shot('theme-light');
    assert.equal((await fg()).replace(/\s/g, ''), 'rgb(40,40,46)');
    await ev(() => { const s = document.documentElement.style; for (const k of ['--SmartThemeBodyColor', '--SmartThemeBlurTintColor', '--SmartThemeQuoteColor']) s.removeProperty(k); $('#themes').val('Dark Lite').trigger('change'); });
    ok('it follows ST\'s theme (Dark Lite, Azure, Celestial Macaron, and a light one) at 390px; screenshots in e2e/log');

    // ── More settings, and a reload ──
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await $('.view h1:text-is("World Info")').waitFor();
    await $('.head button[aria-label="World Info settings"]').click();
    await opt('More settings').click();
    await page.waitForFunction(() => document.getElementById('WorldInfo').classList.contains('openDrawer'));
    assert.ok(!await visible());
    await page.click('#WI-SP-button .drawer-toggle');
    await wait(500);
    await page.reload();
    await page.waitForFunction(() => window.wihero?.app, null, { timeout: 60000 });
    assert.ok(!await visible());
    await page.click('#WI-SP-button .drawer-toggle');
    await $('.view h1:text-is("World Info")').waitFor();
    assert.equal(await $('.tab').count(), 1, 'after a reload: Home, no tabs (D6)');
    ok('"More settings" opens ST\'s own panel; after a reload WI Hero starts on Home');
});
