// Host contract checks against a throwaway ST 1.19.0 (e2e/README.md). No external model is used.
// Checks server persistence independently of ST's cache, including its real native save debounce.
import assert from 'node:assert/strict';
import { browser, page, ev, ST_URL } from './lib.mjs';

const BOOK = 'Health Save Contract';
const TARGET = 'Health Save Target';
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const persisted = () => ev(async name => {
    const r = await fetch('/api/worldinfo/get', {
        method: 'POST', headers: SillyTavern.getContext().getRequestHeaders(), body: JSON.stringify({ name }), cache: 'no-store',
    });
    if (!r.ok) throw new Error(`Independent read failed: ${r.status}`);
    return r.json();
}, BOOK);
try {
    // This contract check needs book persistence only; keep concurrent suites' user settings intact.
    await page.route('**/api/settings/save', route => route.fulfill({ status: 200, body: 'ok' }));
    await page.goto(ST_URL);
    await page.waitForFunction(() => window.wihero?.library);
    await ev(async ([name, target]) => {
        const WI = await import('/scripts/world-info.js');
        for (const book of [name, target]) if (WI.world_names.includes(book)) await WI.deleteWorldInfo(book);
        if (!wihero.health.ok) throw new Error(wihero.health.problems.join(', '));
        await wihero.library.create(name);
        await wihero.library.get(name);
        wihero.library.change(name, data => {
            data.entries = { 0: { uid: 0, content: 'initial local' }, 1: { uid: 1, content: 'initial native' } };
        });
        await wihero.library.flush();
    }, [BOOK, TARGET]);
    await ev(async name => {
        const c = SillyTavern.getContext();
        const native = await c.loadWorldInfo(name);
        native.entries[1].content = 'native pending';
        await c.saveWorldInfo(name, native); // actual ST debounce: cache now, HTTP later
        wihero.library.change(name, data => { data.entries[0].content = 'local confirmed'; });
        await wihero.library.flush();
    }, BOOK);
    await page.waitForTimeout(1300);
    await ev(() => wihero.library.flush());
    let disk = await persisted();
    assert.equal(disk.entries[0].content, 'local confirmed');
    assert.equal(disk.entries[1].content, 'native pending');
    console.log('PASS: real ST queued native save preserves both native and extension edits on disk');

    await page.route('**/api/worldinfo/edit', route => route.fulfill({ status: 500, body: 'Injected save failure' }));
    const failed = await ev(async name => {
        wihero.library.change(name, data => { data.entries[0].content = 'retry me'; });
        try { await wihero.library.flush(); return false; } catch { return true; }
    }, BOOK);
    assert.equal(failed, true);
    assert.equal((await persisted()).entries[0].content, 'local confirmed');
    assert.equal(await ev(name => wihero.library.peek(name).entries[0].content, BOOK), 'retry me');
    await page.unroute('**/api/worldinfo/edit');
    await ev(() => wihero.library.flush());
    assert.equal((await persisted()).entries[0].content, 'retry me');
    console.log('PASS: HTTP 500 rejects flush, keeps the working edit, leaves persisted data intact and recovers on retry');

    await page.route('**/api/worldinfo/edit', route => route.request().postDataJSON().name === TARGET
        ? route.fulfill({ status: 403, body: 'Injected destination failure' }) : route.continue());
    const renameFailed = await ev(async ([name, target]) => {
        try { await wihero.library.rename(name, target); return false; } catch { return true; }
    }, [BOOK, TARGET]);
    assert.equal(renameFailed, true);
    assert.equal((await persisted()).entries[0].content, 'retry me');
    assert.equal(await ev(name => wihero.library.names().includes(name), BOOK), true);
    await page.unroute('**/api/worldinfo/edit');
    console.log('PASS: failed destination persistence leaves the rename source on disk');

    await page.route('**/api/worldinfo/delete', route => route.fulfill({ status: 500, body: 'Injected delete failure' }));
    const deleteFailed = await ev(async name => {
        try { await wihero.library.remove(name); return false; } catch { return true; }
    }, BOOK);
    assert.equal(deleteFailed, true);
    assert.equal((await persisted()).entries[0].content, 'retry me');
    assert.equal(await ev(name => !!wihero.library.peek(name), BOOK), true);
    await page.unroute('**/api/worldinfo/delete');
    assert.deepEqual(errors, []);
    console.log('PASS: actual ST false delete result is reported and retains the loaded and persisted source');
} finally {
    await page.unroute('**/api/worldinfo/edit').catch(() => {});
    await page.unroute('**/api/worldinfo/delete').catch(() => {});
    await ev(async names => {
        for (const name of names) {
            if (wihero.library.names().includes(name)) await wihero.library.remove(name);
            delete wihero.settings.books[name];
        }
        SillyTavern.getContext().saveSettingsDebounced();
    }, [BOOK, TARGET]).catch(() => {});
    await browser.close();
}
