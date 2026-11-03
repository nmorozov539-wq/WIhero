// Small DOM helpers and the shared overlays (LAYOUT "Sheets and toasts"): sheets from the bottom over a dimmed
// backdrop, the ⌄ menu sheet, a one-line text form, and toasts, some with Undo.
import { ic } from './icons.js';

export function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
}

export function btn(cls, html, fn, label) {
    const b = el('button', cls);
    b.type = 'button';
    b.innerHTML = html;
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
     * A sheet from the bottom (or, with `menu`, the ⌄ menu under the top row).
     * @param {string|null} title
     * @param {(sheet: HTMLElement) => void} build
     * @param {{ menu?: boolean, help?: string, cls?: string, onClose?: () => void }} [opts]
     */
    function sheet(title, build, opts = {}) {
        scrim(opts.menu);
        const sh = el('div', `sheet${opts.menu ? ' menu' : ''}${opts.cls ? ` ${opts.cls}` : ''}`);
        sh.setAttribute('role', 'dialog');
        if (!opts.menu) sh.append(el('div', 'grab'));
        if (title) sh.append(el('h2', '', title));
        if (opts.help) sh.append(el('p', 'help', opts.help));
        build(sh);
        layer.append(sh);
        if (opts.onClose) closers.push(opts.onClose);
        sh.querySelector('button, input')?.focus({ preventScroll: true });
        return sh;
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

    return { sheet, opt, askText, toast, flushToast, close, isOpen, scrim, layer };
}
