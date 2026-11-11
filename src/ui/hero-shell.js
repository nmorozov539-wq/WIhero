// Hero mode's shell (N3, LAYOUT "Hero mode"): the book it shows, its tab row, entry tabs, Back, and drawing the canvas
// (kept between draws when nothing it shows changed) with the panel, piece bar and inspector around it. It owns the
// mounted canvas; the rest of the app reads it through canvas(). Moved out of app.js; it reaches the app only
// through the context given to it.
import { bookSettings, cardKey, entriesOf } from './data.js';
import { btn, el, html } from './dom.js';
import { canvasBook } from './canvas-graph.js';
import { canvasMemory, mountCanvas } from './canvas.js';
import { closedText } from './logic-text.js';
import { entryStatus, slotValues, writtenText } from '../engine/turn.js';
import { ic } from './icons.js';
import { mountPieceBar } from './piecebar.js';
import { strategyColor } from './entry-page.js';

/**
 * @param {object} A The app's context (destructured below): its state and DOM, the library and hooks, and the
 *   Hero mode parts it draws (panel, piece bar, inspector, Preview, the Guide).
 *   desk() is desk.js's Normal mode wiring (deskN), made after this.
 */
export function createHeroShell(A) {
    const {
        H, S, barApi, barTap, barShaping, barShapeSet, bookPicker, chatGreetings, ctx, deskCanvas, deskColumns, deskSettings, entryFolder,
        heroBackDesk, heroInspector, heroPanel, hiddenIn, hide, hooks, inspect, inspectorFor, layer, library,
        loadingNote, lassoFor, main, modelOf, need, packSheet, renamePackAsk, panelState, placePicker, render, renderEntry, renderGuideTab,
        renderPreviewTab, renderTabs, revealActiveTab, root, saveSettings, settings, showOnCanvas, startExplain,
        stopExplain, strip, tabbar, visibleNames, desk, checkCounts, checksSheet, undoHistory, historyStep,
    } = A;

    let heroCanvas = null;

    /** The book Hero mode shows: the one picked, else the first one there is. */
    function heroBook() {
        const names = visibleNames();
        if (!H.book || !names.includes(H.book)) H.book = names[0] ?? null;
        return H.book;
    }

    const blockingUids = (book, model) => new Set(model.issues
        .filter(i => !i.warning && i.blocking !== false && i.stKey?.startsWith(`${book}.`))
        .map(i => Number(i.stKey.slice(book.length + 1))));

    /** The canvas's view of a book, worked out once per draw. */
    function heroData(book, data) {
        const problems = blockingUids(book, modelOf(book, data));
        const live = entriesOf(data).filter(e => !hiddenIn(book).has(e.uid));
        const m = canvasBook({ entries: Object.fromEntries(live.map(e => [e.uid, e])) }, { folderOf: e => entryFolder(book, e), problems, greetings: chatGreetings(data) });
        return { m, memory: canvasMemory(bookSettings(settings, book)), problems, chatState: H.chatState, status: H.chatState ? chatStatus(book) : () => null };
    }

    /** D17: each card's state in the open chat, at its latest message. Cards of books the chat doesn't use get none. */
    function chatStatus(book) {
        const chat = ctx().chat ?? [];
        const model = hooks.model;
        if (!chat.length || !model?.nodes?.size) return () => null;
        let state;
        try { state = hooks.state(); } catch { return () => null; }
        const nameOf = key => model.nodes.get(key)?.label ?? (key.startsWith('@') ? 'a greeting' : null);
        let values = null;
        return key => {
            if (!key.startsWith('id:')) return null;
            const node = model.nodes.get(`${book}/${key.slice(3)}`);
            if (!node) return null;
            const s = entryStatus(node, state, chat, model);
            return {
                fired: state.fired[node.key] ?? 0,
                closed: s.status === 'closed' ? closedText(state.closed[node.key].by, nameOf) : null,
                holding: s.status === 'holding',
                waiting: s.status === 'waiting',
                happened: node.moment ? s.status === 'happened' : undefined,
                mask: s.mask,
                // A tracker's value in this chat (TRACKERS 4), when it takes the place of the book's text.
                value: node.written || node.masks.some(m => m.written) ? writtenText(node, s.mask, values ??= slotValues(model, state, chat)) ?? undefined : undefined,
            };
        };
    }

    function renderHeroTabs() {
        const mk = (label, active, onOpen, onClose, { icon, dot } = {}) => {
            const b = el('button', `tab${active ? ' active' : ''}${icon ? ' fixed' : ''}`);
            b.type = 'button';
            if (icon) { b.innerHTML = ic(icon); b.setAttribute('aria-label', label); } else {
                if (dot) { const d = el('i', 'sd'); d.style.background = dot; b.append(d); }
                b.append(el('span', 'name', label));
            }
            if (S.desk) b.title = label;
            if (S.desk && onClose) {
                // Desktop: × on hover too, and middle-click closes.
                b.addEventListener('auxclick', e => { if (e.button === 1) { e.preventDefault(); onClose(); } });
                b.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
            }
            if ((active || S.desk) && onClose) {
                const x = el('span', 'x');
                x.innerHTML = ic('x');
                x.setAttribute('role', 'button');
                x.setAttribute('aria-label', 'Close tab');
                x.addEventListener('click', e => { e.stopPropagation(); onClose(); });
                b.append(x);
            }
            b.addEventListener('click', onOpen);
            strip.append(b);
        };
        mk('Canvas', H.active === 'canvas', () => { if (H.active !== 'canvas') { H.active = 'canvas'; render(); } }, null, { icon: 'canvas' });
        mk('Preview', H.active === 'preview', () => { if (H.active !== 'preview') { H.active = 'preview'; H.panel = false; render(); } }, null, { icon: 'eye' });
        if (H.guide) mk('Guide', H.active === 'guide', () => { if (H.active !== 'guide') { H.active = 'guide'; render(); } }, () => { H.guide = null; if (H.active === 'guide') H.active = 'canvas'; render(); }, { icon: 'help' });
        H.tabs.forEach((t, i) => {
            const e = library.peek(t.book)?.entries[t.uid];
            mk(e ? (e.comment || 'New entry') : 'Entry', H.active === i, () => { if (H.active !== i) { H.active = i; render(); } }, () => closeHeroTab(i), { dot: e ? strategyColor(e) : null });
        });
        if (S.desk) heroTabsRight();
        revealActiveTab();
    }

    /** Desktop (LAYOUT "Desktop: Hero mode", Tab row): the book picker, Search, Widen/Drawer size, ×. The mode switch is
     * only in ☰, one guarded door on each side (LAYOUT "Mode switch"). */
    function heroTabsRight() {
        const right = el('div', 'tright');
        const book = heroBook();
        const bp = btn('tbook', html`${ic('book', 's')}<span></span>${ic('down', 's')}`, () => bookPicker(), 'Switch book');
        bp.querySelector('span').textContent = book ?? 'No book';
        bp.title = 'Switch book';
        const sb = btn('tsearch', html`${ic('search', 's')}<span>Search</span><kbd>Ctrl K</kbd>`, () => { S.search = { query: '', at: 0 }; render(); }, 'Search (Ctrl K)');
        const eq = btn('iconbtn explainq', ic('help'), () => (H.explain ? stopExplain() : startExplain()), 'Explain: click something to learn about it');
        eq.title = 'Explain (?)';
        const wide = deskSettings().heroWide !== false;
        const wb = btn('iconbtn', ic(wide ? 'drawer' : 'fit'), () => {
            deskSettings().heroWide = !wide;
            saveSettings();
            H.dlist = null; // the list and the inspector start as the new size has them
            H.dinsp = null;
            render();
            requestAnimationFrame(() => heroCanvas?.fit());
        }, wide ? 'Drawer size' : 'Widen');
        wb.title = wide ? 'Drawer size' : 'Widen';
        right.append(bp, sb, eq, wb, btn('iconbtn', ic('x'), () => hide(), 'Close WI Hero'));
        tabbar.append(right);
    }

    function closeHeroTab(i) {
        H.tabs.splice(i, 1);
        if (H.active === i) H.active = i < H.tabs.length ? i : i > 0 ? i - 1 : 'canvas'; // the next tab slides into its place
        else if (typeof H.active === 'number' && H.active > i) H.active--;
        render();
    }

    /** Opens an entry in a Hero tab (the inspector comes in N4). */
    function openHeroTab(book, uid, mask = null) {
        let i = H.tabs.findIndex(t => t.book === book && t.uid === uid);
        if (i < 0) { H.tabs.push({ book, uid }); i = H.tabs.length - 1; }
        H.tabs[i].mask = mask;
        H.active = i;
        H.panel = false;
        render();
    }

    function heroBack() {
        if (H.explain) { stopExplain(); return true; }
        if (S.desk) return heroBackDesk();
        // Back on an open strip is its Cancel; on an armed chip it disarms.
        if (H.active === 'canvas' && H.bar.edit) {
            const e = H.bar.edit;
            if (e.dirty) barApi(e.book).restore(e.snap);
            H.bar.edit = null;
            render();
            return true;
        }
        if (H.active === 'canvas' && H.bar.armed) { H.bar.armed = null; render(); return true; }
        if (H.insp && H.active === 'canvas') { H.insp = null; render(); return true; }
        if (H.panel) { H.panel = false; render(); return true; }
        if (typeof H.active === 'number') { closeHeroTab(H.active); return true; }
        if (H.active === 'guide') { H.active = 'canvas'; render(); return true; }
        if (H.active === 'preview') {
            if (H.pv?.page) H.pv.page = null;
            else H.active = 'canvas';
            render();
            return true;
        }
        hide();
        return false;
    }

    /**
     * What the canvas draws from, as one string: when a Hero draw finds it unchanged (a piece bar step that only
     * changes the strip, the inspector opening, the panel), the cards and links stay as they are. The camera is left
     * out: it moves without a draw. Show chat state always draws, since the chat moves under it.
     */
    function canvasSig(book) {
        if (H.chatState) return null;
        const bs = settings.books?.[book] ?? {};
        const { camera, ...canvas } = bs.canvas ?? {};
        const top = Object.entries(settings).filter(([k, v]) => k !== 'books' && (v === null || typeof v !== 'object'));
        const c = ctx();
        return JSON.stringify([library.version, { ...bs, canvas }, top, [...hiddenIn(book)], c.getCurrentChatId?.() ?? c.chatId ?? null, c.characterId ?? null]);
    }
    /** The canvas kept between Hero draws of the same book: { book, data, vp, sig, data() cache }. */
    let heroMount = null;

    function renderHero() {
        renderTabs();
        // Explain mode: outlines on what can be explained, a banner with Cancel (LAYOUT "Explain mode").
        root.classList.toggle('explaining', !!H.explain);
        root.querySelector(':scope > .explainban')?.remove();
        if (H.explain) {
            const ban = el('div', 'explainban');
            ban.setAttribute('role', 'status');
            ban.append(el('span', '', S.desk ? 'Click anything to learn about it' : 'Tap anything to learn about it'), btn('pbtn sm', 'Cancel', stopExplain));
            root.append(ban);
        }
        if (typeof H.active === 'number' && !H.tabs[H.active]) H.active = 'canvas';
        const keepBook = H.active === 'canvas' ? heroBook() : null;
        const kept = heroMount && heroCanvas && keepBook && heroMount.book === keepBook && library.peek(keepBook) === heroMount.data
            && main.dataset.page === 'hero:canvas' && heroMount.vp.parentNode === main ? heroMount : null;
        if (kept) {
            // Same canvas: everything around it is drawn again (cheap), the cards and links only if they changed.
            for (const n of [...main.children]) if (n !== kept.vp) n.remove();
            kept.vp.querySelector('.legend')?.remove();
            if (H.legend) kept.vp.append(legendBox());
            const sig = canvasSig(keepBook);
            heroCanvas.overlay(null); // the piece bar sets its own again, as on a fresh canvas
            if (sig === null || sig !== kept.sig) { kept.cache = null; heroCanvas.render(); undoHistory.settle(keepBook); kept.sig = canvasSig(keepBook); } // a draw can place cards
            else heroCanvas.refreshShaping(); // the strip picked another part or dot of the line it shapes
            heroAround(keepBook, kept.data);
            return;
        }
        main.innerHTML = '';
        heroCanvas = null;
        heroMount = null;
        if (typeof H.active === 'number') {
            const t = H.tabs[H.active];
            main.dataset.page = `hero:${H.active}`;
            const nav = { up: () => closeHeroTab(H.active), go: uid => { t.uid = uid; t.mask = null; render(); }, tab: t };
            if (S.desk) {
                // Desktop: the shared entry page, Story logic always open, "Show on canvas ›".
                S.ui.logic = true;
                const e = library.peek(t.book)?.entries[t.uid];
                const folder = e ? entryFolder(t.book, e) : '';
                renderEntry({ type: 'entry', book: t.book, uid: t.uid }, nav, main, {
                    desk: {
                        crumbs: [{ label: t.book }, ...(folder ? folder.split('/').map(f => ({ label: f })) : [])],
                        showOnCanvas: e ? () => { showOnCanvas(t.book, cardKey(e)); inspect(t.book, cardKey(e)); } : null,
                    },
                });
                if (S.search) desk().renderSearch();
                return;
            }
            renderEntry({ type: 'entry', book: t.book, uid: t.uid }, nav);
            return;
        }
        if (H.active === 'preview') { renderPreviewTab(); if (S.desk && S.search) desk().renderSearch(); return; }
        if (H.active === 'guide' && H.guide) {
            renderGuideTab(main);
            if (S.desk && S.search) desk().renderSearch();
            return;
        }
        main.dataset.page = 'hero:canvas';
        const book = heroBook();
        if (!book) { const v = el('div', 'view'); v.append(el('div', 'empty-note', 'No books yet. Switch to Normal mode to make one.')); main.append(v); return; }
        const data = need(book);
        if (!data) { const v = el('div', 'view'); v.append(el('div', 'empty-note', loadingNote(book))); main.append(v); return; }

        if (S.desk) deskColumns(); // the columns first, so the canvas fits the room it really has
        const vp = el('div', 'vp');
        vp.tabIndex = -1;
        main.append(vp);
        if (H.legend) vp.append(legendBox());
        const mount = { book, data, vp, sig: null, cache: null };
        heroCanvas = mountCanvas(vp, {
            book: () => (mount.cache ??= heroData(book, data)),
            save: saveSettings,
            open: (key, piece) => inspect(book, key, piece),
            pack: name => packSheet(book, data, name),
            renamePack: name => renamePackAsk(book, name),
            lasso: lassoFor(book, data),
            toast: text => layer.toast(text),
            holdEmpty: at => placePicker(book, data, at),
            // A loose end let go on empty canvas: the entry picked there is placed and takes the loose end.
            looseEmpty: at => placePicker(book, data, at, key => { const end = barApi(book).nodeOf(key); if (end) H.bar.loosePick?.(end); }),
            undo: () => historyStep(false), // a two-finger tap
            tapTarget: (hit, at) => barTap(book, hit, at),
            shaping: () => barShaping(book),
            shapeSet: (pick, changed) => barShapeSet(pick, changed),
            focused: () => (H.insp?.book === book ? H.insp.key : null),
            tapEmpty: () => {
                if (H.panel) { H.panel = false; panelState(); }
                if (S.desk) { H.insp = null; heroInspector(book, data); return; }
                if (H.insp) { H.insp = null; main.querySelector('.insp')?.remove(); heroCanvas?.phoneFocus?.(); }
            },
            ...(S.desk ? deskCanvas(book, data) : {}),
        });
        heroMount = mount;
        heroCanvas.render();
        undoHistory.settle(book); // cards the draw placed on its own are not an edit
        mount.sig = canvasSig(book); // after the draw, which can place cards
        heroAround(book, data);
    }
    /**
     * The book's checks on the canvas (#42): "2 dead · 1 clash", opening the Dead branches or Keyword clashes sheet
     * (the ☰ menu keeps its rows too). Nothing when the book is clean.
     */
    /** Undo and redo on the canvas (Ctrl+Z, Ctrl+Shift+Z on desktop), greyed out when there is nothing to step to. */
    function historyButtons(book) {
        const box = el('div', 'histbtns');
        const u = btn('', ic('undo'), () => historyStep(false), 'Undo (Ctrl Z)');
        const r = btn('', ic('redo'), () => historyStep(true), 'Redo (Ctrl Shift Z)');
        // While a piece is set up in the strip, its edits aren't steps yet: Done or Cancel first.
        u.disabled = !!H.bar.edit || !undoHistory.canUndo(book);
        r.disabled = !!H.bar.edit || !undoHistory.canRedo(book);
        u.title = 'Undo (Ctrl Z)';
        r.title = 'Redo (Ctrl Shift Z)';
        box.append(u, r);
        box.addEventListener('pointerdown', e => e.stopPropagation()); // not a canvas pan
        return box;
    }

    let checksMemo = null;
    function checksChip(book, data) {
        // Counted again only when a book changed (library.version), or its pending deletes or the setting did.
        const sig = `${book}|${library.version}|${[...hiddenIn(book)].join(',')}|${settings.markClashes !== false}`;
        if (checksMemo?.data !== data || checksMemo.sig !== sig) checksMemo = { data, sig, n: checkCounts(book, data) };
        const { dead, clashes } = checksMemo.n;
        if (!dead && !clashes) return [];
        const parts = [dead ? `${dead} dead` : '', clashes ? `${clashes} clash${clashes === 1 ? '' : 'es'}` : ''].filter(Boolean);
        const label = [dead ? `${dead} dead branch${dead === 1 ? '' : 'es'}` : '', clashes ? `${clashes} keyword clash${clashes === 1 ? '' : 'es'}` : ''].filter(Boolean).join(', ');
        const b = btn(`checkchip${dead ? ' dead' : ''}`, html`${ic('alert', 's')}<span></span>`, () => checksSheet(book), label);
        b.querySelector('span').textContent = parts.join(' · ');
        b.title = label;
        b.addEventListener('pointerdown', e => e.stopPropagation()); // not a canvas pan
        return [b];
    }

    /** What sits around the canvas: the entry panel, the piece bar and the inspector. */
    function heroAround(book, data) {
        if (S.desk) deskColumns();
        const vp = heroMount?.vp;
        if (vp) {
            vp.querySelector(':scope > .checkchip')?.remove();
            vp.querySelector(':scope > .histbtns')?.remove();
            vp.append(...checksChip(book, data), historyButtons(book));
        }
        if (!S.desk) {
            // Phones: the "?" sits at the top right of the canvas.
            const q = btn('explainq', ic('help'), () => (H.explain ? stopExplain() : startExplain()), 'Explain: tap something to learn about it');
            main.append(q);
        }
        heroPanel(book, data);
        if (H.bar.edit && H.bar.edit.book !== book) H.bar.edit = null;
        mountPieceBar(barApi(book));
        if (S.desk) { heroInspector(book, data); if (S.search) desk().renderSearch(); return; }
        if (H.insp?.book === book) inspectorFor(book, data);
    }
    function legendBox() {
        const lg = el('div', 'legend');
        for (const [v, label, dashed] of [['open', 'opens'], ['close', 'closes', true], ['glue', 'glue'], ['mask', 'mask'], ['pack', 'pack', true]]) {
            const s = el('span');
            s.style.color = `var(--p-${v})`;
            s.append(el('i', dashed ? 'd' : ''), label);
            lg.append(s);
        }
        return lg;
    }

    return {
        canvas: () => heroCanvas,
        chatStatus, heroBack, heroBook, heroData, openHeroTab, renderHero, renderHeroTabs, closeHeroTab,
    };
}
