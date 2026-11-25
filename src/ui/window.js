// A bounded window for a keyed list (N4a/N4b): only the items around the viewport are mounted, with a spacer for each
// skipped run. Heights are cached by item key from the mounted nodes; unknown items use their `est` (or the caller's
// default), and a measured item corrects its spacer on the next fix. The first item in the window is the anchor, so a
// height correction adjusts `scrollTop` by the anchor's movement instead of letting content jump. A focused item stays
// mounted at its true position, with a spacer either side, while the window moves away from it.
//
// The phone book page (normal.js) scrolls a whole `.view` that also holds the header, chips and selection head; those
// stay in `prefix`. The desktop book list (desk.js) scrolls the `.bllist` itself and has no prefix. Both use the same
// mechanics, so this module owns the range maths, the gap nodes, the height cache and the scroll rAF.
import { el, keyed } from './dom.js';

/** Books with more items than this keep every row (the old path); a window is only worth its spacers above it. */
export const WIN_LIMIT = 200;
/** Screens above and below the viewport: about four screens, ~50 rows at 390 × 844 or ~47 at 1366 × 768. */
export const WIN_OVERSCAN = 1.5;

/**
 * @param {HTMLElement} host the scrolling box whose keyed children are the list items
 * @param {{ defaultHeight?: number, marginSelector?: string, overscan?: number }} [opts]
 *   `defaultHeight` is the estimate for an item with no `est`; `marginSelector` names items whose vertical margins
 *   are part of their layout height (a note or a folder head between rows).
 */
export function createListWindow(host, { defaultHeight = 54, marginSelector = '.empty-note', overscan = WIN_OVERSCAN } = {}) {
    const s = {
        heights: new Map(), prefix: [], body: [], byKey: new Map(), gaps: [], last: null,
        elByKey: new Map(), mounted: new Set(), ro: null, raf: 0, windowed: false, dirty: false,
        viewport: 0, focusKey: null, anchorKey: null,
    };
    const activeOf = () => host.getRootNode?.()?.activeElement ?? globalThis.document?.activeElement ?? null;
    // The window inserts and removes items above the viewport itself. Browser scroll anchoring would then add the
    // removed items' height to scrollTop a second time; fixGaps() is the one anchor that keeps the content still.
    host.style.overflowAnchor = 'none';
    // Scroll work is coalesced to one rAF; the handler itself only schedules.
    const onScroll = () => { if (s.windowed) schedule(); };
    let focusTimer = 0;
    const onFocusOut = () => {
        clearTimeout(focusTimer);
        focusTimer = setTimeout(() => {
            focusTimer = 0;
            // A hidden list is waiting for Back (N3b): keep its focused row pinned until it is shown again.
            if (host.hidden) return;
            const a = activeOf();
            if (a && host.contains(a)) return;
            if (s.focusKey !== null) { s.focusKey = null; if (s.windowed) schedule(); }
        }, 0);
    };
    host.addEventListener('scroll', onScroll, { passive: true });
    host.addEventListener('focusout', onFocusOut);
    if (globalThis.ResizeObserver) {
        s.ro = new ResizeObserver(entries => {
            let changed = false;
            for (const en of entries) {
                const key = en.target.dataset?.key;
                if (key === undefined) continue;
                const h = outerHeight(en.target);
                if (h > 0 && Math.abs((s.heights.get(key) ?? -1) - h) > 0.5) { s.heights.set(key, h); changed = true; }
            }
            if (changed) { s.dirty = true; if (s.windowed) schedule(); }
        });
    }

    /** A node's layout height, with an item's vertical margins included (margins are outside the box). */
    function outerHeight(n) {
        const h = n.getBoundingClientRect().height;
        if (!marginSelector || !n.matches?.(marginSelector)) return h;
        const cs = getComputedStyle(n);
        return h + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    }

    /** A known height, or the item's estimate: the cache replaces estimates as items mount and are measured. */
    const estimate = item => s.heights.get(String(item.key)) ?? item.est ?? defaultHeight;

    function rangeHeight(from, to) {
        let h = 0;
        for (let i = from; i < to; i++) h += estimate(s.body[i]);
        return h;
    }

    function schedule() {
        if (s.raf) return;
        s.raf = requestAnimationFrame(() => {
            s.raf = 0;
            if (!host.isConnected || host.hidden || !s.windowed) return;
            draw(false);
        });
    }

    /** A skipped run: a zero-content block whose height the estimates cache describes. */
    function gapItem(gap) {
        return {
            key: gap.key,
            est: 0,
            make() {
                const n = el('div', 'win-gap');
                n.setAttribute('aria-hidden', 'true');
                return n;
            },
            update: n => { n.style.height = `${rangeHeight(gap.from, gap.to)}px`; },
        };
    }

    /**
     * Picks the mounted range from the height cache: one rAF pass over the body (the list is at most a few thousand
     * entries). `force` is a draw from paint(); a scroll draw returns early when the same range is still current.
     */
    function draw(force) {
        if (!host.isConnected || host.hidden || !s.windowed) return;
        const viewport = host.clientHeight || s.viewport || 844;
        if (viewport > 0) s.viewport = viewport;
        // Find the item carrying focus so it stays mounted even when the window has moved away from it.
        const active = activeOf();
        if (active && host.contains(active)) {
            const node = active.closest?.('[data-key]');
            const key = node?.dataset.key;
            s.focusKey = key !== undefined && s.byKey.has(key) ? key : null;
        }
        const focus = s.focusKey !== null ? s.byKey.get(s.focusKey) : undefined;
        const prefixH = s.prefix.reduce((h, item) => h + estimate(item), 0);
        const top = Math.max(0, host.scrollTop - prefixH);
        const over = Math.max(320, viewport * overscan);
        const from = Math.max(0, top - over);
        const to = top + viewport + over;
        let y = 0;
        let start = s.body.length;
        let end = 0;
        let started = false;
        for (let i = 0; i < s.body.length; i++) {
            const h = estimate(s.body[i]);
            if (!started && y + h > from) { start = i; started = true; }
            if (y < to) end = i + 1;
            y += h;
        }
        if (end < start) end = start;
        const same = !force && s.last && s.last.start === start && s.last.end === end && s.last.focus === (focus ?? null);
        if (same) { fixGaps(); return; }

        const items = [...s.prefix];
        s.gaps = [];
        const addGap = (key, a, b) => {
            if (b <= a) return;
            const gap = { key, from: a, to: b };
            s.gaps.push(gap);
            items.push(gapItem(gap));
        };
        const addBody = (a, b) => { for (let i = a; i < b; i++) items.push(s.body[i]); };
        if (focus !== undefined && focus < start) {
            // The focused item is above the window: keep it (and its focus) at its true place, with a spacer either side.
            addGap('win:gap:0', 0, focus);
            addBody(focus, focus + 1);
            addGap('win:gap:1', focus + 1, start);
            addBody(start, end);
            addGap('win:gap:2', end, s.body.length);
        } else if (focus !== undefined && focus >= end) {
            addGap('win:gap:0', 0, start);
            addBody(start, end);
            addGap('win:gap:1', end, focus);
            addBody(focus, focus + 1);
            addGap('win:gap:2', focus + 1, s.body.length);
        } else {
            addGap('win:gap:0', 0, start);
            addBody(start, end);
            addGap('win:gap:2', end, s.body.length);
        }
        s.anchorKey = start < end ? String(s.body[start].key) : (focus !== undefined ? s.focusKey : null);
        s.last = { start, end, focus: focus ?? null };
        keyed(host, items, item => item.make());
        s.elByKey.clear();
        for (const node of host.children) if (node.dataset.key !== undefined) s.elByKey.set(node.dataset.key, node);
        trimObserved();
        // Measure only nodes new to this state; a retained node is already in the cache and watched by the observer.
        for (const node of host.children) {
            const key = node.dataset.key;
            if (key === undefined || s.mounted.has(node)) continue;
            s.mounted.add(node);
            s.ro?.observe(node);
            const h = outerHeight(node);
            if (h > 0 && Math.abs((s.heights.get(key) ?? -1) - h) > 0.5) { s.heights.set(key, h); s.dirty = true; }
        }
        fixGaps();
    }

    /** Stops watching nodes the last keyed draw removed, so a rebuild does not retain them through the observer. */
    function trimObserved() {
        const live = new Set(host.children);
        for (const n of s.mounted) {
            if (live.has(n)) continue;
            s.mounted.delete(n);
            s.ro?.unobserve(n);
        }
    }

    /** Corrects the spacers from the height cache and holds the anchor item still while their heights change. */
    function fixGaps() {
        if (!s.dirty) return;
        s.dirty = false;
        const anchor = s.anchorKey !== null ? s.elByKey.get(s.anchorKey) : null;
        const before = anchor?.getBoundingClientRect().top;
        for (const gap of s.gaps) {
            const node = s.elByKey.get(gap.key);
            if (!node) continue;
            const h = rangeHeight(gap.from, gap.to);
            if (Math.abs((parseFloat(node.style.height) || 0) - h) > 0.5) node.style.height = `${h}px`;
        }
        const after = anchor?.getBoundingClientRect().top;
        if (anchor && Number.isFinite(before) && Number.isFinite(after) && Math.abs(after - before) > 0.5) {
            host.scrollTop += after - before;
        }
    }

    /** Replaces the list: `prefix` always mounted first, then `body`. Windowed only when `isWindowed`. */
    function paint(prefix, body, isWindowed) {
        s.prefix = prefix;
        s.body = body;
        s.byKey = new Map(body.map((item, i) => [String(item.key), i]));
        if (isWindowed) {
            s.windowed = true;
            draw(true);
            return;
        }
        // A small list keeps its old shape: no spacers, no scroll work.
        s.windowed = false;
        s.last = null;
        s.gaps = [];
        s.elByKey.clear();
        s.anchorKey = null;
        keyed(host, [...prefix, ...body], item => item.make());
        trimObserved();
    }

    /** Scrolls/materializes the window around a body item, then the next frame brings it into view. */
    function reveal(key) {
        const wanted = String(key);
        const i = s.byKey.get(wanted);
        if (i === undefined || !host.isConnected) return;
        if (!s.windowed) {
            s.elByKey.get(wanted)?.scrollIntoView({ block: 'nearest' });
            return;
        }
        const prefixH = s.prefix.reduce((h, item) => h + estimate(item), 0);
        const top = prefixH + rangeHeight(0, i);
        const h = estimate(s.body[i]);
        const viewport = host.clientHeight || s.viewport || 0;
        if (top < host.scrollTop) host.scrollTop = Math.max(0, top - 8);
        else if (viewport && top + h > host.scrollTop + viewport) host.scrollTop = Math.max(0, top + h - viewport + 8);
        draw(true);
        requestAnimationFrame(() => s.elByKey.get(wanted)?.scrollIntoView({ block: 'nearest' }));
    }

    /** Forgets the range (a loading/empty page or a rebuilt list); known heights stay for the next draw. */
    function reset() {
        s.prefix = [];
        s.body = [];
        s.byKey.clear();
        s.gaps = [];
        s.last = null;
        s.elByKey.clear();
        s.windowed = false;
        s.dirty = false;
        s.focusKey = null;
        s.anchorKey = null;
    }

    /** Drops the observer when the mount itself is replaced (N3a): no detuned rows or observers stay behind. */
    function dispose() {
        if (s.raf) cancelAnimationFrame(s.raf);
        s.raf = 0;
        clearTimeout(focusTimer);
        focusTimer = 0;
        host.removeEventListener('scroll', onScroll);
        host.removeEventListener('focusout', onFocusOut);
        s.ro?.disconnect();
        s.ro = null;
        s.mounted.clear();
        s.elByKey.clear();
    }

    return { state: s, paint, draw, reset, dispose, reveal, rangeHeight, estimate };
}
