// Book content never reaches innerHTML through a button label (review 2026-11-09, finding 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Html, escapeHtml, html } from '../src/ui/html.js';
import { ic } from '../src/ui/icons.js';

const HOSTILE = '<img src=x onerror=alert(1)>';

/** Just enough of `document` for dom.js's btn(): records what was set as markup and what as text. */
function fakeDocument() {
    globalThis.document = {
        createElement: tag => ({
            tag, className: '', type: '', attrs: {}, markup: null, text: null,
            set innerHTML(v) { this.markup = String(v); },
            set textContent(v) { this.text = String(v); },
            setAttribute(k, v) { this.attrs[k] = v; },
            addEventListener() {},
        }),
    };
}

test('html`` escapes values and keeps Html as it is', () => {
    assert.equal(escapeHtml(`a&b<"c'>`), 'a&amp;b&lt;&quot;c&#39;&gt;');
    const out = html`${ic('x', 's')}<span>${HOSTILE}</span>`;
    assert.ok(out instanceof Html);
    assert.ok(out.markup.startsWith('<svg class="i s"'));
    assert.ok(out.markup.includes('<span>&lt;img src=x onerror=alert(1)&gt;</span>'));
    assert.equal(`${ic('x')}`, ic('x').markup, 'an icon still works inside a plain template');
});

test('btn(): a plain string is text, only Html is markup', async () => {
    fakeDocument();
    const { btn } = await import('../src/ui/dom.js');
    const names = [HOSTILE, 'Key'].join(', ');
    const b = btn('addb mo', `Story moves on: close ${names} when this fires`);
    assert.equal(b.markup, null);
    assert.equal(b.text, `Story moves on: close ${HOSTILE}, Key when this fires`);
    const i = btn('linkish', html`${ic('plus', 's')} Add ${HOSTILE}`);
    assert.equal(i.text, null);
    assert.ok(!i.markup.includes('<img'));
    assert.ok(btn('', ic('x')).markup.startsWith('<svg'));
});
