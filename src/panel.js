// The old build's settings panel in the Extensions drawer, kept for testing N1: every entry with story logic
// and its status for the next generation, the problems, and Reopen. The real UI comes in N2–N4.

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
                el('div', { class: 'wihero-panel-top' }, el('label', { class: 'checkbox_label', for: 'wihero_enabled' }, enabled, el('span', {}, 'Enabled'))),
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
 *   rows: { key, id, book, status, text, fired, lastRound, closed }
 */
export function render(view) {
    if (!summary) return;
    if (!view) {
        summary.textContent = 'No lorebooks loaded yet. Open a chat to load them.';
        table.replaceChildren();
        issueList.replaceChildren();
        return;
    }
    const parts = [plural(view.rows.length, 'entry with story logic', 'entries with story logic')];
    const problems = view.issues.filter(i => !i.warning).length;
    const warnings = view.issues.length - problems;
    if (problems) parts.push(plural(problems, 'problem', 'problems'));
    if (warnings) parts.push(plural(warnings, 'warning', 'warnings'));
    parts.push(view.from < 0 ? 'story start' : `state from message #${view.from}, ${plural(view.roundSize, 'entry', 'entries')} fired there`);
    if (!view.enabled) parts.push('disabled: ST scans every entry');
    summary.textContent = parts.join(' · ');

    issueList.replaceChildren(...view.issues.map(i =>
        el('li', { title: i.key ?? '', class: i.warning ? 'wihero-warning' : 'wihero-problem' }, el('b', {}, i.id ?? i.label), ` ${i.message}`)));

    const multiBook = new Set(view.rows.map(r => r.book)).size > 1;
    table.replaceChildren(
        el('tr', {}, el('th', {}, 'Entry'), el('th', {}, 'Next turn'), el('th', { title: 'Times fired in this chat' }, 'Fired')),
        ...view.rows.map(r => el('tr', { class: `wihero-entry-row${r.lastRound ? ' wihero-last-round' : ''}`, title: r.key, 'data-key': r.key },
            el('td', {}, multiBook ? `${r.book}/${r.id ?? r.label}` : (r.id ?? r.label)),
            el('td', { class: `wihero-status-${r.status}` }, r.text, ...reopenButton(r)),
            el('td', {}, String(r.fired)))),
    );
}

/** The manual escape hatch on a closed entry (D5). */
function reopenButton(row) {
    if (row.status !== 'closed') return [];
    const button = el('span', { class: 'wihero-reopen', title: 'Reopen this entry from the latest message on' }, 'Reopen');
    button.addEventListener('click', () => handlers.onReopen?.(row.key));
    return [' ', button];
}
