// The Preview tab (LAYOUT "Preview tab", VISUAL 8): the two slots with highlights, Also active, the key, the
// explanation sheet and the report page. What it shows comes from runPreview (src/ui/preview.js).
import { btn, el } from './dom.js';
import { ic } from './icons.js';
import { explain } from './preview.js';

const FAMILY = { open: 'var(--p-open)', close: 'var(--p-close)', glue: 'var(--p-glue)', mask: 'var(--p-mask)', fire: 'var(--s-key)' };
const PLACEHOLDER = { user: 'Type what you would write', reply: 'Type or paste the character\'s reply' };
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
const low = t => t.charAt(0).toLowerCase() + t.slice(1);

/**
 * @param {HTMLElement} main
 * @param {object} x
 * @param {object} x.run runPreview's result
 * @param {object} x.pv { user, reply, edit, page }
 * @param {string} x.book The book's name
 * @param {string} x.seedLabel The "starts from" chip's text
 * @param {(stKey: string) => { title: string, color: string, logic: boolean } | null} x.info
 * @param {object} x.layer
 * @param {() => void} x.pickSeed
 * @param {(patch: object) => void} x.set Changes pv and redraws
 * @param {(stKey: string) => void} x.openEntry
 * @param {(stKey: string) => void} x.showOnCanvas
 */
export function renderPreviewPage(main, x) {
    const pg = el('div', 'ppage');
    main.append(pg);
    if (x.pv.page === 'report') { renderReport(pg, x); return; }
    const { run } = x;

    const head = el('div', 'pvhead');
    head.append(el('h2', '', 'Preview'));
    const src = btn('srcchip', `<span></span>${ic('down', 's')}`, x.pickSeed, 'Where it starts from');
    src.querySelector('span').textContent = x.seedLabel;
    head.append(src);
    pg.append(head);
    const note = el('div', 'pnote');
    note.append('A pretend exchange checked against ', el('i', '', x.book), '. Nothing is saved. Tap a highlight to see why.');
    pg.append(note);

    const body = el('div', 'pbody');
    body.append(slot('user', x), slot('reply', x));
    if (run.also.length) {
        const a = el('div', 'also');
        a.append(el('small', '', 'Also active'));
        for (const k of run.also) {
            const r = run.results.get(k);
            const info = x.info(k);
            const kind = { permanent: 'permanent', vector: 'vector', hold: 'glue', ride: 'glue', keyword: 'earlier message' }[r.how];
            const c = btn(`achip${r.status === 'blocked' ? ' no' : ''}`, '', () => explainSheet(x, k), null);
            c.textContent = `${info?.title ?? r.title} · ${kind}`;
            c.style.setProperty('--c', r.how === 'hold' || r.how === 'ride' ? 'var(--p-glue)' : info?.color ?? 'var(--s-key)');
            a.append(c);
        }
        body.append(a);
    }
    const key = el('div', 'pkey');
    key.innerHTML = `<span><span class="hlx" style="--c:var(--s-key)">solid</span> has pieces</span>`
        + `<span><span class="hlx plain" style="--c:var(--s-key)">dotted</span> plain</span>`
        + `<span><span class="hlx" style="--c:var(--p-open)">${ic('lock')}lock</span></span>`
        + `<span><span class="hlx no" style="--c:var(--s-key)">struck</span> blocked</span>`;
    body.append(key);
    pg.append(body);

    const ft = el('div', 'pfoot');
    const { fire, blocked, changes } = run.counts;
    ft.append(btn('report', `Report: ${fire} fire, ${blocked} blocked, ${changes} change${changes === 1 ? '' : 's'}`, () => x.set({ page: 'report', edit: null })));
    pg.append(ft);
}

function slot(side, x) {
    const s = el('div', `slot ${side}`);
    const h = el('div', 'sh');
    h.append(el('b', '', side === 'user' ? 'YOU' : 'CHARACTER'));
    const editing = x.pv.edit === side;
    h.append(btn('round', ic(editing ? 'check' : 'edit'), () => x.set({ edit: editing ? null : side }), editing ? 'Done' : 'Edit'));
    if (x.pv[side]) h.append(btn('round', ic('x'), () => x.set({ [side]: '', edit: side }), 'Clear'));
    s.append(h);
    if (editing) {
        const t = el('textarea');
        t.value = x.pv[side];
        t.placeholder = PLACEHOLDER[side];
        t.addEventListener('input', () => { x.pv[side] = t.value; });
        t.addEventListener('blur', () => setTimeout(() => { if (x.pv.edit === side) x.set({ edit: null }); }, 150));
        s.append(t);
        setTimeout(() => t.focus(), 0);
    } else {
        const box = highlighted(side, x);
        box.addEventListener('click', () => x.set({ edit: side }));
        s.append(box);
    }
    return s;
}

function highlighted(side, x) {
    const text = x.pv[side];
    const box = el('div', 'htext');
    if (!text) { box.append(el('span', 'ph', PLACEHOLDER[side])); return box; }
    // Longer first, and where two entries share a phrase, the one that fires.
    const hits = x.run.hits[side].slice().sort((p, q) => p.a - q.a || (q.b - q.a) - (p.b - p.a) || Number(q.ok) - Number(p.ok));
    let at = 0;
    for (const h of hits) {
        if (h.a < at) continue;
        box.append(text.slice(at, h.a));
        const info = x.info(h.stKey);
        const phrase = text.slice(h.a, h.b);
        const sp = btn(`hlx${h.lock || info?.logic ? '' : ' plain'}${h.ok ? '' : ' no'}`, h.lock ? ic('lock') : '', e => {
            e.stopPropagation();
            explainSheet(x, h.stKey, { phrase, hit: h });
        });
        sp.append(phrase);
        sp.dataset.key = h.stKey;
        sp.style.setProperty('--c', h.lock ? (h.close ? 'var(--p-close)' : 'var(--p-open)') : info?.color ?? 'var(--s-key)');
        box.append(sp);
        at = h.b;
    }
    box.append(text.slice(at));
    return box;
}

/** The explanation sheet of a highlight, chip or report row: what it did and why, what else it changes. */
export function explainSheet(x, stKey, { phrase = null, hit = null, change = null } = {}) {
    const info = x.info(stKey);
    const r = x.run.results.get(stKey);
    const title = info?.title ?? r?.title ?? 'Entry';
    x.layer.sheet(title, sh => {
        let t;
        if (hit?.lock) t = `"${phrase}": ${hit.why}.`;
        else if (hit?.next) t = explain(hit.next, phrase, { next: true });
        else if (change && !r) t = `${change.text}.`;
        else if (!r) t = `${title} isn't touched by this exchange: none of its key words appear.`;
        else t = explain(r, phrase);
        sh.append(el('p', 'why', t));
        if (change && r) sh.append(el('div', 'rstate', `${change.when}: ${low(change.text)}.`));
        const also = !hit?.lock && !hit?.next ? r?.changes ?? [] : [];
        if (also.length) sh.append(el('div', 'rstate', `It also: ${also.map(c => low(c.text)).join('; ')}.`));
        if (info && !info.logic && !hit?.lock) sh.append(el('div', 'rstate', 'This entry has no pieces: plain World Info that fires on its key words.'));
        sh.append(x.layer.opt('Open entry', () => { x.layer.close(); x.openEntry(stKey); }, { icon: 'entry' }));
        if (info?.logic) sh.append(x.layer.opt('Show on canvas', () => { x.layer.close(); x.showOnCanvas(stKey); }, { icon: 'canvas' }));
    }, { cls: 'explain' });
}

function renderReport(pg, x) {
    const { run } = x;
    const head = el('div', 'en-top');
    head.append(btn('round', ic('back'), () => x.set({ page: null }), 'Back to the preview'));
    head.append(el('h2', 'rtitle', 'Report'));
    pg.append(head);
    const body = el('div', 'rbody');
    const s = run.start;
    const names = list => list.length ? list.join(', ') : 'nothing';
    body.append(el('div', 'rstate start', !s.fired.length && !s.closed.length
        ? `Starting from ${x.seedLabel}: nothing has fired or closed yet.`
        : `Starting from ${x.seedLabel}. Already fired: ${names(s.fired)}. Closed: ${names(s.closed)}.`));
    const section = (name, rows) => {
        body.append(el('h3', '', `${name} · ${rows.length}`));
        if (!rows.length) body.append(el('div', 'rstate none', 'Nothing.'));
        for (const row of rows) {
            const b = btn('rrow', '', row.open);
            b.style.setProperty('--c', row.color);
            const d = el('div');
            d.append(el('b', '', row.title));
            if (row.sub) d.append(el('small', '', row.sub));
            b.append(d);
            body.append(b);
        }
    };
    const results = [...run.results.values()];
    const rows = status => results.filter(r => r.status === status).map(r => {
        const info = x.info(r.stKey);
        const why = status === 'fires' ? cap(r.why) + (r.mask ? `, with its "${r.mask}" mask` : '') : `Because ${r.why}`;
        return { title: info?.title ?? r.title, color: info?.color ?? 'var(--s-key)', sub: why + (r.logic ? '' : ' (plain entry)'), open: () => explainSheet(x, r.stKey) };
    });
    section('Fires', rows('fires'));
    section('Blocked', rows('blocked'));
    section('Would change', run.changes.map(c => ({ title: c.text, color: FAMILY[c.family] ?? 'var(--muted)', sub: c.when, open: () => explainSheet(x, c.stKey, { change: c }) })));
    pg.append(body);
}
