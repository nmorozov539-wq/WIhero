// The Guide tab and explain mode in Hero mode (LAYOUT "Guide", "Explain mode"). Moved out of app.js: it reaches the
// rest of the app only through the context passed to createExplain.
import { PORT } from './canvas-graph.js';
import { PIECE_ANCHOR, pageOf } from './guide.js';
import { renderGuide } from './guide-page.js';

/** The book the Guide's "Show me" opens. */
export const SAMPLE = 'WIHero-Sample';

/**
 * The Guide anchor of what was tapped in explain mode, or null (LAYOUT "Explain mode").
 * @param {Element} t The element tapped.
 * @param {object} H Hero mode's state (S.hero): which piece the strip is editing.
 */
export function explainAnchor(t, H) {
    const at = sel => t.closest?.(sel);
    const chipEl = at('.pchip[data-piece]');
    if (chipEl) return PIECE_ANCHOR[chipEl.dataset.piece] ?? null;
    if (at('.pstrip')) { const k = H.bar?.edit?.piece; return PIECE_ANCHOR[k] ?? 'strip'; }
    const pc = at('.pc[data-piece]');
    if (pc) return PIECE_ANCHOR[pc.dataset.piece] ?? 'inspector';
    if (at('.insp, .hinsp')) return 'inspector';
    const port = at('[data-port]');
    if (port) return PIECE_ANCHOR[PORT[port.dataset.port.split('|')[1]]?.piece] ?? 'canvas';
    const pill = at('.lockp');
    if (pill) return pill.dataset.kind === 'wait' ? 'wait' : 'lock';
    const line = at('.lhit');
    if (line) return { open: 'opens', close: 'closes', ride: 'glue' }[line.dataset.kind] ?? 'canvas';
    if (at('.junc')) return 'opens';
    if (at('.packframe')) return 'pack';
    if (at('.mnav, .layercard')) return 'mask';
    if (at('.card.moment')) return 'moment';
    if (at('.card.greet')) return 'greeting';
    if (at('.card .badge1')) return t.closest('.badge1').textContent === '1×' ? 'once' : 'closes';
    if (at('.card .cbang')) return 'checks';
    if (at('.card .sticky')) return null; // a sticky note: a tooltip only
    if (at('.card')) return 'canvas';
    if (at('.tabs .tab, .tabrow .tab, button.tab')) return 'tabs';
    if (at('.zlabel')) return 'fit';
    const b = at('button');
    const label = b?.getAttribute('aria-label') ?? '';
    if (/^(Fit|Zoom)/.test(label)) return 'fit';
    if (/^Tidy/.test(label)) return 'tidy';
    if (at('.checkchip')) return 'checks';
    if (at('.histbtns')) return 'undo';
    if (at('.panelBtn, .panel, .pfold')) return 'panel';
    if (at('.hl, mark, .hit')) return 'highlights';
    if (at('.also')) return 'also';
    return null;
}

/** A card's name on the canvas, or a pack's (#name), for a tooltip. */
function nameIn(root, key) {
    if (!key) return 'it';
    if (key.startsWith('pack:')) return `#${key.slice(5)}`;
    const c = root?.querySelector?.(`.card[data-id="${CSS.escape(key)}"] .t`);
    return c?.textContent || 'the entry';
}

/**
 * Explain mode's one-liners: what a thing does, in a sentence, as a concept (the Guide's page has the rules). A
 * function takes the names this very thing joins, so a line says "keeps Mill shut until Road has fired".
 */
export const TIPS = {
    opens: (a = 'the one before it', b = 'an entry') => `Keeps ${b} shut until ${a} has fired.`,
    closes: (a = 'another entry', b = 'an entry') => `Shuts ${b} for good once ${a} fires.`,
    glue: (a, b) => (a ? `Sends ${b} every time ${a} fires, key words or not.` : 'Keeps an entry going whether or not its key words match.'),
    switch: () => 'A fork: the first path to fire shuts all the others.',
    mask: () => 'Swaps in another version of the entry\'s text while its condition holds.',
    tracker: () => 'A value the model writes in its replies; the newest one is what gets sent.',
    pack: name => (name ? `Groups entries, so one rule on ${name} covers every entry in it.` : 'Groups entries, so one rule covers them all.'),
    lock: phrase => (phrase ? `Holds its row until someone says "${phrase}" in the chat.` : 'Holds its row until a phrase is said in the chat.'),
    wait: n => (n ? `Holds its row until ${n} more ${n === 1 ? 'message has' : 'messages have'} passed.` : 'Holds its row until a number of messages have passed.'),
    moment: () => 'An event marked by a phrase in the chat. It sends nothing; entries wait on it or close on it.',
    once: () => 'Fires a single time, then shuts itself.',
    by: () => 'Limits whose messages can set off the key words: yours, the character\'s, or both.',
    greeting: () => 'Starts a scenario when the chat opens on that greeting.',
    canvas: () => 'An entry: SillyTavern sends its text when one of its key words comes up.',
    fit: () => 'Brings every card into view.',
    tidy: () => 'Lays every card out again from its links. Undo puts it back.',
    undo: () => 'Steps back through your changes to this book.',
    checks: () => 'Counts what can never fire: entries, rows and masks the rules leave shut.',
    tabs: () => 'Anything you open gets a tab of its own; closing one loses nothing.',
    panel: () => 'Every entry in the book. Drag a dot onto the canvas to place it.',
    strip: () => 'Sets up the piece you are adding. Done keeps it, Cancel puts the book back.',
    inspector: () => 'One entry\'s story logic, a row per piece.',
    highlights: () => 'The words in the pretend exchange that set something off.',
    also: () => 'What goes in without a word pointing at it: permanent entries, glue, earlier matches.',
};

/**
 * What explain mode says about the element tapped: { anchor, title, text } for its one-line tooltip, or null when
 * there is nothing to say (then it isn't explainable at all: no outline, a tap does nothing). The title names the
 * piece; the text says what it does, with this thing's own names where the page shows them. `anchor` is where a long
 * press (a click on desktop, the tooltip's More) opens the Guide; null for a tooltip only.
 * @param {Element} t
 * @param {object} H
 * @param {ParentNode} [root] Where to look up card names.
 */
export function explainTip(t, H, root = null) {
    const anchor = explainAnchor(t, H);
    const at = sel => t.closest?.(sel);
    const page = anchor ? pageOf(anchor) : null;
    const tip = (title, text) => ({ anchor, title, text });
    const say = (...a) => tip(page?.title ?? '', (TIPS[anchor] ?? (() => page?.line ?? ''))(...a));
    const line = at('.lhit');
    if (line?.dataset?.ends && TIPS[anchor]) {
        const [a, b] = line.dataset.ends.split('>').map(k => nameIn(root, k));
        return say(a, b);
    }
    const pill = at('.lockp');
    if (pill) {
        const what = pill.textContent.trim();
        return pill.dataset.kind === 'wait' ? say(parseInt(what, 10) || null) : say(what || null);
    }
    const j = at('.junc');
    if (j) return j.textContent.trim() === 'or'
        ? tip('or', 'Any one of the rows joined here is enough to open it.')
        : tip('and', 'Every link joined here has to have fired before it opens.');
    const port = at('[data-port]');
    if (port && page) {
        const [key, kind] = port.dataset.port.split('|');
        const name = nameIn(root, key);
        const out = PORT[kind]?.dir === 'out';
        const fam = PORT[kind]?.family;
        const text = fam === 'open' ? (out ? `Way out: what ${name} opens starts here.` : `Way in: links arriving here keep ${name} shut until they fire.`)
            : fam === 'close' ? (out ? `Way out: what ${name} closes starts here.` : `Way in: links arriving here shut ${name} for good.`)
            : (out ? `Way out: entries glued to ${name} start here.` : `Way in: ${name} rides along with what arrives here.`);
        return tip(page.title, text);
    }
    const pf = at('.packframe');
    if (pf?.dataset?.pack) return say(`#${pf.dataset.pack}`);
    const badge = at('.card .badge1');
    if (badge) return badge.textContent === '1×' ? say() : tip('Closes', `Shuts this entry ${badge.textContent.slice(1)} messages after it first fires.`);
    if (at('.card .fired')) return tip(`Fired ${at('.card .fired').textContent}`, 'How many times it has fired in the open chat.');
    if (at('.card .cbang')) return tip('Problem', 'Something about this entry is off; the dead branches chip lists it.');
    if (at('.card .sticky')) return tip('Sticky note', 'Your own note on the card, never sent to the model.');
    if (at('[data-grip]')) return tip('Grip', 'Drag it to move the card.');
    const card = at('.card[data-id]');
    if (card && !card.classList.contains('moment')) {
        const name = card.querySelector?.('.t')?.textContent || 'Entry';
        const k = card.querySelector?.('.k')?.textContent?.trim() ?? '';
        if (card.classList.contains('closed')) return tip(name, `${k.replace(/^CLOSED · by/, 'Closed by')}: it won't fire again on this branch of the chat.`);
        if (k === 'permanent') return tip(name, 'Permanent: sent every time, no key words needed. Rules can still shut it.');
        if (k.startsWith('mask: ')) return tip(name, `Its mask "${k.slice(6)}" is on: that version of the text is the one sent.`);
        return tip(name, TIPS.canvas());
    }
    if (card) return tip(card.querySelector?.('.t')?.textContent || 'Moment', TIPS.moment());
    const b = at('button');
    const label = b?.getAttribute?.('aria-label') ?? '';
    if (anchor === 'fit' && /^Zoom (in|out)/.test(label)) return tip(label, 'Two fingers or the mouse wheel zoom too.');
    if (at('.zlabel')) return tip('Zoom', 'How big the canvas is drawn. Tap to go back to 100%.');
    if (anchor === 'undo' && label) return tip(label.replace(/ \(.*\)$/, ''), label.startsWith('Redo') ? 'Steps forward again through what you undid.' : TIPS.undo());
    if (anchor === 'tabs') {
        const tb = at('.tab');
        const name = tb?.getAttribute?.('aria-label') || tb?.textContent?.trim() || 'Tab';
        const what = { Canvas: 'The book\'s entries as cards, and the rules between them as lines.', Preview: 'A pretend exchange: what would fire, and why.', Guide: 'How each piece works, in depth.' }[name];
        return tip(name, what ?? 'An entry opened in a tab of its own.');
    }
    if (!page) return null;
    return say();
}

/**
 * @param {object} A { S, H, root, layer, library, render, showMe(key) }: the app's state, its root element, the
 *   overlay layer, the library, a redraw, and "Show me" (open the Sample book's card `key` on the canvas).
 */
export function createExplain({ S, H, root, layer, library, render, showMe }) {
    /** The tooltip on screen, or null. */
    let tipEl = null;
    function hideTip() { tipEl?.remove(); tipEl = null; }
    /** Opens the Guide tab at an anchor (a piece's page, or a topic). */
    function openGuide(anchor) {
        hideTip();
        H.explain = false;
        H.guide = { anchor };
        H.active = 'guide';
        H.panel = false;
        render();
    }
    /** Explain mode: everything explainable is outlined; a tap shows a tooltip, a long press opens the Guide there. */
    function startExplain() {
        H.explain = true;
        H.bar.armed = null;
        render();
    }
    function stopExplain() { hideTip(); H.explain = false; render(); }

    /** The tooltip for `tip`, next to `target`: above it when there is room, else below; kept inside WI Hero. */
    function showTip(target, tip, { more = true } = {}) {
        hideTip();
        const box = document.createElement('div');
        box.className = 'explaintip';
        box.setAttribute('role', 'tooltip');
        const p = document.createElement('p');
        const h = document.createElement('b');
        h.textContent = tip.title;
        p.append(h, ` ${tip.text}`);
        box.append(p);
        if (tip.anchor && more) {
            const m = document.createElement('button');
            m.type = 'button';
            m.className = 'linkish acc';
            m.textContent = 'More in the Guide ›';
            m.addEventListener('click', () => openGuide(tip.anchor));
            box.append(m);
        }
        root.append(box);
        tipEl = box;
        const R = root.getBoundingClientRect();
        const r = target.getBoundingClientRect();
        const w = box.offsetWidth;
        const hgt = box.offsetHeight;
        const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2 - R.left), R.width - w - 8);
        const above = r.top - R.top - hgt - 10;
        const y = above >= 8 ? above : Math.min(r.bottom - R.top + 10, R.height - hgt - 8);
        Object.assign(box.style, { left: `${x}px`, top: `${y}px` });
    }

    /** Marks what can be explained (.xok) and what can't (.xno), once a draw in explain mode has settled. */
    function mark() {
        for (const n of root.querySelectorAll('.xok, .xno')) n.classList.remove('xok', 'xno');
        if (!H.explain || S.mode !== 'hero') return;
        for (const n of root.querySelectorAll(MARKABLE)) {
            if (n.closest('.explainban, .explaintip, .explainq')) continue;
            n.classList.add(explainTip(n, H, root) ? 'xok' : 'xno');
        }
    }

    // In explain mode a press anywhere in WI Hero is caught before the element's own handlers: it never acts. The
    // canvas still gets its presses, but only to move the view (it knows explain mode is on), so you can look around.
    const exempt = path => path.some(n => n.classList?.contains('explainban') || n.classList?.contains('explaintip') || n.classList?.contains('explainq'));
    const onCanvas = path => path.some(n => n.classList?.contains('vp')) && !path.some(n => n.classList?.contains('canvas-tools') || n.classList?.contains('zlabel') || n.classList?.contains('histbtns') || n.classList?.contains('checkchip') || n.classList?.contains('explainq') || n.classList?.contains('panelBtn'));
    let press = null; // { x, y, target, timer, long, mouse }
    const LONG = 500;
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'touchstart', 'dblclick', 'contextmenu']) {
        root.addEventListener(type, e => {
            if (!H.explain || S.mode !== 'hero') return;
            const path = e.composedPath();
            if (exempt(path)) return;
            if (type === 'pointerdown') {
                clearTimeout(press?.timer);
                hideTip();
                const t = path[0];
                press = { x: e.clientX, y: e.clientY, target: t, long: false, mouse: e.pointerType === 'mouse' };
                if (e.button === 0 && t instanceof Element) press.timer = setTimeout(() => {
                    // A long press: straight to the Guide.
                    const tip = explainTip(t, H, root);
                    if (!tip?.anchor || !press) return;
                    press.long = true;
                    navigator.vibrate?.(12);
                    openGuide(tip.anchor);
                }, LONG);
            }
            if (type === 'pointerup') clearTimeout(press?.timer);
            if (onCanvas(path) && (type === 'pointerdown' || type === 'pointerup' || type === 'mousedown' || type === 'touchstart')) return;
            e.stopPropagation();
            if (e.cancelable && type !== 'touchstart') e.preventDefault();
        }, { capture: true, passive: false });
    }
    root.addEventListener('pointermove', e => {
        if (!press || !H.explain) return;
        if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 8) { clearTimeout(press.timer); press.moved = true; }
    }, true);
    root.addEventListener('click', e => {
        if (!H.explain || S.mode !== 'hero') return;
        const path = e.composedPath();
        if (exempt(path)) return;
        e.stopPropagation();
        e.preventDefault();
        const p = press;
        press = null;
        if (p?.long || p?.moved) return; // the Guide is already open, or it was a look around
        // The canvas captures its pointer, so the click lands on the view: what was pressed is what counts.
        const t = p?.target instanceof Element ? p.target : path[0];
        const tip = t instanceof Element ? explainTip(t, H, root) : null;
        if (!tip) { hideTip(); return; } // nothing to say: nothing happens
        // Desktop: hovering shows the tooltip, so a click goes to the Guide; a finger gets the tooltip first.
        if (S.desk && p?.mouse && tip.anchor) { openGuide(tip.anchor); return; }
        showTip(t, tip);
    }, true);
    // Desktop: the tooltip follows the mouse, after a moment's rest.
    let hoverTimer = null;
    let hovered = null;
    root.addEventListener('pointerover', e => {
        if (!H.explain || S.mode !== 'hero' || e.pointerType !== 'mouse' || press) return;
        const path = e.composedPath();
        if (exempt(path)) return;
        const t = path[0];
        clearTimeout(hoverTimer);
        const tip = t instanceof Element ? explainTip(t, H, root) : null;
        const key = tip && `${tip.title}\n${tip.text}`;
        if (key === hovered) return;
        hovered = key;
        if (!tip) { hoverTimer = setTimeout(hideTip, 150); return; }
        hoverTimer = setTimeout(() => { if (H.explain) showTip(t, tip, { more: false }); }, 250);
    }, true);

    /** Draws the Guide tab into `main`, scrolled to its anchor once. */
    function renderGuideTab(main) {
        main.dataset.page = 'hero:guide';
        renderGuide(main, {
            anchor: H.guide.anchor,
            hasSample: library.names().includes(SAMPLE),
            showMe: (_id, key) => { H.guide.anchor = null; showMe(key); },
        });
        H.guide.anchor = null; // scrolled there once; a redraw keeps the reader's place
    }

    /** After every Hero draw: the explain marks, and no tooltip left over from before it. */
    function afterRender() {
        if (!H.explain) { hideTip(); hovered = null; }
        requestAnimationFrame(mark);
    }

    return { openGuide, startExplain, stopExplain, renderGuideTab, afterRender };
}

/** What explain mode looks at to outline (or set aside): pieces of the canvas, rows, and every button. */
const MARKABLE = '.pchip, .card, .card .badge1, .card .cbang, .card .sticky, .lockp, .junc, .packframe, .mnav, .pstrip, .pc, .insp .ihead, .hinsp .ihead, .panelBtn, .checkchip, .histbtns button, .canvas-tools button, .zlabel, .pfold, .plist .phdr, .tab, button, [role="button"], input, select, textarea';
