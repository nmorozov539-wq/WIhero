// The Guide tab and explain mode in Hero mode (LAYOUT "Guide", "Explain mode"). Moved out of app.js: it reaches the
// rest of the app only through the context passed to createExplain.
import { PORT } from './canvas-graph.js';
import { PIECE_ANCHOR } from './guide.js';
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
    if (at('.card')) return 'canvas';
    const b = at('button');
    const label = b?.getAttribute('aria-label') ?? '';
    if (/^Fit/.test(label)) return 'fit';
    if (/^Tidy/.test(label)) return 'tidy';
    if (at('.checkchip')) return 'checks';
    if (at('.histbtns')) return 'undo';
    if (at('.panelBtn, .panel, .pfold')) return 'panel';
    if (at('.hl, mark, .hit')) return 'highlights';
    if (at('.also')) return 'also';
    return null;
}

/**
 * @param {object} A { S, H, root, layer, library, render, showMe(key) }: the app's state, its root element, the
 *   overlay layer, the library, a redraw, and "Show me" (open the Sample book's card `key` on the canvas).
 */
export function createExplain({ S, H, root, layer, library, render, showMe }) {
    /** Opens the Guide tab at an anchor (a piece's page, or a topic). */
    function openGuide(anchor) {
        H.explain = false;
        H.guide = { anchor };
        H.active = 'guide';
        H.panel = false;
        render();
    }
    /** Explain mode: for one tap, everything explainable is outlined and a tap opens the Guide there. */
    function startExplain() {
        H.explain = true;
        H.bar.armed = null;
        render();
    }
    function stopExplain() { H.explain = false; render(); }

    // In explain mode a press anywhere in WI Hero is caught before the element's own handlers: it never acts.
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'touchstart', 'dblclick', 'contextmenu']) {
        root.addEventListener(type, e => {
            if (!H.explain || S.mode !== 'hero' || e.composedPath().some(n => n.classList?.contains('explainban'))) return;
            e.stopPropagation();
            if (e.cancelable && type !== 'touchstart') e.preventDefault();
        }, { capture: true, passive: false });
    }
    root.addEventListener('click', e => {
        if (!H.explain || S.mode !== 'hero') return;
        const path = e.composedPath();
        if (path.some(n => n.classList?.contains('explainban'))) return;
        e.stopPropagation();
        e.preventDefault();
        const t = path[0];
        const anchor = t instanceof Element ? explainAnchor(t, H) : null;
        if (anchor) openGuide(anchor);
        else layer.toast('Nothing to explain there. Tap something outlined, or Cancel.');
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

    return { openGuide, startExplain, stopExplain, renderGuideTab };
}
