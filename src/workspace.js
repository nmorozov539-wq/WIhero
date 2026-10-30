// The WI Hero workspace: a full-screen editor for one book, laid out like a notes app. Top bar, ribbon and
// sidebar on the left, tabs over the graph, the selected entry on the right, chat state at the bottom.
// The graph's shape comes from graph.js and layout.js; drawing from graph-view.js.
import { el } from './panel.js';
import { FIELD, buildModel, eligibility, activeMask, entryKey } from './engine.js';
import { stateBefore } from './chat-state.js';
import { buildGraph, collapse, neighborhood } from './graph.js';
import { layout, CARD } from './layout.js';
import { createGraphView, LINK_NAMES } from './graph-view.js';
import { shortStatus, statusClass } from './status.js';
import { folderList } from './bulk.js';
import { ENTRY_FIELDS, TIMER_FIELDS, fieldText, formChanges, applyEntryChanges, unlinkedMentions, gateOn } from './entry-model.js';
import { applyConfig } from './editor-model.js';
import { logicForm } from './editor.js';
import { originalWIDataKeyMap } from './st.js';
import { canvasOf, placeKey, canvasLayout, inside, linkOptions, applyLink, setLabel, newProblems, pushUndo } from './canvas-model.js';

let deps;
let root = null;
/** Everything the workspace shows, rebuilt by load(). */
const ws = {
    book: '', data: null, entries: [], model: null, graph: null, shown: null, placed: null,
    selected: null, showState: true, scrub: null, folded: new Set(), local: { on: false, depth: 1 },
    tabs: [{ key: 'graph', title: 'Graph' }], tab: 'graph', section: 'files', search: '',
    panelTab: 'entry', version: 0, panelFor: '',
    mode: 'graph', undo: {},
};
let ui = {};
let view = null;

/**
 * @param {{ ctx: () => object, loadedEntries: () => object[], settings: object, save: () => void,
 *   openInST: (book: string, uid: number) => void, defaultBook: () => string | undefined, onSaved: () => void }} d
 */
export function mountWorkspace(d) {
    deps = d;
}

export const isOpen = () => !!root;

/** Opens the workspace on a book (the one open in ST's editor, or the first loaded one, by default). */
export async function openWorkspace(book) {
    if (!root) build();
    const names = deps.ctx().getWorldInfoNames();
    ws.book = book ?? deps.defaultBook() ?? names[0] ?? '';
    await load({ fit: true });
}

export function closeWorkspace() {
    root?.remove();
    root = null;
    view = null;
}

/** Called when the chat or the books change: statuses and the scrubber follow. Batched, as ST refreshes often. */
let pending = null;
export function refreshWorkspace({ books = false } = {}) {
    if (!root) return;
    pending = { books: books || pending?.books };
    clearTimeout(refreshWorkspace.timer);
    refreshWorkspace.timer = setTimeout(function later() {
        // Re-rendering mid-drag would pull the card or handle out from under the pointer.
        if (view?.busy()) { refreshWorkspace.timer = setTimeout(later, 150); return; }
        const { books: reload } = pending;
        pending = null;
        if (!root) return;
        ws.scrub = null;
        if (reload) load(); else draw({ keepView: true });
    }, 150);
}

function build() {
    const button = (label, { class: extra = '', ...attrs } = {}) => el('button', { type: 'button', class: `wihero-ws-button ${extra}`, ...attrs }, label);
    ui.bookSelect = el('select', { class: 'text_pole wihero-ws-book', 'aria-label': 'Book' });
    ui.bookSelect.addEventListener('change', () => { ws.book = ui.bookSelect.value; ws.selected = null; ws.folded.clear(); load({ fit: true }); });
    ui.jump = button('Jump to entry or run a command', { class: 'wihero-ws-jump', title: 'Ctrl K' });
    ui.saved = el('span', { class: 'wihero-ws-saved' }, 'All changes saved');
    const close = button('Close', { class: 'wihero-ws-close', 'aria-label': 'Close the workspace' });
    close.addEventListener('click', closeWorkspace);

    const ribbon = el('nav', { class: 'wihero-ws-ribbon', 'aria-label': 'Sidebar' }, ...[
        ['files', 'Files'], ['search', 'Search'], ['labels', 'Labels'], ['problems', 'Problems'], ['timeline', 'Timeline'],
    ].map(([section, label]) => {
        const b = button(label, { 'data-section': section, title: label });
        b.addEventListener('click', () => { ws.section = section; drawSidebar(); });
        return b;
    }));
    ui.sidebar = el('aside', { class: 'wihero-ws-sidebar' });
    ui.tabs = el('div', { class: 'wihero-ws-tabs', role: 'tablist' });

    ui.localToggle = el('input', { type: 'checkbox', name: 'wihero_local' });
    ui.localDepth = el('select', { class: 'text_pole', name: 'wihero_local_depth' }, el('option', { value: '1' }, '1'), el('option', { value: '2' }, '2'));
    ui.stateToggle = el('input', { type: 'checkbox', name: 'wihero_show_state' });
    ui.stateToggle.checked = ws.showState;
    ui.localToggle.addEventListener('change', () => { ws.local.on = ui.localToggle.checked; draw({ fit: true }); });
    ui.localDepth.addEventListener('change', () => { ws.local.depth = Number(ui.localDepth.value); if (ws.local.on) draw({ fit: true }); });
    ui.stateToggle.addEventListener('change', () => { ws.showState = ui.stateToggle.checked; draw({ keepView: true }); });
    const fit = button('Fit', { title: 'Show the whole graph' });
    fit.addEventListener('click', () => view?.fit());
    ui.modes = el('div', { class: 'wihero-ws-modes', role: 'group', 'aria-label': 'Layout' }, ...[['graph', 'Graph'], ['canvas', 'Canvas']].map(([mode, label]) => {
        const b = button(label, { 'data-mode': mode, 'aria-pressed': 'false' });
        b.addEventListener('click', () => { ws.mode = mode; deps.settings.workspaceMode = mode; deps.save(); draw({ fit: true }); });
        return b;
    }));
    const tool = (label, title, action) => { const b = button(label, { title, class: 'wihero-ws-canvas-tool' }); b.addEventListener('click', action); return b; };
    ui.canvasTools = el('span', { class: 'wihero-ws-canvas-tools' },
        tool('Area', 'Add a named area: a frame to arrange cards in (layout only)', () => addBox('areas', { name: 'Area', w: 420, h: 280 })),
        tool('Note', 'Add a note card (never sent to the model)', () => addBox('notes', { text: '', w: 220, h: 140 })),
        tool('Tidy', 'Lay the cards out automatically again', tidy),
        tool('Undo', 'Undo the last canvas change (Ctrl Z)', undo));
    const tools = el('div', { class: 'wihero-ws-tools' }, ui.modes, ui.canvasTools,
        el('label', {}, ui.localToggle, ' Local graph'), el('label', {}, 'depth ', ui.localDepth),
        el('label', {}, ui.stateToggle, ' Chat state'), fit);

    ui.stage = el('div', { class: 'wihero-stage' });
    ui.center = el('div', { class: 'wihero-ws-center' });
    ui.reader = el('div', { class: 'wihero-ws-reader' });
    ui.panel = el('aside', { class: 'wihero-ws-panel', 'aria-label': 'Selected entry' });
    ui.preview = el('div', { class: 'wihero-ws-preview', role: 'tooltip' });

    ui.counts = el('span', { class: 'wihero-ws-counts' });
    ui.scrub = el('input', { type: 'range', min: '0', max: '0', value: '0', id: 'wihero_scrub', class: 'wihero-ws-scrub' });
    ui.scrubLabel = el('label', { for: 'wihero_scrub' });
    ui.scrub.addEventListener('input', () => { ws.scrub = Number(ui.scrub.value); draw({ keepView: true }); });

    root = el('div', { class: 'wihero-ws', role: 'dialog', 'aria-label': 'WI Hero workspace', tabindex: '-1' },
        el('header', { class: 'wihero-ws-top' }, el('b', {}, 'WI Hero'), ui.bookSelect, ui.jump, ui.saved, close),
        el('div', { class: 'wihero-ws-body' },
            ribbon, ui.sidebar,
            el('main', { class: 'wihero-ws-main' }, el('div', { class: 'wihero-ws-tabbar' }, ui.tabs, tools), ui.center),
            ui.panel),
        el('footer', { class: 'wihero-ws-status' }, ui.counts, el('span', { class: 'wihero-ws-spacer' }), ui.scrubLabel, ui.scrub),
        ui.preview);
    root.addEventListener('keydown', e => {
        if (e.target.closest('input, textarea, select')) return;
        if (e.key === 'Escape') closeWorkspace();
        if (e.key === 'z' && (e.ctrlKey || e.metaKey) && ws.mode === 'canvas') { e.preventDefault(); undo(); }
    });
    document.body.append(root);
    view = createGraphView(ui.stage, {
        onSelect: key => selectNode(key),
        onOpen: key => openTab(key),
        onHover: (key, card) => preview(key, card),
        onMove: (key, x, y) => moved(key, x, y),
        onBox: (kind, id, rect) => boxChanged(kind, id, rect),
        onLink: (from, to, x, y) => linkMenu(from, to, x, y),
        onNote: (id, text) => editCanvas(c => { c.notes.find(n => n.id === id).text = text; }, { redraw: false }),
        onArea: (id, name) => editCanvas(c => { c.areas.find(a => a.id === id).name = name; }, { redraw: false }),
        onRemove: (kind, id) => editCanvas(c => { c[`${kind}s`] = c[`${kind}s`].filter(x => x.id !== id); }),
    });
    ws.mode = deps.settings.workspaceMode === 'canvas' ? 'canvas' : 'graph';
    root.focus();
}

/** Loads the book and rebuilds the model and graph from it and the other loaded books. */
async function load({ fit = false } = {}) {
    const ctx = deps.ctx();
    const names = ctx.getWorldInfoNames();
    ui.bookSelect.replaceChildren(...names.map(n => el('option', { value: n }, n)));
    ui.bookSelect.value = ws.book;
    ws.data = ws.book ? await ctx.loadWorldInfo(ws.book) : null;
    if (ws.book && deps.settings.workspaceBook !== ws.book) { deps.settings.workspaceBook = ws.book; deps.save(); }
    ws.entries = Object.values(ws.data?.entries ?? {}).map(e => ({ ...e, world: ws.book }));
    const others = deps.loadedEntries().filter(e => e.world !== ws.book);
    ws.model = buildModel([...others, ...ws.entries]);
    ws.graph = buildGraph(ws.entries, ws.model, ws.book);
    ws.version++;
    if (ws.selected && !ws.graph.nodes.has(ws.selected) && !ws.entries.some(e => entryKey(e) === ws.selected)) ws.selected = null;
    ws.tabs = ws.tabs.filter(t => t.key === 'graph' || ws.entries.some(e => entryKey(e) === t.key));
    if (!ws.tabs.some(t => t.key === ws.tab)) ws.tab = 'graph';
    draw({ fit, keepView: !fit });
}

/** The chat state the cards show: the latest, or the message the scrubber is on. */
function chatState() {
    const chat = deps.ctx().chat ?? [];
    const last = Math.max(0, chat.length - 1);
    const at = ws.scrub === null ? last : Math.min(ws.scrub, last);
    return { state: stateBefore(chat, at + 1).state, at, last, chat };
}

const entryOf = key => ws.entries.find(e => entryKey(e) === key);

function statusOf(node, state) {
    if (node.kind !== 'entry') return null;
    return eligibility(node.node, ws.model, state).reason;
}

/** How a card looks: its title, badges and (with chat state on) its status. */
function looks(state) {
    return node => {
        if (node.kind === 'label') {
            return { className: 'wihero-card-hub', content: [el('b', {}, node.title), el('small', {}, `${node.members.length} entr${node.members.length === 1 ? 'y' : 'ies'}`)] };
        }
        if (node.kind === 'group') {
            return { className: 'wihero-card-folded', content: [el('b', {}, node.title), el('small', {}, `${node.count} entries · double-click to unfold`)] };
        }
        if (node.kind === 'mask') {
            const owner = ws.graph.nodes.get(node.owner)?.node;
            const active = ws.showState && activeMask(owner, state)?.name === node.mask.name;
            return { className: active ? 'wihero-mask-active' : '', content: [el('small', {}, 'mask '), el('b', {}, node.title)] };
        }
        const m = node.node;
        const badges = [];
        if (m.glue) badges.push('glue');
        if (m.switch.length) badges.push('switch');
        if (m.closes.length) badges.push('closes');
        if (m.masks.length) badges.push(`${m.masks.length} mask${m.masks.length > 1 ? 's' : ''}`);
        const status = ws.showState ? statusOf(node, state) : null;
        const fired = state.fired[m.id] ?? 0;
        const line = status ? `${shortStatus(status) ?? status}${fired ? ` · fired ${fired}` : ''}` : (node.external ? `in ${node.world}` : node.title);
        return {
            className: `${status ? statusClass(status) : ''}${node.external ? ' wihero-card-external' : ''}${node.color ? ' wihero-colored' : ''}`,
            content: [
                el('div', { class: 'wihero-card-title' }, el('b', {}, node.id ?? node.title), ...badges.map(b => el('span', { class: 'wihero-badge-mini' }, b))),
                el('small', { class: 'wihero-card-status', title: status ?? '' }, line),
            ],
        };
    };
}

/**
 * On the canvas, entries without links are cards too (in a column of their own), so they can be linked or
 * dropped into a label box. Vanilla entries get a stand-in for the engine node they don't have.
 */
function withUnlinked(graph) {
    const nodes = new Map(graph.nodes);
    for (const e of ws.graph.unlinked) {
        const key = entryKey(e);
        const m = ws.model.byKey.get(key) ?? { world: e.world, uid: e.uid, id: null, labels: [], switch: [], masks: [], closes: [], gates: [], glue: null };
        nodes.set(key, {
            key, kind: 'entry', id: m.id, uid: e.uid, world: e.world, title: e.comment || e.key?.[0] || `uid ${e.uid}`,
            external: false, unlinked: true, folder: '', color: e.wihero?.color ?? '', node: m, content: e.content ?? '',
        });
    }
    return { ...graph, nodes };
}

/** Puts the unlinked cards in a column right of the graph. */
function placeUnlinked(graph, auto) {
    const x = auto.width + CARD.col - CARD.w;
    let y = 0;
    for (const n of graph.nodes.values()) {
        if (!n.unlinked) continue;
        auto.pos.set(n.key, { x, y, w: CARD.w, h: CARD.h });
        y += CARD.h + CARD.gap;
    }
    if (y) { auto.width = x + CARD.w; auto.height = Math.max(auto.height, y - CARD.gap); }
}

/** Rebuilds what's shown: folding, local graph, layout, cards, sidebar, panel, status bar. */
function draw({ fit = false, keepView = false } = {}) {
    if (!root || !ws.graph) return;
    let shown = collapse(ws.graph, ws.folded);
    if (ws.local.on && ws.selected && shown.nodes.has(ws.selected)) shown = neighborhood(shown, ws.selected, ws.local.depth);
    if (ws.mode === 'canvas' && !ws.local.on) shown = withUnlinked(shown);
    ws.shown = shown;
    const auto = layout(shown);
    if (ws.mode === 'canvas') placeUnlinked(shown, auto);
    let canvas = null;
    if (ws.mode === 'canvas') {
        canvas = canvasOf(deps.settings, ws.book);
        ws.placed = canvasLayout(shown, auto, canvas);
        // Everything is pinned the first time the canvas shows it: new links change the automatic layout,
        // and cards and label boxes the user hasn't moved must not wander off. Tidy unpins them all.
        let fixed = false;
        for (const [key, p] of ws.placed.pos) {
            const node = shown.nodes.get(key);
            if (p.box) {
                if (!canvas.boxes[key]) { canvas.boxes[key] = { x: p.x, y: p.y, w: p.w, h: p.h }; fixed = true; }
            } else if (node && (node.kind === 'entry' || node.kind === 'group') && !canvas.pos[placeKey(node)]) {
                canvas.pos[placeKey(node)] = { x: p.x, y: p.y };
                fixed = true;
            }
        }
        if (fixed) deps.save();
    } else {
        ws.placed = auto;
    }
    for (const b of ui.modes.children) b.setAttribute('aria-pressed', String(b.dataset.mode === ws.mode));
    ui.canvasTools.style.display = ws.mode === 'canvas' ? '' : 'none';
    root.classList.toggle('wihero-ws-canvas', ws.mode === 'canvas');
    const { state, at, last } = chatState();
    ui.center.replaceChildren(ws.tab === 'graph' ? ui.stage : ui.reader);
    view.render(shown, ws.placed, looks(state), { keepView: keepView && !fit, canvas });
    view.select(ws.selected);
    if (ws.tab !== 'graph') drawReader(ws.tab, state);
    drawTabs();
    drawSidebar();
    drawPanel(state);
    const entries = ws.graph.nodes.size ? [...ws.graph.nodes.values()].filter(n => n.kind === 'entry' && !n.external).length : 0;
    const problems = issuesHere().length;
    ui.counts.textContent = `${ws.entries.length} entries · ${entries} on the graph · ${ws.graph.unlinked.length} not linked yet${problems ? ` · ${problems} issue${problems > 1 ? 's' : ''}` : ''}`;
    ui.scrub.max = String(last);
    ui.scrub.value = String(at);
    ui.scrub.disabled = last === 0;
    ui.scrubLabel.textContent = `Chat state at message #${at} of ${last}`;
}

const issuesHere = () => ws.model.issues.filter(i => i.key.startsWith(`${ws.book}.`));

function drawTabs() {
    ui.tabs.replaceChildren(...ws.tabs.map(t => {
        const title = t.key === 'graph' ? (ws.mode === 'canvas' ? 'Canvas' : 'Graph') : t.title;
        const tab = el('button', { type: 'button', role: 'tab', class: `wihero-ws-tab${t.key === ws.tab ? ' wihero-ws-tab-on' : ''}`, 'aria-selected': String(t.key === ws.tab) }, title);
        tab.addEventListener('click', () => { ws.tab = t.key; draw({ keepView: true }); });
        if (t.key === 'graph') return tab;
        const x = el('button', { type: 'button', class: 'wihero-ws-tab-close', 'aria-label': `Close ${t.title}` }, '×');
        x.addEventListener('click', e => {
            e.stopPropagation();
            ws.tabs = ws.tabs.filter(o => o !== t);
            if (ws.tab === t.key) ws.tab = 'graph';
            draw({ keepView: true });
        });
        return el('span', { class: 'wihero-ws-tabwrap' }, tab, x);
    }));
}

function openTab(key) {
    const node = ws.shown.nodes.get(key);
    if (node?.kind === 'group') {
        ws.folded.delete(node.id);
        return draw({ keepView: true });
    }
    const entry = entryOf(key);
    if (!entry) return;
    if (!ws.tabs.some(t => t.key === key)) ws.tabs.push({ key, title: entry.wihero?.id ?? entry.comment ?? `uid ${entry.uid}` });
    ws.tab = key;
    ws.selected = key;
    draw({ keepView: true });
}

function selectNode(key, { center = false } = {}) {
    const node = key && ws.shown?.nodes.get(key);
    ws.selected = node?.kind === 'mask' ? node.owner : key;
    if (ws.local.on) return draw({ fit: true });
    view.select(ws.selected);
    drawPanel(chatState().state);
    drawSidebar();
    if (center && ws.selected) view.center(ws.selected);
}

/** Hover preview: the entry's keys and content, as Obsidian shows a note on hover. */
let hoverTimer = null;
function preview(key, card) {
    clearTimeout(hoverTimer);
    if (!key) { ui.preview.classList.remove('wihero-show'); return; }
    hoverTimer = setTimeout(() => {
        const entry = entryOf(key);
        const node = ws.shown.nodes.get(key);
        if (!entry && node?.kind !== 'mask') return;
        const text = node?.kind === 'mask' ? node.mask.content : entry.content ?? '';
        ui.preview.replaceChildren(
            el('b', {}, node?.kind === 'mask' ? `mask ${node.title}` : entry.comment || node?.id || ''),
            ...(entry ? [el('small', {}, `keys: ${(entry.key ?? []).join(', ') || 'none'}`)] : []),
            el('span', {}, text.length > 400 ? `${text.slice(0, 400)}…` : text || '(no content)'));
        const r = card.getBoundingClientRect();
        const left = Math.min(window.innerWidth - 340, r.right + 8);
        Object.assign(ui.preview.style, { left: `${Math.max(8, left)}px`, top: `${Math.max(8, Math.min(window.innerHeight - 220, r.top))}px` });
        ui.preview.classList.add('wihero-show');
    }, 350);
}

// ── Sidebar ──────────────────────────────────────────────────────────

function entryButton(entry, extra = []) {
    const key = entryKey(entry);
    const b = el('button', { type: 'button', class: `wihero-ws-item${key === ws.selected ? ' wihero-ws-item-on' : ''}`, 'data-key': key },
        entry.wihero?.id ?? (entry.comment || `uid ${entry.uid}`), ...extra);
    b.addEventListener('click', () => {
        if (ws.local.on || !ws.shown.nodes.has(key)) { ws.selected = key; return draw({ keepView: true }); }
        selectNode(key, { center: true });
    });
    return b;
}

const heading = text => el('small', { class: 'wihero-ws-heading' }, text);

function drawSidebar() {
    for (const b of root.querySelectorAll('.wihero-ws-ribbon button')) b.classList.toggle('wihero-ws-on', b.dataset.section === ws.section);
    const parts = {
        files: sidebarFiles, search: sidebarSearch, labels: sidebarLabels, problems: sidebarProblems, timeline: sidebarTimeline,
    }[ws.section]();
    ui.sidebar.replaceChildren(...parts);
}

function foldButton(group, label) {
    const folded = ws.folded.has(group);
    const b = el('button', { type: 'button', class: 'wihero-ws-fold', title: folded ? `Unfold ${label}` : `Fold ${label} into one card` }, folded ? 'unfold' : 'fold');
    b.addEventListener('click', e => {
        e.stopPropagation();
        if (folded) ws.folded.delete(group); else ws.folded.add(group);
        draw({ keepView: true });
    });
    return b;
}

function sidebarFiles() {
    const onGraph = ws.entries.filter(e => !ws.graph.unlinked.includes(e));
    const folders = folderList(onGraph);
    const top = onGraph.filter(e => !(e.wihero?.folder ?? '').trim());
    const tree = [];
    for (const f of folders) {
        const depth = f.split('/').length - 1;
        tree.push(el('div', { class: 'wihero-ws-folder', style: `padding-left: ${depth * 12}px` }, el('span', {}, f.split('/').pop()), foldButton(`folder:${f}`, f)));
        for (const e of onGraph.filter(x => (x.wihero?.folder ?? '').split('/').map(s => s.trim()).filter(Boolean).join('/') === f)) {
            tree.push(el('div', { style: `padding-left: ${depth * 12 + 12}px` }, entryButton(e)));
        }
    }
    const bookmarks = (deps.settings.bookmarks?.[ws.book] ?? []).map(key => entryOf(key)).filter(Boolean);
    return [
        heading('ENTRIES'), ...tree, ...top.map(e => entryButton(e)),
        heading('NOT LINKED YET'), ...(ws.graph.unlinked.length ? ws.graph.unlinked.map(e => entryButton(e)) : [el('small', {}, 'Everything is linked.')]),
        heading('BOOKMARKS'), ...(bookmarks.length ? bookmarks.map(e => entryButton(e)) : [el('small', {}, 'Star an entry in the right panel.')]),
    ];
}

function sidebarSearch() {
    const input = el('input', { type: 'search', class: 'text_pole', placeholder: 'id, title, keyword or text', 'aria-label': 'Search entries', name: 'wihero_ws_search' });
    input.value = ws.search;
    const list = el('div', { class: 'wihero-ws-results' });
    const update = () => {
        ws.search = input.value;
        const q = input.value.trim().toLowerCase();
        const hits = q ? ws.entries.filter(e => [e.wihero?.id, e.comment, ...(e.key ?? []), e.content].some(s => String(s ?? '').toLowerCase().includes(q))) : [];
        list.replaceChildren(...hits.slice(0, 100).map(e => entryButton(e)));
    };
    input.addEventListener('input', update);
    update();
    setTimeout(() => input.focus(), 0);
    return [heading('SEARCH'), input, list];
}

function sidebarLabels() {
    const labels = [...ws.model.labels.entries()].filter(([, ids]) => ids.some(id => ws.model.nodes.get(id)?.world === ws.book));
    return [heading('LABELS'), ...(labels.length ? labels.map(([name, ids]) =>
        el('div', { class: 'wihero-ws-folder' }, el('span', {}, `#${name} `, el('small', {}, String(ids.length))), foldButton(`#${name}`, `#${name}`)))
        : [el('small', {}, 'No labels in this book.')])];
}

function sidebarProblems() {
    const issues = issuesHere();
    return [heading('PROBLEMS AND WARNINGS'), ...(issues.length ? issues.map(i => {
        const b = el('button', { type: 'button', class: `wihero-ws-item ${i.warning ? 'wihero-warning' : 'wihero-problem'}` }, el('b', {}, i.id ?? i.label), ` ${i.message}`);
        b.addEventListener('click', () => selectNode(i.key, { center: true }));
        return b;
    }) : [el('small', {}, 'No problems.')])];
}

function sidebarTimeline() {
    const chat = deps.ctx().chat ?? [];
    const rows = [];
    chat.forEach((m, i) => {
        const snap = m?.extra?.[FIELD];
        if (!snap) return;
        const ids = (snap.round ?? []).map(k => ws.model.byKey.get(k)?.id).filter(Boolean);
        const b = el('button', { type: 'button', class: `wihero-ws-item${ws.scrub === i ? ' wihero-ws-item-on' : ''}` }, `#${i} `, el('small', {}, ids.length ? `fired ${ids.join(', ')}` : 'nothing gated fired'));
        b.addEventListener('click', () => { ws.scrub = i; draw({ keepView: true }); });
        rows.push(b);
    });
    return [heading('THIS CHAT'), ...(rows.length ? rows : [el('small', {}, 'No replies with WI Hero state yet.')])];
}

// ── Right panel and reader ───────────────────────────────────────────

/** "Fires only after road, then closes it" and friends, from the links of the shown graph. */
function linkLines(key) {
    const name = k => ws.graph.nodes.get(k)?.id ?? k;
    const out = ws.graph.links.filter(l => l.from === key && l.type !== 'mask');
    const into = ws.graph.links.filter(l => l.to === key && l.type !== 'mask');
    return {
        out: out.map(l => `${LINK_NAMES[l.type]} → ${name(l.to)}`),
        into: into.map(l => `${name(l.from)} → ${LINK_NAMES[l.type]}`),
    };
}

function history(id) {
    const chat = deps.ctx().chat ?? [];
    const lines = [];
    chat.forEach((m, i) => {
        const snap = m?.extra?.[FIELD];
        if (!snap) return;
        const node = ws.model.nodes.get(id);
        if (node && (snap.round ?? []).includes(node.key)) lines.push(`fired at #${i}`);
        const before = stateBefore(chat, i).state;
        if (snap.closed?.[id] && !before.closed[id]) lines.push(`closed at #${i}`);
    });
    return lines;
}

function summary(key, state, { wide = false, head = false } = {}) {
    const entry = entryOf(key);
    const node = ws.graph.nodes.get(key);
    if (!entry) {
        if (node?.kind === 'label') return [el('b', { class: 'wihero-ws-title' }, node.title), el('small', {}, `Carried by ${node.members.join(', ')}`)];
        return [el('small', { class: 'wihero-ws-empty' }, 'Select an entry to see it here.')];
    }
    const m = ws.model.byKey.get(key);
    const status = m ? eligibility(m, ws.model, state).reason : 'not gated';
    const { out, into } = linkLines(key);
    const starred = (deps.settings.bookmarks?.[ws.book] ?? []).includes(key);
    const star = el('button', { type: 'button', class: 'wihero-ws-button', 'aria-pressed': String(starred) }, starred ? 'Bookmarked' : 'Bookmark');
    star.addEventListener('click', () => {
        const list = new Set(deps.settings.bookmarks?.[ws.book] ?? []);
        if (starred) list.delete(key); else list.add(key);
        deps.settings.bookmarks = { ...deps.settings.bookmarks, [ws.book]: [...list] };
        deps.save();
        ws.panelFor = '';
        draw({ keepView: true });
    });
    const openST = el('button', { type: 'button', class: 'wihero-ws-button' }, "Open in ST's entry editor");
    openST.addEventListener('click', () => { closeWorkspace(); deps.openInST(ws.book, entry.uid); });
    const list = (title, items) => items.length ? [heading(title), ...items.map(t => el('span', { class: 'wihero-ws-line' }, t))] : [];
    const content = entry.content ?? '';
    if (head) {
        return [
            el('div', { class: 'wihero-ws-head' }, el('b', { class: 'wihero-ws-title' }, entry.comment || m?.id || `uid ${entry.uid}`),
                el('span', { class: `wihero-badge ${statusClass(status)}` }, shortStatus(status) ?? 'not gated')),
            el('small', {}, `${m?.id ? `id ${m.id} · ` : ''}uid ${entry.uid}${entry.wihero?.folder ? ` · ${entry.wihero.folder}` : ''} · ${status}`),
            el('div', { class: 'wihero-ws-row' }, star, openST),
        ];
    }
    return [
        el('div', { class: 'wihero-ws-head' }, el('b', { class: 'wihero-ws-title' }, entry.comment || m?.id || `uid ${entry.uid}`),
            el('span', { class: `wihero-badge ${statusClass(status)}` }, shortStatus(status) ?? 'not gated')),
        el('small', {}, `${m?.id ? `id ${m.id} · ` : ''}uid ${entry.uid}${entry.wihero?.folder ? ` · ${entry.wihero.folder}` : ''} · ${status}`),
        el('small', {}, `keys: ${(entry.key ?? []).join(', ') || 'none'}`),
        el('div', { class: 'wihero-ws-content' }, wide || content.length < 600 ? content : `${content.slice(0, 600)}…`),
        ...list('LINKS OUT', out), ...list('BACKLINKS', into), ...list('IN THIS CHAT', m?.id ? history(m.id) : []),
        el('div', { class: 'wihero-ws-row' }, star, openST),
    ];
}

/** The right panel: the selected entry's editor. Rebuilt only when the entry, the tab or the book changes, so typing survives refreshes. */
function drawPanel(state, { force = false } = {}) {
    const id = `${ws.selected}|${ws.panelTab}|${ws.version}`;
    if (!force && id === ws.panelFor) return;
    ws.panelFor = id;
    const entry = entryOf(ws.selected);
    if (!entry) return ui.panel.replaceChildren(...summary(ws.selected, state));
    const tabs = [['entry', 'Entry'], ['logic', 'Story logic'], ['timers', 'Timers'], ['links', 'Links']].map(([key, label]) => {
        const b = el('button', { type: 'button', role: 'tab', class: `wihero-ws-tab${ws.panelTab === key ? ' wihero-ws-tab-on' : ''}`, 'data-tab': key, 'aria-selected': String(ws.panelTab === key) }, label);
        b.addEventListener('click', () => { ws.panelTab = key; drawPanel(state); });
        return b;
    });
    const body = { entry: entryTab, logic: logicTab, timers: timersTab, links: linksTab }[ws.panelTab](entry, state);
    ui.panel.replaceChildren(...summary(ws.selected, state, { head: true }), el('div', { class: 'wihero-ws-tabs wihero-ws-paneltabs', role: 'tablist' }, ...tabs), ...body);
}

/** Saves a change to the book through ST, as the entry editor block does, then reloads the workspace. */
async function saveBook(edit, status) {
    const ctx = deps.ctx();
    ui.saved.textContent = 'Saving…';
    const data = await ctx.loadWorldInfo(ws.book);
    if (!data) return;
    edit(data);
    await ctx.saveWorldInfo(ws.book, data, true);
    ctx.reloadWorldInfoEditor(ws.book);
    ui.saved.textContent = 'All changes saved';
    if (status) status.textContent = 'Saved';
    deps.onSaved?.();
    await load();
}

const hint = () => el('small', { class: 'wihero-hint' }, 'Saving changes the entry, which resets its own sticky and cooldown timers, like any edit.');

/** A form for some ST fields of the entry, with Save. */
function fieldsForm(entry, specs, { more = [] } = {}) {
    const inputs = new Map();
    const control = spec => {
        const value = fieldText(spec, entry[spec.field]);
        let input;
        if (spec.type === 'textarea') input = el('textarea', { class: 'text_pole', rows: '8' });
        else if (spec.type === 'bool') input = el('input', { type: 'checkbox' });
        else if (spec.type === 'select' || spec.type === 'tristate') input = el('select', { class: 'text_pole' }, ...spec.options.map(([v, l]) => el('option', { value: String(v) }, l)));
        else input = el('input', { type: spec.type === 'int' ? 'number' : 'text', class: 'text_pole' });
        input.name = `wihero_entry_${spec.field}`;
        if (spec.type === 'bool') input.checked = value; else input.value = value;
        inputs.set(spec.field, input);
        return spec.type === 'bool'
            ? el('label', { class: 'checkbox_label' }, input, el('span', {}, spec.label))
            : el('label', { class: 'wihero-field' }, el('small', {}, spec.label), input);
    };
    const shown = specs.map(control);
    const extra = more.length ? [el('details', { class: 'wihero-ws-more' }, el('summary', {}, 'More'), ...more.map(control))] : [];
    const status = el('small', { class: 'wihero-entry-status' });
    const save = el('button', { type: 'button', class: 'wihero-ws-button wihero-ws-save' }, 'Save');
    save.addEventListener('click', () => {
        const read = f => { const i = inputs.get(f); return i.type === 'checkbox' ? i.checked : i.value; };
        const { changes, errors } = formChanges(entry, [...specs, ...more], read);
        if (errors.length) return void (status.textContent = errors.join('; '));
        if (!Object.keys(changes).length) return void (status.textContent = 'Nothing changed');
        saveBook(data => applyEntryChanges(data, entry.uid, changes, originalWIDataKeyMap), status);
    });
    return [el('div', { class: 'wihero-ws-form' }, ...shown), ...extra, hint(), el('div', { class: 'wihero-ws-row' }, save, status)];
}

function entryTab(entry) {
    return fieldsForm(entry, ENTRY_FIELDS.filter(s => !s.more), { more: ENTRY_FIELDS.filter(s => s.more) });
}

function timersTab(entry) {
    return [el('small', {}, "ST's own timers, counted in messages (a turn is two). WI Hero never changes them."), ...fieldsForm(entry, TIMER_FIELDS)];
}

function logicTab(entry) {
    const { content } = logicForm(ws.book, entry.uid, ws.data, {
        title: () => entry.comment ?? '',
        onSave: (config, status) => saveBook(data => applyConfig(data.entries[entry.uid], config), status),
    });
    return [content];
}

function linksTab(entry, state) {
    const key = entryKey(entry);
    const { out, into } = linkLines(key);
    const id = ws.model.byKey.get(key)?.id;
    const list = (title, items, empty) => [heading(title), ...(items.length ? items.map(t => el('span', { class: 'wihero-ws-line' }, t)) : [el('small', {}, empty)])];
    const ignored = new Set(deps.settings.ignoredMentions?.[ws.book]?.[key] ?? []);
    const mentions = unlinkedMentions(ws.entries, ws.graph, entry, ignored).map(({ entry: other, keyword }) => {
        const okey = entryKey(other);
        const name = other.wihero?.id ?? (other.comment || `uid ${other.uid}`);
        const gate = el('button', { type: 'button', class: 'wihero-ws-button wihero-ws-gate-on' }, `Gate ${name} on ${id ?? (entry.comment || 'this')}`);
        gate.addEventListener('click', () => saveBook(data => gateOn(data, other.uid, entry.uid, new Set(ws.model.nodes.keys()))));
        const ignore = el('button', { type: 'button', class: 'wihero-ws-button' }, 'Ignore');
        ignore.addEventListener('click', () => {
            const all = deps.settings.ignoredMentions ??= {};
            const book = all[ws.book] ??= {};
            book[key] = [...new Set([...(book[key] ?? []), okey])];
            deps.save();
            drawPanel(state, { force: true });
        });
        return el('div', { class: 'wihero-ws-mention' }, el('span', {}, el('b', {}, name), ` mentions "${keyword}"`), el('div', { class: 'wihero-ws-row' }, gate, ignore));
    });
    return [
        ...list('LINKS OUT', out, 'None.'),
        ...list('BACKLINKS', into, 'None.'),
        ...list('IN THIS CHAT', id ? history(id) : [], id ? 'Not fired in this chat.' : 'Not gated.'),
        heading('UNLINKED MENTIONS'), ...(mentions.length ? mentions : [el('small', {}, 'No other entry mentions its keywords.')]),
    ];
}

function drawReader(key, state) {
    ui.reader.replaceChildren(...summary(key, state, { wide: true }));
}

// ── Canvas ───────────────────────────────────────────────────────────

/** Changes the book's canvas in settings, with undo. */
function editCanvas(change, { redraw = true } = {}) {
    const canvas = canvasOf(deps.settings, ws.book);
    pushUndo(ws.undo[ws.book] ??= [], canvas);
    change(canvas);
    deps.save();
    if (redraw) draw({ keepView: true });
}

function undo() {
    const stack = ws.undo[ws.book];
    if (!stack?.length) return void toastr.info('Nothing to undo.', 'WI Hero');
    deps.settings.canvas[ws.book] = JSON.parse(stack.pop());
    deps.save();
    draw({ keepView: true });
}

/** A new area or note in the middle of the view. */
function addBox(list, fields) {
    const r = ui.stage.getBoundingClientRect();
    const c = view.toWorld(r.left + r.width / 2, r.top + r.height / 2);
    editCanvas(canvas => canvas[list].push({ id: `${list[0]}${Date.now().toString(36)}`, x: Math.round(c.x - fields.w / 2), y: Math.round(c.y - fields.h / 2), ...fields }));
}

async function tidy() {
    const ok = await deps.ctx().callGenericPopup('Lay every card out automatically again? Areas and notes stay where they are. Undo brings your arrangement back.', deps.ctx().POPUP_TYPE.CONFIRM);
    if (ok) editCanvas(c => { c.pos = {}; c.boxes = {}; });
}

function boxChanged(kind, id, rect) {
    editCanvas(canvas => {
        if (kind === 'label') canvas.boxes[id] = rect;
        else Object.assign(canvas[`${kind}s`].find(x => x.id === id), rect);
    }, { redraw: false });
}

/** A card was dropped: remember where, and if it entered or left a label box, offer to add or remove the label. */
async function moved(key, x, y) {
    const node = ws.shown.nodes.get(key);
    if (!node) return;
    editCanvas(c => { c.pos[placeKey(node)] = { x, y }; }, { redraw: false });
    if (node.kind !== 'entry' || node.external) return draw({ keepView: true });
    const p = ws.placed.pos.get(key);
    const centre = { x: p.x + p.w / 2, y: p.y + p.h / 2 };
    const has = new Set(node.node.labels);
    for (const [k, box] of ws.placed.pos) {
        if (!box.box) continue;
        const label = k.slice(1);
        const within = inside(centre, box);
        if (within === has.has(label)) continue;
        const ctx = deps.ctx();
        const ok = await ctx.callGenericPopup(`${within ? 'Add' : 'Remove'} #${label} ${within ? 'to' : 'from'} ${node.id}?<br><small>This edits the entry, which resets its own sticky and cooldown timers, like any edit.</small>`, ctx.POPUP_TYPE.CONFIRM);
        if (ok) return saveBook(data => setLabel(data.entries[node.uid], label, within, new Set(ws.model.nodes.keys())));
    }
    draw({ keepView: true });
}

/** After a link is drawn onto something: a small menu of what it can mean. */
function linkMenu(fromKey, toKey, x, y) {
    root.querySelector('.wihero-link-menu')?.remove();
    const from = ws.shown.nodes.get(fromKey);
    const to = toKey && ws.shown.nodes.get(toKey);
    if (!to) return;
    const options = linkOptions(from, to);
    if (!options.length) return void toastr.info("These two can't be linked.", 'WI Hero');
    const menu = el('div', { class: 'wihero-link-menu', role: 'menu' },
        el('small', { class: 'wihero-ws-heading' }, 'THIS LINK MEANS'),
        ...options.map(o => {
            const b = el('button', { type: 'button', role: 'menuitem', class: 'wihero-ws-item', 'data-type': o.type }, o.label);
            b.addEventListener('click', () => { menu.remove(); link(from, to, o.type); });
            return b;
        }),
        el('small', { class: 'wihero-hint' }, 'This edits the entry, which resets its own timers, like any edit.'));
    const cancel = el('button', { type: 'button', class: 'wihero-ws-button' }, 'Cancel');
    cancel.addEventListener('click', () => menu.remove());
    menu.append(cancel);
    Object.assign(menu.style, { left: `${Math.min(x, window.innerWidth - 340)}px`, top: `${Math.min(y, window.innerHeight - 260)}px` });
    root.append(menu);
    menu.querySelector('button')?.focus();
}

/** Applies a link if the engine has no new problem with it; otherwise says why not. */
async function link(from, to, type) {
    const before = await deps.ctx().loadWorldInfo(ws.book);
    const after = structuredClone(before);
    const uids = applyLink(after, from, to, type, new Set(ws.model.nodes.keys()));
    const others = deps.loadedEntries().filter(e => e.world !== ws.book);
    const problems = newProblems(others, ws.book, before, after, uids);
    if (problems.length) return void toastr.warning(`Not linked: ${problems.join('; ')}`, 'WI Hero');
    await saveBook(data => applyLink(data, from, to, type, new Set(ws.model.nodes.keys())));
}
