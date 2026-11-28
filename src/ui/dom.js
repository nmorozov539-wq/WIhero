// Small DOM helpers and the shared overlays (LAYOUT "Sheets and toasts"): sheets from the bottom over a dimmed
// backdrop, the ☰ menu sheet, a one-line text form, and toasts, some with Undo.
import { ic, icNode } from './icons.js';
import { Html } from './html.js';
import { explainNode } from './explain-meta.js';

export { html } from './html.js';

export function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

/**
 * A button. `content` is text, or Html (an icon from ic(), or an html`` template) for markup: plain strings never
 * reach innerHTML, so book content can't inject markup through a label.
 */
export function btn(cls, content, fn, label) {
    const b = el('button', cls);
    b.type = 'button';
    if (content instanceof Html && content.icon) b.append(icNode(content.icon.name, content.icon.cls));
    else if (content instanceof Html) b.innerHTML = content.markup;
    else b.textContent = content ?? '';
    if (label) b.setAttribute('aria-label', label);
    if (fn) b.addEventListener('click', fn);
    return b;
}

/**
 * Keeps `box`'s keyed children in step with `items`: an existing key keeps its node and its listeners and is
 * updated in place, a new key gets a node from `make`, and a key no longer listed is removed. Order follows
 * `items`; the key is kept on the node's dataset. Unused nodes are dropped before placement so removing the rows at
 * the top of a window does not shift every retained node. `update` false skips an existing node's update (a scroll
 * draw keeps its rows as they are); a node made by this call is always updated, since make() only builds the shell.
 * @param {HTMLElement} box
 * @param {Array<{ key: string, update?: (node: HTMLElement) => void }>} items
 * @param {(item: object) => HTMLElement} make
 * @param {boolean} [update]
 */
export function keyed(box, items, make, update = true) {
    const old = new Map();
    for (const node of [...box.children]) {
        const key = node.dataset.key;
        if (key === undefined) { node.remove(); continue; }
        if (old.has(key)) node.remove();
        else old.set(key, node);
    }
    const wanted = new Set();
    for (const item of items) wanted.add(String(item.key));
    for (const [key, node] of old) if (!wanted.has(key)) { node.remove(); old.delete(key); }
    let at = box.firstChild;
    for (const item of items) {
        const key = String(item.key);
        let node = old.get(key);
        const fresh = !node;
        if (fresh) {
            node = make(item);
            node.dataset.key = key;
            old.set(key, node);
        }
        if (node === at) at = at.nextSibling;
        else box.insertBefore(node, at);
        if (update || fresh) item.update?.(node);
    }
}

/** An on/off switch. `fn(next)` is called with the new value; the caller redraws. */
/**
 * Scrolls `node` to the top of the nearest scrolling box that holds it, and only that box. scrollIntoView also
 * scrolls every box around it, ST's own included, which shifts the whole panel up and leaves it stuck there.
 */
export function scrollToTop(node, smooth = false) {
    let box = node?.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    if (!box) return;
    const top = box.scrollTop + node.getBoundingClientRect().top - box.getBoundingClientRect().top;
    box.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
}

export function swEl(on, fn, label = 'On', explain = null) {
    const s = el('button', `switch${on ? ' on' : ''}`);
    s.type = 'button';
    s.setAttribute('role', 'switch');
    s.setAttribute('aria-checked', String(!!on));
    s.setAttribute('aria-label', label);
    s.addEventListener('click', e => { e.stopPropagation(); fn(!s.classList.contains('on')); });
    if (explain) explainNode(s, explain.key ?? 'blocked.setting', explain);
    return s;
}

/** Tap and long press (480 ms) on a row. Taps on its own buttons and switches are left to them. */
export function pressable(node, onTap, onLong) {
    let timer = null;
    let long = false;
    let sx = 0;
    let sy = 0;
    const end = () => { clearTimeout(timer); timer = null; node.classList.remove('pressing'); };
    node.addEventListener('pointerdown', e => {
        if (e.button) return;
        if (e.target.closest('button, .check')) return;
        long = false; sx = e.clientX; sy = e.clientY;
        node.classList.add('pressing');
        timer = setTimeout(() => { long = true; node.classList.remove('pressing'); onLong?.(); }, 480);
    });
    node.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) end(); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(type, end);
    node.addEventListener('click', e => {
        if (long) { e.preventDefault(); long = false; return; }
        if (e.target.closest('button:not(.rowtap), .check')) return;
        onTap(e);
    });
    node.addEventListener('contextmenu', e => { if (onLong) e.preventDefault(); });
}

/**
 * Tap and long press (480 ms) for a list of marked rows, delegated to `root`: one set of listeners for the whole
 * list. The row is the nearest ancestor with `data-press`; `resolve(row)` is asked at event time and returns
 * `{ onTap, onLong }`. Buttons and checks keep their own clicks, as in pressable(), and a long press swallows the
 * click that ends it.
 */
export function delegatePress(root, resolve) {
    let node = null;
    let timer = null;
    let long = false;
    let sx = 0;
    let sy = 0;
    const end = () => { clearTimeout(timer); timer = null; node?.classList.remove('pressing'); };
    root.addEventListener('pointerdown', e => {
        if (e.button) return;
        if (e.target.closest('button, .check')) return;
        node = e.target.closest('[data-press]');
        if (!node || !root.contains(node) || !resolve(node)) { node = null; return; }
        long = false; sx = e.clientX; sy = e.clientY;
        node.classList.add('pressing');
        timer = setTimeout(() => {
            long = true;
            node?.classList.remove('pressing');
            resolve(node)?.onLong?.();
        }, 480);
    });
    root.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) end(); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) root.addEventListener(type, end);
    root.addEventListener('click', e => {
        if (long) { e.preventDefault(); long = false; return; }
        if (e.target.closest('button:not(.rowtap), .check')) return;
        const it = e.target.closest('[data-press]');
        if (it && root.contains(it)) resolve(it)?.onTap(e);
    });
    root.addEventListener('contextmenu', e => {
        const it = e.target.closest('[data-press]');
        if (it && resolve(it)?.onLong) e.preventDefault();
    });
}

/** Long press (480 ms) on any node, a sheet row included; the tap that ends a long press goes nowhere. */
export function longPress(node, fn) {
    let timer = null;
    let fired = false;
    let sx = 0;
    let sy = 0;
    const end = () => { clearTimeout(timer); timer = null; node.classList.remove('pressing'); };
    node.addEventListener('pointerdown', e => {
        if (e.button) return;
        fired = false; sx = e.clientX; sy = e.clientY;
        node.classList.add('pressing');
        timer = setTimeout(() => { fired = true; node.classList.remove('pressing'); fn(); }, 480);
    });
    node.addEventListener('pointermove', e => { if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 8) end(); });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) node.addEventListener(type, end);
    node.addEventListener('click', e => { if (fired) { fired = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);
    node.addEventListener('contextmenu', e => e.preventDefault());
}

/**
 * The overlay layer of one WI Hero root.
 * @param {HTMLElement} layer where sheets go
 * @param {HTMLElement} toastBox the toast element
 */
export function createLayer(layer, toastBox) {
    const closers = [];
    /**
     * Desktop (LAYOUT "Desktop: normal mode"): every sheet opens as a menu at the control that asked for it. The
     * control is the last one pressed (or the point of a right-click); `pop.desk` is set by the app.
     */
    const pop = { desk: false, at: null };
    const root = layer.getRootNode?.() ?? document;
    const remember = e => { pop.at = { el: e.target, x: e.clientX, y: e.clientY, t: performance.now(), menu: e.type === 'contextmenu' }; };
    root.addEventListener('pointerdown', remember, true);
    root.addEventListener('contextmenu', remember, true);

    function close() {
        layer.innerHTML = '';
        while (closers.length) closers.pop()();
        api.onClose?.();
    }
    const isOpen = () => layer.children.length > 0;

    function scrim(clear) {
        close();
        const s = el('div', `scrim${clear ? ' clear' : ''}`);
        s.addEventListener('click', close);
        explainNode(s, 'nav.scrim');
        layer.append(s);
        return s;
    }

    /**
     * A sheet from the bottom (or, with `menu`, the ☰ menu under the top row).
     * @param {string|null} title
     * @param {(sheet: HTMLElement) => void} build
     * @param {{ menu?: boolean, help?: string, cls?: string, at?: Element, side?: 'right', onClose?: () => void }} [opts]
     *   `at` opens an anchored popover at that control on every layout (a phone dropdown as well as a desktop menu).
     *   `side: 'right'` opens beside it when there is room, otherwise below as usual.
     */
    function sheet(title, build, opts = {}) {
        const anchor = pop.desk || opts.at ? anchorRect(opts.at) : null;
        scrim(opts.menu || !!anchor);
        const sh = el('div', `sheet${opts.menu ? ' menu' : ''}${anchor ? ' pop' : ''}${opts.cls ? ` ${opts.cls}` : ''}`);
        sh.setAttribute('role', anchor ? 'menu' : 'dialog');
        if (!opts.menu && !anchor) sh.append(el('div', 'grab'));
        if (title) sh.append(el('h2', '', title));
        if (opts.help) sh.append(el('p', 'help', opts.help));
        build(sh);
        layer.append(sh);
        if (anchor) place(sh, { ...anchor, side: opts.side });
        if (opts.onClose) closers.push(opts.onClose);
        // Explain mode never puts the cursor or a keyboard into a sheet's first field.
        if (!api.explainActive?.()) sh.querySelector('button, input')?.focus({ preventScroll: true });
        return sh;
    }

    /** Where a desktop menu opens: under the control just pressed, at a right-click's point, or near the top. */
    function anchorRect(at) {
        if (at?.getBoundingClientRect) { const r = at.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4, above: r.top - 4, right: r.right, top: r.top }; }
        if (at && Number.isFinite(at.x)) return { x: at.x, y: at.y, above: at.y };
        const a = pop.at;
        if (!a || performance.now() - a.t > 1500) return { center: true };
        if (a.menu) return { x: a.x, y: a.y, above: a.y };
        // Canvas backgrounds/worlds can be much larger than the viewport (and transformed by pan/zoom).
        // Only controls have meaningful menu edges; elsewhere use the actual pointer position.
        const c = a.el?.closest?.('button, [role="button"], .opt, .tile, .lrow, input, select');
        if (!c?.isConnected || !c.getBoundingClientRect) return { x: a.x, y: a.y, above: a.y };
        const r = c.getBoundingClientRect();
        // A row inside another menu: the new menu opens beside it.
        if (c.closest?.('.sheet.pop')) return { x: r.left + 24, y: r.bottom + 2, above: r.top - 2 };
        return { x: r.left, y: r.bottom + 4, above: r.top - 4, right: r.right, top: r.top };
    }
    function place(sh, a) {
        const box = layer.getBoundingClientRect();
        const w = sh.offsetWidth;
        const h = sh.offsetHeight;
        // A menu asked to open to the right of its control (the greeting Pick) does so when there is room; otherwise
        // it falls back to the usual below-the-control placement.
        if (a.side === 'right' && a.right !== undefined) {
            const left = a.right - box.left + 4;
            if (left + w <= box.width - 8) {
                sh.style.left = `${left}px`;
                sh.style.top = `${Math.max(8, (a.top ?? a.above) - box.top)}px`;
                sh.style.maxHeight = `${Math.max(160, box.height - Math.max(8, (a.top ?? a.above) - box.top) - 8)}px`;
                return;
            }
        }
        if (a.center) {
            Object.assign(sh.style, { left: `${Math.max(8, (box.width - w) / 2)}px`, top: `${Math.min(80, box.height / 6)}px` });
            sh.style.maxHeight = `${box.height - 96}px`;
            return;
        }
        let x = a.x - box.left;
        // A control at the right edge (the tab row's ×, a row's ⋯): the menu lines up with its right side.
        if (a.right !== undefined && x + w > box.width - 8) x = a.right - box.left - w;
        x = Math.max(8, Math.min(x, box.width - w - 8));
        const below = box.bottom - a.y - 8;
        const above = a.above - box.top - 8;
        const up = h > below && above > below;
        const room = up ? above : below;
        sh.style.maxHeight = `${Math.max(160, room)}px`;
        sh.style.left = `${x}px`;
        sh.style.top = up ? `${Math.max(8, a.above - box.top - Math.min(h, room))}px` : `${a.y - box.top}px`;
    }

    /**
     * A sheet row: label (and a line under it), and its current value at the right. `explain` gives it explain-mode
     * metadata: { key, text, title, navigate, guide, long }. A row without it is set aside in explain mode.
     */
    function opt(label, fn, { val, sub, cur, dot, icon, cls, danger, explain } = {}) {
        const o = el('button', `opt${cur ? ' cur' : ''}${danger ? ' danger' : ''}${cls ? ` ${cls}` : ''}`);
        o.type = 'button';
        if (dot) { const d = el('i', 'cdot'); d.style.background = dot; o.append(d); }
        if (icon) o.insertAdjacentHTML('beforeend', ic(icon));
        const g = el('span', 'grow');
        g.append(el('span', 'lab', label));
        if (sub) g.append(el('small', '', sub));
        o.append(g);
        if (val !== undefined && val !== null) o.append(el('span', 'val', val));
        o.addEventListener('click', fn);
        if (explain) explainNode(o, explain.key ?? 'nav.open', explain);
        return o;
    }

    /**
     * A small form with one text box.
     * @param {object} o { title, placeholder, value, ok, type, check(value) → error text or null, done(value), select }
     */
    function askText({ title, placeholder = '', value = '', ok = 'Save', type = 'text', check, done, allowEmpty = false }) {
        scrim();
        const d = el('div', 'dlg');
        d.setAttribute('role', 'dialog');
        d.append(el('h2', '', title));
        const input = el('input');
        input.type = type;
        input.placeholder = placeholder;
        input.value = value ?? '';
        explainNode(input, 'blocked.input', { text: 'Types into this field.' });
        const err = el('div', 'err');
        const row = el('div', 'row');
        const go = () => {
            const v = input.value.trim();
            if (!v && !allowEmpty) return;
            const problem = check?.(v);
            if (problem) { err.textContent = problem; return; }
            close();
            done(v);
        };
        const cancel = btn('', 'Cancel', close);
        explainNode(cancel, 'nav.close', { text: 'Closes this without saving anything.' });
        const confirm = btn('pri', ok, go);
        explainNode(confirm, 'blocked.confirm', { title: ok, text: 'This would save the change.' });
        row.append(cancel, confirm);
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        d.append(input, err, row);
        layer.append(d);
        if (!api.explainActive?.()) setTimeout(() => { input.focus(); input.select(); }, 0);
        return d;
    }

    // Toasts. One at a time; a toast with Undo that is replaced or runs out calls its onEnd (the delayed delete).
    let timer = null;
    let current = null;
    function endToast(undone) {
        clearTimeout(timer);
        timer = null;
        toastBox.classList.remove('show', 'act');
        const t = current;
        current = null;
        if (t && !undone) t.onEnd?.();
    }

    /**
     * @param {string} text
     * @param {{ action?: [string, () => void], onEnd?: () => void, ms?: number }} [o]
     */
    function toast(text, o = {}) {
        if (current) endToast(false);
        toastBox.innerHTML = '';
        toastBox.append(el('span', '', text));
        current = { onEnd: o.onEnd };
        const ms = o.ms ?? (o.action ? 5000 : 2200);
        if (o.action) {
            const [label, fn] = o.action;
            toastBox.append(btn('', label, () => { endToast(true); fn(); }));
            toastBox.classList.add('act');
            // The outline drains around the toast while Undo is still possible.
            const ns = 'http://www.w3.org/2000/svg';
            const svg = document.createElementNS(ns, 'svg');
            svg.setAttribute('class', 'ttimer');
            svg.setAttribute('aria-hidden', 'true');
            const r = document.createElementNS(ns, 'rect');
            r.setAttribute('pathLength', '100');
            r.style.animationDuration = `${ms}ms`;
            svg.append(r);
            toastBox.append(svg);
        }
        toastBox.classList.add('show');
        timer = setTimeout(() => endToast(false), ms);
    }

    /** Ends a waiting Undo toast now, so its delayed change happens (when WI Hero is closed, for example). */
    const flushToast = () => { if (current) endToast(false); };

    const api = { sheet, opt, askText, toast, flushToast, close, isOpen, scrim, layer, pop, onClose: null, explainActive: () => false };
    /** Terminal teardown: drops the open layer, its waiting toast and the two page-level remember listeners. */
    function dispose() {
        clearTimeout(timer);
        timer = null;
        current = null;
        closers.length = 0;
        layer.innerHTML = '';
        toastBox.innerHTML = '';
        root.removeEventListener('pointerdown', remember, true);
        root.removeEventListener('contextmenu', remember, true);
        api.onClose = null;
    }
    api.dispose = dispose;
    return api;
}

/**
 * Problems and warnings counted apart (a warning only points at something odd): "1 warning",
 * "2 problems · 1 warning". `menu` gives the ☰ menu's label: "Problems (2)", "Warnings (1)", "Problems (2) · 1 warning".
 */
export function issueText(issues, { menu = false } = {}) {
    const w = issues.filter(i => i.warning).length;
    const p = issues.length - w;
    const ws = `${w} warning${w === 1 ? '' : 's'}`;
    if (menu) return p ? `Problems (${p})${w ? ` · ${ws}` : ''}` : `Warnings (${w})`;
    return [p ? `${p} problem${p === 1 ? '' : 's'}` : '', w ? ws : ''].filter(Boolean).join(' · ');
}
