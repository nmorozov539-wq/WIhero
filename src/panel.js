// Settings panel in the Extensions drawer: the gated entries and their status for the next generation.

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
                el('label', { class: 'checkbox_label', for: 'wihero_enabled' }, enabled, el('span', {}, 'Enabled')),
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

    table.replaceChildren(
        el('tr', {}, el('th', {}, 'Entry'), el('th', {}, 'Next turn'), el('th', { title: 'Times fired in this chat' }, 'Fired')),
        ...rows.map(r => el('tr', { class: r.lastRound ? 'wihero-last-round' : '', title: r.key },
            el('td', {}, r.id, ...(r.labels?.length ? [el('small', { class: 'wihero-labels' }, r.labels.map(l => `#${l}`).join(' '))] : [])),
            el('td', { class: `wihero-status-${r.status.split(' ')[0]}` }, r.status, ...reopenButton(r)),
            el('td', {}, String(r.fired)))),
    );
}
