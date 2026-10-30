// The WI Hero workspace: a full-screen editor for one book, laid out like a notes app. Top bar, ribbon and
// sidebar on the left, tabs over the graph, the selected entry on the right, chat state at the bottom.
// The graph's shape comes from graph.js and layout.js; drawing from graph-view.js.
import { el } from './panel.js';
import { FIELD, buildModel, eligibility, activeMask, entryKey } from './engine.js';
import { stateBefore } from './chat-state.js';
import { buildGraph, collapse, neighborhood } from './graph.js';
import { layout } from './layout.js';
import { createGraphView, LINK_NAMES } from './graph-view.js';
import { shortStatus, statusClass } from './status.js';
import { folderList } from './bulk.js';

let deps;
let root = null;
/** Everything the workspace shows, rebuilt by load(). */
const ws = {
    book: '', data: null, entries: [], model: null, graph: null, shown: null, placed: null,
    selected: null, showState: true, scrub: null, folded: new Set(), local: { on: false, depth: 1 },
    tabs: [{ key: 'graph', title: 'Graph' }], tab: 'graph', section: 'files', search: '',
};
let ui = {};
let view = null;

/**
 * @param {{ ctx: () => object, loadedEntries: () => object[], settings: object, save: () => void,
 *   openInST: (book: string, uid: number) => void, defaultBook: () => string | undefined }} d
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
    refreshWorkspace.timer = setTimeout(() => {
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
    const tools = el('div', { class: 'wihero-ws-tools' },
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
        if (e.key === 'Escape' && !e.target.closest('input, textarea, select')) closeWorkspace();
    });
    document.body.append(root);
    view = createGraphView(ui.stage, {
        onSelect: key => selectNode(key),
        onOpen: key => openTab(key),
        onHover: (key, card) => preview(key, card),
    });
    root.focus();
}

/** Loads the book and rebuilds the model and graph from it and the other loaded books. */
async function load({ fit = false } = {}) {
    const ctx = deps.ctx();
    const names = ctx.getWorldInfoNames();
    ui.bookSelect.replaceChildren(...names.map(n => el('option', { value: n }, n)));
    ui.bookSelect.value = ws.book;
    ws.data = ws.book ? await ctx.loadWorldInfo(ws.book) : null;
    ws.entries = Object.values(ws.data?.entries ?? {}).map(e => ({ ...e, world: ws.book }));
    const others = deps.loadedEntries().filter(e => e.world !== ws.book);
    ws.model = buildModel([...others, ...ws.entries]);
    ws.graph = buildGraph(ws.entries, ws.model, ws.book);
    if (ws.selected && !ws.graph.nodes.has(ws.selected) && !ws.entries.some(e => entryKey(e) === ws.selected)) ws.selected = null;
    ws.tabs = ws.tabs.filter(t => t.key === 'graph' || ws.entries.some(e => entryKey(e) === t.key));
    if (!ws.tabs.some(t => t.key === ws.tab)) ws.tab = 'graph';
    draw({ fit });
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

/** Rebuilds what's shown: folding, local graph, layout, cards, sidebar, panel, status bar. */
function draw({ fit = false, keepView = false } = {}) {
    if (!root || !ws.graph) return;
    let shown = collapse(ws.graph, ws.folded);
    if (ws.local.on && ws.selected && shown.nodes.has(ws.selected)) shown = neighborhood(shown, ws.selected, ws.local.depth);
    ws.shown = shown;
    ws.placed = layout(shown);
    const { state, at, last } = chatState();
    ui.center.replaceChildren(ws.tab === 'graph' ? ui.stage : ui.reader);
    view.render(shown, ws.placed, looks(state), { keepView: keepView && !fit });
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
        const tab = el('button', { type: 'button', role: 'tab', class: `wihero-ws-tab${t.key === ws.tab ? ' wihero-ws-tab-on' : ''}`, 'aria-selected': String(t.key === ws.tab) }, t.title);
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

function summary(key, state, { wide = false } = {}) {
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
        draw({ keepView: true });
    });
    const openST = el('button', { type: 'button', class: 'wihero-ws-button' }, "Open in ST's entry editor");
    openST.addEventListener('click', () => { closeWorkspace(); deps.openInST(ws.book, entry.uid); });
    const list = (title, items) => items.length ? [heading(title), ...items.map(t => el('span', { class: 'wihero-ws-line' }, t))] : [];
    const content = entry.content ?? '';
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

function drawPanel(state) {
    ui.panel.replaceChildren(...summary(ws.selected, state));
}

function drawReader(key, state) {
    ui.reader.replaceChildren(...summary(key, state, { wide: true }));
}
