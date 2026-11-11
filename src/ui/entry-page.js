// The entry page (LAYOUT "Entry page"), as normal mode shows it: title, book line, strategy and on/off, key words
// and the secondary condition, the read-only Story logic, Parameters, and Content. Saving is automatic.
import { btn, html, el, swEl } from './dom.js';
import { ic } from './icons.js';
import {
    LOGIC, PARAMS, STRATEGY_HELP, filterChoices, paramChanged, STRATEGY_NAME, logicName, paramSummary, paramText, paramValue, setStrategy, strategyOf, tokenGuess,
} from './data.js';
import { FAMILY_COLOR, logicSummary } from './logic-text.js';
import { slotsOf, valueLine } from './tracker-ui.js';
import { rawConfig as configOf } from '../engine/model.js';

const STRATEGY_COLOR = { keys: 'var(--s-key)', perm: 'var(--s-perm)', vec: 'var(--s-vec)', off: 'var(--s-off)' };
export const strategyColor = e => STRATEGY_COLOR[strategyOf(e)];

/** The strategy dot; vectorized is a chain icon, so shape carries it too (VISUAL 6.1). */
/** Remove condition: the second key words and the logic go (Ctrl+Z takes it back). */
function removeCondition(o, e, ui) {
    ui.condition = false;
    o.change(x => { x.keysecondary = []; x.selectiveLogic = 0; });
    o.layer.toast('Condition removed');
}

export function sdot(e) {
    const s = strategyOf(e);
    const d = el('i', `sdot ${s}`);
    if (s === 'vec') d.innerHTML = ic('chain');
    return d;
}

/**
 * Asks for a parameter's new value: a sheet of choices, a switch, or a number or text box.
 * @param {object} layer createLayer's result
 * @param {object} p a PARAMS row
 * @param {*} current the current value (or MIXED)
 * @param {(value) => void} set
 */
export function editParam(layer, p, current, set) {
    if (p.type === 'multi') {
        // Several picks, none meaning all: the sheet stays open, each row a switch.
        let cur = [...(current ?? [])];
        layer.sheet(p.label, sh => {
            const draw = () => {
                sh.querySelectorAll('.opt').forEach(n => n.remove());
                for (const [value, label] of p.options) {
                    sh.append(layer.opt(label, () => {
                        cur = cur.includes(value) ? cur.filter(x => x !== value) : [...cur, value];
                        set(cur);
                        draw();
                    }, { cur: cur.includes(value) }));
                }
            };
            draw();
        }, { help: `None picked: ${p.none.toLowerCase()} of them.` });
        return;
    }
    if (p.type === 'chars') { editCharacters(layer, p, current, set); return; }
    if (p.type === 'enum') {
        layer.sheet(p.label, sh => {
            for (const [value, label] of p.options) {
                sh.append(layer.opt(label, () => { layer.close(); set(value); }, { cur: value === current || (value !== null && current !== null && String(value) === String(current)) }));
            }
        });
    } else if (p.type === 'bool') {
        set(!current);
    } else {
        const isNum = p.type === 'int';
        layer.askText({
            title: p.label,
            placeholder: isNum ? (p.optional ? 'Use global' : String(p.def)) : 'None',
            value: current === null || current === undefined || typeof current === 'symbol' ? '' : String(current),
            type: isNum ? 'number' : 'text',
            allowEmpty: true,
            check: v => {
                if (!isNum || v === '') return null;
                const n = Number(v);
                if (!Number.isInteger(n)) return 'Type a whole number';
                if (p.min !== undefined && n < p.min) return `At least ${p.min}`;
                if (p.max !== undefined && n > p.max) return `At most ${p.max}`;
                return null;
            },
            done: v => set(isNum ? (v === '' ? (p.optional ? null : p.def) : Number(v)) : v),
        });
    }
}

/** The character filter: Only these or All but these, then characters and tags to pick. */
function editCharacters(layer, p, current, set) {
    let v = { isExclude: !!current?.isExclude, names: [...(current?.names ?? [])], tags: [...(current?.tags ?? [])] };
    const { chars, tags } = filterChoices.get();
    layer.sheet(p.label, sh => {
        const draw = () => {
            sh.querySelectorAll('.opt, .lbl').forEach(n => n.remove());
            const any = !v.names.length && !v.tags.length;
            sh.append(layer.opt('Any character', () => { v = { isExclude: false, names: [], tags: [] }; set(null); draw(); }, { cur: any }));
            sh.append(layer.opt('Only the ones picked', () => { v.isExclude = false; if (!any) set({ ...v }); draw(); }, { cur: !any && !v.isExclude }));
            sh.append(layer.opt('All but the ones picked', () => { v.isExclude = true; if (!any) set({ ...v }); draw(); }, { cur: !any && v.isExclude }));
            const pick = (list, field, label, prefix) => {
                if (!list.length) return;
                sh.append(el('div', 'lbl', label));
                for (const c of list) {
                    sh.append(layer.opt(`${prefix}${c.name}`, () => {
                        v[field] = v[field].includes(c.key) ? v[field].filter(x => x !== c.key) : [...v[field], c.key];
                        set(v.names.length || v.tags.length ? { ...v } : null);
                        draw();
                    }, { cur: v[field].includes(c.key) }));
                }
            };
            pick(chars, 'names', 'Characters', '');
            pick(tags, 'tags', 'Tags', '#');
        };
        draw();
    }, { help: 'Which characters this entry can fire for. Any character, unless some are picked.' });
}

/**
 * ST's chance and timing settings still apply on top of story pieces (CONCEPTS "ST's own rules still apply on top").
 * Set on an entry that has pieces, each gets one line saying how it can work against them.
 */
const STORY_PARAM_NOTE = {
    probability: 'With story pieces: a failed roll skips it even when nothing holds it back.',
    sticky: 'With story pieces: a running sticky finishes even after this entry closes.',
    cooldown: 'With story pieces: cooldown can hold it back while it is open or glued.',
    delay: 'With story pieces: ST\'s delay counts chat messages, not story rules. For "close later", use a wait.',
};
/** The warning for a parameter, or null: only on an entry with story pieces, and only when the value is set. */
export function storyParamNote(e, p, pieced) {
    return pieced && STORY_PARAM_NOTE[p.field] && paramChanged(e, p) ? STORY_PARAM_NOTE[p.field] : null;
}

/** A row of the Parameters list. */
export function paramRow(p, text, changed, onTap) {
    const r = el('button', 'prm');
    r.type = 'button';
    r.append(el('span', '', p.label), el('em', changed ? 'ch' : '', text));
    r.addEventListener('click', onTap);
    return r;
}

/**
 * Draws the entry page into `main`.
 * @param {HTMLElement} main
 * @param {object} o
 *   { entry, bookName, folder, layer, ui (folds), problems: string[], lines, closed: { by, reopen } | null,
 *     change(fn, quiet), setParam(p, value), up(), drawer(), menu(), retitle(), tokens(text) → Promise<number>, fresh,
 *     clash(key) → titles of the other entries this key word also fires }
 */
export function renderEntryPage(main, o) {
    const { entry: e, layer, ui } = o;
    const D = o.desk ?? null;
    const v = el('div', 'view');
    main.append(v);
    if (D) {
        // Desktop: a thin line with the book and folder as a breadcrumb, then ∧ ∨ and ⋮ (LAYOUT "Book (two panes)").
        const top = el('div', 'en-line');
        if (D.panel) { const b = btn('lbtn', ic('back', 's'), D.panel, 'Back to the entries'); b.title = 'Entries'; top.append(b); }
        const crumbs = el('div', 'crumbs');
        crumbs.insertAdjacentHTML('beforeend', ic('book', 's'));
        D.crumbs.forEach((c, i) => {
            if (i) crumbs.append(el('span', 'sl', '/'));
            const b = c.go ? btn('crumb', '', c.go) : el('span', 'crumb');
            b.textContent = c.label;
            crumbs.append(b);
        });
        top.append(crumbs);
        if (D.prev !== undefined) {
            const up = btn('lbtn', ic('up', 's'), D.prev, 'Previous entry (Alt ↑)');
            const dn = btn('lbtn', ic('down', 's'), D.next, 'Next entry (Alt ↓)');
            up.disabled = !D.prev;
            dn.disabled = !D.next;
            top.append(up, dn);
        }
        if (D.showOnCanvas) top.append(btn('linkish', 'Show on canvas ›', D.showOnCanvas));
        top.append(btn('lbtn', ic('more', 's'), o.menu, 'Entry actions'));
        v.append(top);
    } else {
        const top = el('div', 'en-top');
        top.append(btn('round', ic('back'), o.up, o.hero ? 'Close the entry tab' : 'Up to the book'), el('div', 'sp'));
        const pill = el('div', 'pill');
        pill.append(btn('round', ic('drawer'), o.drawer, 'Entries in this book'), btn('round', ic('more'), o.menu, 'Entry actions'));
        top.append(pill);
        v.append(top);
    }

    const en = el('div', `en${e.disable ? ' off' : ''}`);
    v.append(en);

    const h1 = el('h1', '', e.comment ?? '');
    h1.contentEditable = 'true';
    h1.spellcheck = false;
    h1.setAttribute('aria-label', 'Entry name');
    h1.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); h1.blur(); } });
    h1.addEventListener('input', () => o.change(x => { x.comment = h1.textContent.trim(); }, true));
    h1.addEventListener('blur', () => { h1.textContent = e.comment ?? ''; o.retitle(); });
    en.append(h1);

    if (!D) {
        const bl = btn('bookline', html`${ic('book', 's')}<span></span>`, o.up, 'Up to the book');
        bl.querySelector('span').textContent = o.bookName + (o.folder ? ` · ${o.folder}` : '');
        en.append(bl);
    }

    // At a glance: whether the entry has story pieces, and whether other entries' pieces point at it.
    const n = o.lines.length;
    const inc = o.incoming ?? [];
    const story = el('button', 'storychip on');
    story.type = 'button';
    story.hidden = !n && !inc.length; // nothing to say: no chip
    story.innerHTML = ic('canvas', 's');
    story.append(el('span', '', n ? storyHeadline(o.lines) : `Pointed at by ${inc.length === 1 ? inc[0] : `${inc.length} entries`}`));
    story.title = inc.length ? `Pointed at by: ${inc.join(', ')}` : '';
    story.addEventListener('click', () => {
        if (D && n) {
            // Desktop: the chip opens the Story logic section and scrolls to it.
            if (!ui.logic && !o.hero) { ui.logic = true; o.redraw(); }
            requestAnimationFrame(() => main.querySelector('.disc.logich')?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
            return;
        }
        if (n && !o.hero && !ui.logic) { ui.logic = true; o.redraw(); }
        else if (o.showOnCanvas) o.showOnCanvas();
    });
    en.append(story);

    if (o.problems.length) {
        const pr = el('div', 'prob');
        pr.innerHTML = ic('alert', 's');
        pr.append(el('span', '', o.problems.join('. ')));
        en.append(pr);
    }
    if (o.warnings?.length) {
        const pw = el('div', 'prob warn');
        pw.innerHTML = ic('alert', 's');
        pw.append(el('span', '', o.warnings.join('. ')));
        en.append(pw);
    }

    if (D) { deskFields(en, o, main); } else {
    // Strategy line, with the on/off switch at its right end.
    const sr = el('div', 'srow');
    const th = el('button', 'thin');
    th.type = 'button';
    th.append(sdot(e), el('span', '', 'Strategy:'), el('b', '', STRATEGY_NAME[e.constant ? 'perm' : e.vectorized ? 'vec' : 'keys']), el('span', 'car', '▾'));
    th.addEventListener('click', () => layer.sheet('Strategy', sh => {
        const cur = e.constant ? 'perm' : e.vectorized ? 'vec' : 'keys';
        for (const k of ['keys', 'perm', 'vec']) {
            sh.append(layer.opt(STRATEGY_NAME[k], () => { layer.close(); o.change(x => setStrategy(x, k)); }, { cur: cur === k, dot: STRATEGY_COLOR[k], sub: STRATEGY_HELP[k] }));
        }
    }));
    sr.append(th, swEl(!e.disable, on => o.change(x => { x.disable = !on; }), 'Entry on'));
    en.append(sr);

    if (!e.constant) {
        en.append(keyBox(e.key ?? [], 'Key words, separated by commas', list => o.change(x => { x.key = list; }), o.clash), clashNote(e.key, o.clash));
        const second = e.keysecondary ?? [];
        if (second.length || ui.condition) {
            const cl = el('div', 'condline');
            const lt = el('button', 'thin');
            lt.type = 'button';
            lt.append(el('b', '', logicName(e.selectiveLogic)), el('span', 'car', '▾'));
            lt.addEventListener('click', () => layer.sheet('Condition', sh => {
                for (const [k, t] of LOGIC) sh.append(layer.opt(t, () => { layer.close(); o.change(x => { x.selectiveLogic = k; x.selective = true; }); }, { cur: Number(e.selectiveLogic ?? 0) === k }));
                sh.append(layer.opt('Remove condition', () => { layer.close(); removeCondition(o, e, ui); }, { icon: 'trash' }));
            }));
            cl.append(lt);
            en.append(cl, keyBox(second, 'Second key words', list => o.change(x => { x.keysecondary = list; x.selective = true; })));
        } else {
            const ac = btn('linkish', html`${ic('plus', 's')} Add condition`, () => {
                ui.condition = true;
                // A key word box still focused (a tap doesn't always take focus) holds back the redraw that shows the
                // condition: let it go first, then draw.
                main.getRootNode().activeElement?.blur?.();
                o.change(x => { x.selective = true; x.selectiveLogic ??= 0; });
                o.redraw();
                setTimeout(() => main.querySelectorAll('.kbox')[1]?.click(), 0);
            });
            // Pressing it would blur a focused key word box, whose commit redraws the page under the press, and the
            // click then lands on nothing. Keep the focus until the click, which lets it go itself.
            ac.addEventListener('mousedown', e => e.preventDefault());
            en.append(ac);
        }
    }
    }

    // Story logic: read-only here; folded in normal mode, always open in Hero mode. Hero shows it before the
    // Parameters; Normal mode puts it after the Content, where the text a regular user came for comes first.
    const storyLogic = () => {
    if (!o.lines.length) return;
    {
        const open = o.hero || ui.logic;
        const d = el('button', `disc logich${open ? ' open' : ''}`);
        d.type = 'button';
        d.innerHTML = `${ic('right', 'chev')}<h2>Story logic</h2>`;
        if (!open) d.append(el('span', 'sum', logicSummary(o.lines)));
        if (o.hero) d.classList.add('fixed');
        else d.addEventListener('click', () => { ui.logic = !ui.logic; o.redraw(); });
        en.append(d);
        if (open) {
            const box = el('div', 'logic');
            for (const line of o.lines) {
                const r = el('div', 'hl');
                const i = el('i');
                i.style.background = FAMILY_COLOR[line.family];
                const t = el('div');
                t.append(el('b', '', line.label), el('span', '', line.text));
                r.append(i, t);
                box.append(r);
            }
            if (o.closed) {
                const r = el('div', 'closedline');
                r.append(el('span', '', 'Closed in this chat by '), el('em', '', o.closed.by));
                r.append(btn('linkish acc', 'Reopen', o.closed.reopen));
                box.append(r);
            }
            const links = el('div', 'links');
            if (o.hero) {
                links.append(btn('linkish', html`${ic('canvas', 's')} Show on canvas`, o.showOnCanvas), btn('linkish', html`${ic('code', 's')} Data`, o.data));
            } else {
                links.append(btn('linkish', D ? 'Edit in Hero mode ›' : 'Open in Hero mode ›', o.openInHero));
            }
            box.append(links);
            en.append(box);
        }
    }
    };
    if (o.hero) storyLogic();

    // Parameters, in groups.
    const pd = el('button', `disc${ui.params ? ' open' : ''}`);
    pd.type = 'button';
    pd.innerHTML = `${ic('right', 'chev')}<h2>Parameters</h2>`;
    pd.append(el('span', 'sum', paramSummary(e)));
    pd.addEventListener('click', () => { ui.params = !ui.params; o.redraw(); });
    en.append(pd);
    // Story pieces on this entry: Probability, Sticky, Cooldown and Delay get a warning line when set.
    const pieced = !!o.lines?.length;
    if (ui.params && D) en.append(paramGrid(e, (p, x) => o.setParam(p, x), { layer, note: p => storyParamNote(e, p, pieced) }));
    else if (ui.params) {
        for (const [group, list] of PARAMS) {
            en.append(el('div', 'plbl', group));
            for (const p of list) {
                if (p.when && !p.when(e)) continue;
                const value = paramValue(e, p);
                const changed = paramChanged(e, p);
                en.append(paramRow(p, paramText(e, p), changed, () => editParam(layer, p, value, x => o.setParam(p, x))));
                const note = storyParamNote(e, p, pieced);
                if (note) en.append(el('p', 'pnote', note));
            }
        }
    }

    // Content. In Hero mode an entry with masks gets a chip per version (D15): Main · mask · …
    const masks = o.hero ? (o.masks ?? []) : [];
    const version = masks.find(m => m.name === o.mask) ?? null;
    const text0 = version ? version.content : (e.content ?? '');
    const ch = el('div', 'content-h');
    const tk = el('small', '', `${tokenGuess(text0)} tokens`);
    ch.append(el('h2', '', 'Content'), tk);
    en.append(ch);
    if (masks.length) {
        const row = el('div', 'mchips');
        for (const m of [{ name: null, label: 'Main' }, ...masks.map(x => ({ name: x.name, label: x.name }))]) {
            const b = btn(`mchip${(version?.name ?? null) === m.name ? ' on' : ''}`, '', () => o.setMask(m.name), m.name ? `Mask ${m.label}` : 'Main text');
            b.append(el('span', '', m.label));
            if ((o.activeMask ?? null) === m.name && o.chatOpen) { const dot = el('i', 'mdot'); dot.title = 'Active in the open chat'; b.append(dot); }
            row.append(b);
        }
        en.append(row);
    }
    // Trackers (TRACKERS 2.3): the value the model wrote in the open chat, with Edit and Clear, in both modes.
    if (o.tracker) {
        const written = slotsOf(configOf(e) ?? {}).filter(sl => sl.written && (o.hero ? (version?.name ?? null) === sl.mask : true));
        if (written.length) {
            const box = el('div', 'trkbox');
            for (const sl of written) {
                const before = box.childElementCount;
                valueLine(box, { layer, tracker: o.tracker }, sl.mask);
                if (box.childElementCount > before && written.length > 1) box.lastChild.querySelector('b').textContent = `${sl.mask ?? 'Main'} in this chat`;
            }
            if (!box.childElementCount) box.append(el('p', 'phelp', 'Written by the model. Open a chat that uses this book to see its value.'));
            else box.append(el('p', 'phelp', 'Written by the model. The text below is the start value, used until a value is written.'));
            en.append(box);
        }
    }
    const count = text => o.tokens(text).then(n => { if (typeof n === 'number') tk.textContent = `${n} tokens`; }).catch(() => {});
    let countTimer = null;
    en.append(autoText(text0, 'Type here', text => {
        if (version) o.changeMask(version.name, text);
        else o.change(x => { x.content = text; }, true);
        tk.textContent = `${tokenGuess(text)} tokens`;
        clearTimeout(countTimer);
        countTimer = setTimeout(() => count(text), 500);
    }));
    count(text0);
    if (!o.hero) storyLogic();

    if (o.fresh) setTimeout(() => { if (!h1.textContent) h1.focus(); }, 30);
    return v;
}

function autoText(value, placeholder, onInput) {
    const ta = el('textarea');
    ta.value = value;
    ta.placeholder = placeholder;
    ta.setAttribute('aria-label', 'Content');
    const fit = () => { ta.style.height = 'auto'; ta.style.height = `${Math.max(ta.scrollHeight, 200)}px`; };
    ta.addEventListener('input', () => { onInput(ta.value); fit(); });
    requestAnimationFrame(fit);
    return ta;
}

/** Marks a key word chip that also fires other entries (the keyword clash finder). */
function markClash(chip, word, clash) {
    const others = clash?.(word) ?? [];
    if (others.length) {
        chip.classList.add('clash');
        chip.title = `Also fires ${others.join(', ')}`;
    }
    return chip;
}

/** A line under the key words naming what each clashing word also fires: "mill also fires Old Mill". */
function clashNote(keys, clash) {
    const lines = (keys ?? []).map(k => [k, clash?.(k) ?? []]).filter(([, o]) => o.length);
    const n = el('div', 'clashnote');
    n.hidden = !lines.length;
    for (const [k, o] of lines) {
        const r = el('div');
        r.append(el('b', '', k), document.createTextNode(` also fires ${o.join(', ')}`));
        n.append(r);
    }
    return n;
}

/** The key word box: chips, tapped into a comma-separated line. */
function keyBox(list, placeholder, done, clash) {
    const box = el('div', 'kbox');
    box.tabIndex = 0;
    box.setAttribute('role', 'button');
    box.setAttribute('aria-label', placeholder);
    if (list.length) for (const k of list) box.append(markClash(el('span', 'kchip', k), k, clash));
    else box.append(el('span', 'ph', placeholder));
    const edit = () => {
        const input = el('input', 'kbox');
        input.value = list.join(', ');
        input.placeholder = placeholder;
        input.setAttribute('aria-label', placeholder);
        box.replaceWith(input);
        input.focus();
        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            done(input.value.split(',').map(s => s.trim()).filter(Boolean));
        };
        input.addEventListener('blur', finish);
        input.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); } });
    };
    box.addEventListener('click', edit);
    box.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); edit(); } });
    return box;
}


// ---------------------------------------------------------------- desktop (LAYOUT "Book (two panes)")

/** Desktop: labels in a left column (Strategy, Keywords, the condition), values on the right. */
function deskFields(en, o, main) {
    const { entry: e, layer, ui } = o;
    const g = el('div', 'fgrid');
    const lab = text => el('div', 'flab', text);
    const cur = e.constant ? 'perm' : e.vectorized ? 'vec' : 'keys';
    const st = el('button', 'fmenu');
    st.type = 'button';
    st.append(sdot(e), el('b', '', STRATEGY_NAME[cur]), el('span', 'car', '▾'));
    st.setAttribute('aria-label', `Strategy: ${STRATEGY_NAME[cur]}`);
    st.addEventListener('click', () => layer.sheet(null, sh => {
        for (const k of ['keys', 'perm', 'vec']) {
            sh.append(layer.opt(STRATEGY_NAME[k], () => { layer.close(); o.change(x => setStrategy(x, k)); }, { cur: cur === k, dot: STRATEGY_COLOR[k], sub: STRATEGY_HELP[k] }));
        }
    }, { at: st }));
    const sv = el('div', 'fval');
    sv.append(st, el('span', 'sp'), swEl(!e.disable, on => o.change(x => { x.disable = !on; }), 'Entry on'));
    g.append(lab('Strategy'), sv);
    if (!e.constant) {
        g.append(lab('Keywords'), keyChips(e.key ?? [], 'Type a key word, then Enter', list => o.change(x => { x.key = list; }), o.clash), clashNote(e.key, o.clash));
        const second = e.keysecondary ?? [];
        if (second.length || ui.condition) {
            const lt = el('button', 'fmenu flab');
            lt.type = 'button';
            lt.append(el('span', '', logicName(e.selectiveLogic)), el('span', 'car', '▾'));
            lt.addEventListener('click', () => layer.sheet(null, sh => {
                for (const [k, t] of LOGIC) sh.append(layer.opt(t, () => { layer.close(); o.change(x => { x.selectiveLogic = k; x.selective = true; }); }, { cur: Number(e.selectiveLogic ?? 0) === k }));
                sh.append(layer.opt('Remove condition', () => { layer.close(); removeCondition(o, e, ui); }, { icon: 'trash' }));
            }, { at: lt }));
            g.append(lt, keyChips(second, 'Second key words', list => o.change(x => { x.keysecondary = list; x.selective = true; })));
        } else {
            const ac = btn('linkish', html`${ic('plus', 's')} Add condition`, () => {
                ui.condition = true;
                // A key word box still focused (a tap doesn't always take focus) holds back the redraw that shows the
                // condition: let it go first, then draw.
                main.getRootNode().activeElement?.blur?.();
                o.change(x => { x.selective = true; x.selectiveLogic ??= 0; });
                o.redraw();
                setTimeout(() => main.querySelectorAll('.kchips input')[1]?.focus(), 0);
            });
            // Pressing it would blur a focused key word box, whose commit redraws the page under the press, and the
            // click then lands on nothing. Keep the focus until the click, which lets it go itself.
            ac.addEventListener('mousedown', e => e.preventDefault());
            g.append(el('div', 'flab'), ac);
        }
    }
    en.append(g);
}

/**
 * Key words as chips with a typing box at the end (desktop): Enter, comma or Tab adds; Backspace on an empty box
 * takes the last chip back to edit; × on a hovered chip removes it; a double click edits a chip; a pasted
 * comma-separated list splits.
 */
export function keyChips(list, placeholder, done, clash) {
    let words = [...list];
    const box = el('div', 'kchips');
    const input = el('input', 'kin2');
    input.placeholder = words.length ? '' : placeholder;
    input.setAttribute('aria-label', placeholder);
    const commit = next => { words = next; done([...words]); draw(); };
    const add = text => {
        const fresh = String(text).split(',').map(x => x.trim()).filter(Boolean).filter(x => !words.includes(x));
        if (fresh.length) commit([...words, ...fresh]);
    };
    function draw() {
        for (const c of [...box.querySelectorAll('.kchip')]) c.remove();
        words.forEach((w, i) => {
            const c = el('span', 'kchip');
            c.append(el('span', '', w));
            const x = btn('kx', ic('x', 's'), ev => { ev.stopPropagation(); commit(words.filter((_, j) => j !== i)); }, `Remove ${w}`);
            c.append(x);
            markClash(c, w, clash);
            c.addEventListener('dblclick', () => { commit(words.filter((_, j) => j !== i)); input.value = w; input.focus(); });
            box.insertBefore(c, input);
        });
        input.placeholder = words.length ? '' : placeholder;
    }
    input.addEventListener('keydown', ev => {
        if ((ev.key === 'Enter' || ev.key === ',' || (ev.key === 'Tab' && input.value.trim())) && !ev.isComposing) {
            ev.preventDefault();
            add(input.value);
            input.value = '';
        } else if (ev.key === 'Backspace' && !input.value && words.length) {
            ev.preventDefault();
            const last = words.at(-1);
            commit(words.slice(0, -1));
            input.value = last;
        }
    });
    input.addEventListener('paste', ev => {
        const text = ev.clipboardData?.getData('text') ?? '';
        if (!text.includes(',')) return;
        ev.preventDefault();
        add(input.value + text);
        input.value = '';
    });
    input.addEventListener('blur', () => { if (input.value.trim()) { add(input.value); input.value = ''; } });
    box.addEventListener('click', ev => { if (ev.target === box) input.focus(); });
    box.append(input);
    draw();
    return box;
}

/**
 * The parameters as real controls in two columns, grouped as on phones (desktop). Changed labels turn accent.
 * @param {object} e the entry (or what new entries start with)
 * @param {(p, value) => void} set
 * @param {{ value?: (p) => any, mixed?: (p) => boolean, changed?: (p) => boolean, when?: (p) => boolean, note?: (p) => string|null }} [o]
 *   `note` gives a warning line under a parameter (storyParamNote).
 */
export function paramGrid(e, set, o = {}) {
    const valueOf = o.value ?? (p => paramValue(e, p));
    const wrap = el('div', 'pgrid');
    for (const [group, list] of PARAMS) {
        const shown = list.filter(p => (o.when ? o.when(p) : !p.when || p.when(e)));
        if (!shown.length) continue;
        wrap.append(el('div', 'plbl', group));
        const g = el('div', 'pg');
        for (const p of shown) {
            const value = valueOf(p);
            const mixed = !!o.mixed?.(p);
            const changed = o.changed ? o.changed(p) : paramChanged(e, p);
            const id = `p-${p.field}`;
            const l = el('label', `pgl${changed ? ' ch' : ''}`, p.label);
            l.htmlFor = id;
            let c;
            if ((p.type === 'multi' || p.type === 'chars') && o.layer) {
                // Several values: a button with the current ones, opening the same sheet as on phones.
                c = btn('pgc pgb', '', () => editParam(o.layer, p, value, x => set(p, x)));
                c.textContent = mixed ? 'Mixed' : paramText(e, p);
            } else if (p.type === 'multi' || p.type === 'chars') {
                continue; // no sheet to edit it with here
            } else if (p.type === 'enum') {
                c = el('select', 'pgc');
                if (mixed) c.append(new Option('Mixed', '\u0000'));
                for (const [k, label] of p.options) c.append(new Option(label, k === null ? '\u0001' : String(k)));
                c.value = mixed ? '\u0000' : value === null || value === undefined ? '\u0001' : String(value);
                c.addEventListener('change', () => {
                    if (c.value === '\u0000') return;
                    const opt = p.options.find(([k]) => (k === null ? '\u0001' : String(k)) === c.value);
                    set(p, opt ? opt[0] : null);
                });
            } else if (p.type === 'bool') {
                c = el('input', 'pgc chk');
                c.type = 'checkbox';
                c.checked = !mixed && !!value;
                c.indeterminate = mixed;
                c.addEventListener('change', () => set(p, c.checked));
            } else {
                const isNum = p.type === 'int';
                c = el('input', 'pgc');
                c.type = isNum ? 'number' : 'text';
                if (isNum && p.min !== undefined) c.min = String(p.min);
                if (isNum && p.max !== undefined) c.max = String(p.max);
                c.placeholder = mixed ? 'Mixed' : isNum ? (p.optional ? 'Use global' : String(p.def)) : 'None';
                c.value = mixed || value === null || value === undefined || (isNum && value === p.def && !changed) ? '' : String(value);
                c.addEventListener('change', () => {
                    const v = c.value.trim();
                    if (!isNum) { set(p, v); return; }
                    if (v === '') { set(p, p.optional ? null : p.def); return; }
                    let n = Math.round(Number(v));
                    if (!Number.isFinite(n)) { c.value = ''; return; }
                    if (p.min !== undefined) n = Math.max(p.min, n);
                    if (p.max !== undefined) n = Math.min(p.max, n);
                    set(p, n);
                });
            }
            c.id = id;
            if (p.unit && p.type === 'int') { const u = el('span', 'pgu'); u.append(c, el('small', '', p.unit.trim())); g.append(l, u); } else g.append(l, c);
            const note = o.note?.(p);
            if (note) g.append(el('p', 'pnote', note));
        }
        wrap.append(g);
    }
    return wrap;
}

/**
 * The story chip's words: the first rule said plainly, then how many more ("Waits for Road · 2 more rules").
 * @param {{ text: string }[]} lines logicLines
 */
export function storyHeadline(lines) {
    if (!lines.length) return '';
    const t = lines[0].text;
    const m = /^(?:Opens when|Waits until) (.+?) (?:has|have) fired$/.exec(t);
    const head = m ? `Waits for ${m[1]}` : t;
    const more = lines.length - 1;
    return more ? `${head} · ${more} more rule${more === 1 ? '' : 's'}` : head;
}
