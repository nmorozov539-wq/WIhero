// Small DOM helpers and the shared overlays (LAYOUT "Sheets and toasts"): sheets from the bottom over a dimmed
// backdrop, the ☰ menu sheet, a one-line text form, and toasts, some with Undo.
import { ic } from './icons.js';
import { Html } from './html.js';

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
    if (content instanceof Html) b.innerHTML = content.markup;
    else b.textContent = content ?? '';
    if (label) b.setAttribute('aria-label', label);
    if (fn) b.addEventListener('click', fn);
    return b;
}

/** An on/off switch. `fn(next)` is called with the new value; the caller redraws. */
export function swEl(on, fn, label = 'On') {
    const s = el('button', `switch${on ? ' on' : ''}`);
    s.type = 'button';
    s.setAttribute('role', 'switch');
    s.setAttribute('aria-checked', String(!!on));
    s.setAttribute('aria-label', label);
    s.addEventListener('click', e => { e.stopPropagation(); fn(!s.classList.contains('on')); });
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
    }
    const isOpen = () => layer.children.length > 0;

    function scrim(clear) {
        close();
        const s = el('div', `scrim${clear ? ' clear' : ''}`);
        s.addEventListener('click', close);
        layer.append(s);
        return s;
    }

    /**
     * A sheet from the bottom (or, with `menu`, the ☰ menu under the top row).
     * @param {string|null} title
     * @param {(sheet: HTMLElement) => void} build
     * @param {{ menu?: boolean, help?: string, cls?: string, onClose?: () => void }} [opts]
     */
    function sheet(title, build, opts = {}) {
        const anchor = pop.desk ? anchorRect(opts.at) : null;
        scrim(opts.menu || !!anchor);
        const sh = el('div', `sheet${opts.menu ? ' menu' : ''}${anchor ? ' pop' : ''}${opts.cls ? ` ${opts.cls}` : ''}`);
        sh.setAttribute('role', anchor ? 'menu' : 'dialog');
        if (!opts.menu && !anchor) sh.append(el('div', 'grab'));
        if (title) sh.append(el('h2', '', title));
        if (opts.help) sh.append(el('p', 'help', opts.help));
        build(sh);
        layer.append(sh);
        if (anchor) place(sh, anchor);
        if (opts.onClose) closers.push(opts.onClose);
        sh.querySelector('button, input')?.focus({ preventScroll: true });
        return sh;
    }

    /** Where a desktop menu opens: under the control just pressed, at a right-click's point, or near the top. */
    function anchorRect(at) {
        if (at?.getBoundingClientRect) { const r = at.getBoundingClientRect(); return { x: r.left, y: r.bottom + 4, above: r.top - 4 }; }
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
        return { x: r.left, y: r.bottom + 4, above: r.top - 4, right: r.right };
    }
    function place(sh, a) {
        const box = layer.getBoundingClientRect();
        const w = sh.offsetWidth;
        const h = sh.offsetHeight;
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

    /** A sheet row: label (and a line under it), and its current value at the right. */
    function opt(label, fn, { val, sub, cur, dot, icon, cls, danger } = {}) {
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
        row.append(btn('', 'Cancel', close), btn('pri', ok, go));
        input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
        d.append(input, err, row);
        layer.append(d);
        setTimeout(() => { input.focus(); input.select(); }, 0);
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

    return { sheet, opt, askText, toast, flushToast, close, isOpen, scrim, layer, pop };
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
