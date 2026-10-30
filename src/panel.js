// Settings panel in the Extensions drawer: the gated entries and their status for the next generation.

let handlers = {};
let summary;
let table;
let issueList;

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
                table,
            ),
        ),
    );
    document.getElementById('extensions_settings2')?.append(root);
    render(null);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * @param {{ rows: object[], issues: object[], enabled: boolean, from: number, roundSize: number } | null} view
 */
export function render(view) {
    if (!summary) return;
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

    table.replaceChildren(
        el('tr', {}, el('th', {}, 'Entry'), el('th', {}, 'Next turn'), el('th', { title: 'Times fired in this chat' }, 'Fired')),
        ...view.rows.map(r => el('tr', { class: r.lastRound ? 'wihero-last-round' : '', title: r.key },
            el('td', {}, r.id),
            el('td', { class: `wihero-status-${r.status.split(' ')[0]}` }, r.status),
            el('td', {}, String(r.fired)))),
    );
}
