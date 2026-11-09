// The Guide tab (LAYOUT "Guide"): every page of guide.js, one after another, with an index on top, scrolled to the
// anchor it was opened at. Each piece page: one line, a small picture in the canvas's colors, an example, the fine
// print, common mistakes, and Show me (the Sample book on a matching card).
import { btn, html, el } from './dom.js';
import { ic } from './icons.js';
import { PAGES, TOPICS } from './guide.js';

const COLOR = { open: 'var(--p-open)', close: 'var(--p-close)', glue: 'var(--p-glue)', mask: 'var(--p-mask)', pack: 'var(--p-pack)', moment: 'var(--accent)', by: 'var(--muted)' };

/** A small card in the picture: x, y, its name. */
const card = (x, y, name, extra = '') => `<rect x="${x}" y="${y}" width="78" height="30" rx="7" fill="var(--card)" stroke="var(--line)"${extra}/><text x="${x + 10}" y="${y + 19}" font-size="11" font-weight="600" fill="var(--fg)">${name}</text>`;
const chipSvg = (x, y, text, color) => `<rect x="${x}" y="${y - 9}" width="${16 + text.length * 6}" height="18" rx="9" fill="var(--canvas, var(--tint))" stroke="${color}" stroke-width="1.5"/><text x="${x + 8}" y="${y + 4}" font-size="10" font-weight="600" fill="${color}">${text}</text>`;

/** The picture for a page, drawn with the canvas's piece colors (VISUAL 6.2, 7). */
function picture(id) {
    const c = COLOR;
    const line = (col, dashed = false) => `<path d="M82 35 H176" stroke="${col}" stroke-width="2.2" fill="none"${dashed ? ' stroke-dasharray="6 5"' : ''}/>`;
    const bar = col => `<path d="M176 29 V41" stroke="${col}" stroke-width="2.5"/>`;
    const body = {
        opens: `${card(4, 20, 'Road')}${card(176, 20, 'Mill')}${line(c.open)}<circle cx="82" cy="35" r="4" fill="${c.open}"/>`,
        closes: `${card(4, 20, 'Crossing')}${card(176, 20, 'Ferry')}${line(c.close, true)}${bar(c.close)}`,
        glue: `${card(4, 20, 'Tunnel')}${card(176, 20, 'Echo')}${line(c.glue)}<rect x="250" y="22" width="4" height="26" rx="2" fill="${c.glue}"/>`,
        switch: `${card(4, 20, 'Fork')}${card(176, 2, 'Left')}${card(176, 40, 'Right')}<path d="M82 35 H130 V17 H176 M130 35 V55 H176" stroke="${c.open}" stroke-width="2.2" fill="none"/><circle cx="82" cy="35" r="5" fill="${c.close}"/>`,
        mask: `<rect x="90" y="8" width="78" height="30" rx="7" fill="none" stroke="${c.mask}"/><rect x="86" y="13" width="78" height="30" rx="7" fill="none" stroke="${c.mask}"/>${card(80, 18, 'Tower')}${chipSvg(96, 60, '‹ ruined ›', c.mask)}`,
        pack: `<rect x="52" y="4" width="186" height="62" rx="10" fill="none" stroke="${c.pack}" stroke-dasharray="5 4"/><text x="62" y="18" font-size="10" font-weight="700" fill="${c.pack}">#town</text>${card(60, 26, 'Tavern')}${card(152, 26, 'Market')}`,
        lock: `${card(4, 20, 'Road')}${card(176, 20, 'Cave')}<path d="M82 35 H176" stroke="${c.open}" stroke-width="2.2"/>${chipSvg(88, 35, '🔒 red beard', c.open)}`,
        wait: `${card(4, 20, 'Road')}${card(176, 20, 'Bridge')}<path d="M82 35 H176" stroke="${c.open}" stroke-width="2.2"/>${chipSvg(100, 35, '⏱ 2 msgs', c.open)}`,
        moment: `<rect x="4" y="20" width="84" height="30" rx="7" ry="7" fill="var(--card)" stroke="${c.moment}" stroke-dasharray="4 3"/><text x="14" y="32" font-size="8" font-weight="700" fill="var(--muted)">MOMENT</text><text x="14" y="44" font-size="11" font-weight="600" fill="var(--fg)">Missing tooth</text>${card(176, 20, 'Dentist')}<path d="M88 35 H176" stroke="${c.open}" stroke-width="2.2"/>`,
        once: `${card(80, 20, 'Omen')}${chipSvg(124, 26, '1×', c.close)}`,
        by: `${card(80, 20, 'Whisper')}<text x="80" y="64" font-size="10" fill="var(--muted)">only your messages</text>`,
        greeting: `<rect x="4" y="20" width="84" height="30" rx="15" fill="var(--card)" stroke="var(--line)"/><text x="30" y="32" font-size="8" font-weight="700" fill="var(--muted)">START</text><text x="30" y="44" font-size="11" font-weight="600" fill="var(--fg)">Alt 2</text>${card(176, 20, 'Market')}<path d="M88 35 H176" stroke="${c.open}" stroke-width="2.2"/>`,
    }[id];
    if (!body) return null;
    const s = el('div', 'gpic');
    s.innerHTML = `<svg viewBox="0 0 260 70" width="260" height="70" role="img" aria-label="How it looks on the canvas">${body}</svg>`;
    return s;
}

/**
 * Draws the Guide into `main`.
 * @param {HTMLElement} main
 * @param {{ anchor: string|null, showMe(id, cardKey), hasSample: boolean, close() }} x
 */
export function renderGuide(main, x) {
    const v = el('div', 'view guide');
    main.append(v);
    const head = el('div', 'ghead');
    head.append(el('h1', '', 'Guide'), el('p', 'help', 'How each piece works. In explain mode (the "?" on the canvas), tap anything to come here.'));
    const idx = el('div', 'gidx');
    for (const p of [...PAGES, ...TOPICS]) {
        const b = btn('gchip', '', () => v.querySelector(`[data-anchor="${p.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
        b.textContent = p.title;
        if (p.family) b.style.setProperty('--c', COLOR[p.family]);
        idx.append(b);
    }
    head.append(idx);
    v.append(head);
    for (const p of PAGES) {
        const sec = el('section', 'gpage');
        sec.dataset.anchor = p.id;
        sec.style.setProperty('--c', COLOR[p.family]);
        sec.append(el('h2', '', p.title), el('p', 'gline', p.line));
        const pic = picture(p.id);
        if (pic) sec.append(pic);
        sec.append(el('div', 'glbl', 'Example'), el('p', 'gex', p.example));
        if (p.fine.length) { sec.append(el('div', 'glbl', 'The fine print')); const ul = el('ul'); for (const f of p.fine) ul.append(el('li', '', f)); sec.append(ul); }
        if (p.mistakes.length) { sec.append(el('div', 'glbl', 'Common mistakes')); const ul = el('ul', 'gmis'); for (const f of p.mistakes) ul.append(el('li', '', f)); sec.append(ul); }
        if (p.show && x.hasSample) sec.append(btn('linkish acc gshow', html`${ic('canvas', 's')} Show me in the Sample book`, () => x.showMe(p.id, p.show)));
        v.append(sec);
    }
    const more = el('div', 'glbl gtopics', 'On the screen');
    v.append(more);
    for (const t of TOPICS) {
        const sec = el('section', 'gpage gtopic');
        sec.dataset.anchor = t.id;
        sec.append(el('h2', '', t.title), el('p', 'gline', t.line));
        const ul = el('ul');
        for (const f of t.fine) ul.append(el('li', '', f));
        sec.append(ul);
        v.append(sec);
    }
    if (x.anchor) requestAnimationFrame(() => {
        const n = v.querySelector(`[data-anchor="${x.anchor}"]`);
        if (n) { n.scrollIntoView({ block: 'start' }); n.classList.add('flash'); }
    });
    return v;
}
