// Settings panel in the Extensions drawer: the gated entries and their status for the next generation.
import { normalizeFolder } from './bulk.js';
import { statusClass } from './status.js';

let handlers = {};
let summary;
let table;
let issueList;
let labelFilter;
/** Label the table is filtered to, '' for all. Kept across renders. */
let shownLabel = '';
let lastView = null;

export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    node.append(...children);
    return node;
}

export function mountPanel({ settings, handlers: h }) {
    handlers = h;
    const enabled = el('input', { type: 'checkbox', id: 'wihero_enabled' });
    enabled.checked = settings.enabled;
    enabled.addEventListener('change', () => handlers.onToggle(enabled.checked));
    const open = el('div', { class: 'menu_button wihero-open-workspace', title: 'Open the WI Hero workspace: graph and editor for a book' }, 'Open workspace');
    open.addEventListener('click', () => handlers.onOpenWorkspace?.());

    summary = el('div', { id: 'wihero_summary' });
    table = el('table', { id: 'wihero_entries', class: 'wihero-table' });
    issueList = el('ul', { id: 'wihero_issues', class: 'wihero-issues' });
    labelFilter = el('select', { id: 'wihero_label_filter', class: 'text_pole', title: 'Show only the entries with this label' });
    labelFilter.addEventListener('change', () => { shownLabel = labelFilter.value; render(lastView); });

    const root = el('div', { class: 'wihero-settings' },
        el('div', { class: 'inline-drawer' },
            el('div', { class: 'inline-drawer-toggle inline-drawer-header' },
                el('b', {}, 'WI Hero'),
                el('div', { class: 'inline-drawer-icon fa-solid fa-circle-chevron-down down' }),
            ),
            el('div', { class: 'inline-drawer-content' },
                el('div', { class: 'wihero-panel-top' }, el('label', { class: 'checkbox_label', for: 'wihero_enabled' }, enabled, el('span', {}, 'Enabled')), open),
                summary,
                issueList,
                labelFilter,
                table,
            ),
        ),
    );
    document.getElementById('extensions_settings2')?.append(root);
    render(null);
}

/** The manual escape hatch on a closed entry. */
function reopenButton(row) {
    if (!row.status.startsWith('closed') || !row.id) return [];
    const button = el('span', { class: 'wihero-reopen', title: 'Reopen this entry from the current message on' }, 'Reopen');
    button.addEventListener('click', () => handlers.onReopen?.(row.id));
    return [' ', button];
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {{ rows: object[], issues: object[], enabled: boolean, from: number, roundSize: number } | null} view
 */
export function render(view) {
    if (!summary) return;
    lastView = view;
    if (!view) {
        summary.textContent = 'No lorebooks loaded yet. Open a chat to load them.';
        table.replaceChildren();
        issueList.replaceChildren();
        return;
    }
    const parts = [plural(view.rows.length, 'gated entry', 'gated entries')];
    const problems = view.issues.filter(i => !i.warning).length;
    const warnings = view.issues.length - problems;
    if (problems) parts.push(plural(problems, 'problem', 'problems'));
    if (warnings) parts.push(plural(warnings, 'warning', 'warnings'));
    parts.push(view.from < 0 ? 'story start' : `state from message #${view.from}, ${plural(view.roundSize, 'entry', 'entries')} fired there`);
    if (!view.enabled) parts.push('disabled: ST scans every entry');
    summary.textContent = parts.join(' · ');

    issueList.replaceChildren(...view.issues.map(i =>
        el('li', { title: i.key, class: i.warning ? 'wihero-warning' : '' }, el('b', {}, i.id ?? i.label), ` ${i.message}`)));

    const labels = view.labels ?? [];
    if (shownLabel && !labels.includes(shownLabel)) shownLabel = '';
    labelFilter.replaceChildren(el('option', { value: '' }, 'All labels'), ...labels.map(l => el('option', { value: l }, `#${l}`)));
    labelFilter.value = shownLabel;
    labelFilter.style.display = labels.length ? '' : 'none';
    const rows = shownLabel ? view.rows.filter(r => r.labels?.includes(shownLabel)) : view.rows;

    // Grouped by folder (the order within a folder is kept); entries without one come first, unheaded.
    const groups = new Map();
    for (const r of rows) {
        const folder = normalizeFolder(r.folder);
        if (!groups.has(folder)) groups.set(folder, []);
        groups.get(folder).push(r);
    }
    const folders = [...groups.keys()].sort((a, b) => a === '' ? -1 : b === '' ? 1 : a.localeCompare(b));
    table.replaceChildren(
        el('tr', {}, el('th', {}, 'Entry'), el('th', {}, 'Next turn'), el('th', { title: 'Times fired in this chat' }, 'Fired')),
        ...folders.flatMap(folder => [
            ...(folder ? [el('tr', { class: 'wihero-folder-row' }, el('td', { colspan: '3' }, folder))] : []),
            ...groups.get(folder).map(entryRow),
        ]),
    );
}

function entryRow(r) {
    return el('tr', { class: `wihero-entry-row${r.lastRound ? ' wihero-last-round' : ''}`, title: r.key },
        el('td', {}, r.id, ...(r.labels?.length ? [el('small', { class: 'wihero-labels' }, r.labels.map(l => `#${l}`).join(' '))] : [])),
        el('td', { class: statusClass(r.status) }, r.status, ...reopenButton(r)),
        el('td', {}, String(r.fired)));
}
