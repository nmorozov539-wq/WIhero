// The old build's settings panel in the Extensions drawer, kept for testing N1: every entry with story logic
// and its status for the next generation, the problems, and Reopen. The real UI comes in N2–N4.

let handlers = {};
let summary;
let table;
let issueList;
let notice;
let gapBox;

export function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) if (value !== null && value !== undefined) node.setAttribute(name, value);
    node.append(...children);
    return node;
}

export function mountPanel({ settings, handlers: h }) {
    handlers = h;
    const enabled = el('input', { type: 'checkbox', id: 'wihero_enabled' });
    enabled.checked = settings.enabled;
    enabled.addEventListener('change', () => handlers.onToggle(enabled.checked));
    const bubble = el('input', { type: 'checkbox', id: 'wihero_bubble_on' });
    bubble.checked = settings.bubble !== false;
    bubble.addEventListener('change', () => handlers.onBubble?.(bubble.checked));
    notice = el('div', { id: 'wihero_notice', class: 'wihero-notice' });
    gapBox = el('div', { id: 'wihero_gap', class: 'wihero-gap' });
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
                el('div', { class: 'wihero-panel-top' },
                    el('label', { class: 'checkbox_label', for: 'wihero_enabled' }, enabled, el('span', {}, 'Enabled')),
                    el('label', { class: 'checkbox_label', for: 'wihero_bubble_on', title: 'A book button in the chat with how many entries reached the model' }, bubble, el('span', {}, 'Chat bubble'))),
                notice,
                gapBox,
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

/** The compatibility lines (BUILD_SPEC 17.2): versions drifted, or the engine stood down. */
export function renderNotice(lines) {
    if (!notice) return;
    notice.replaceChildren(...lines.filter(Boolean).map(t => el('div', {}, t)));
}

/** The gap actions (BUILD_SPEC 17.1), for replies that ran without WI Hero. */
export function gapActions(gap, onFix) {
    const n = gap.skipped.length;
    const box = el('div', { class: 'wihero-gap-box' },
        el('div', {}, `WI Hero was off for ${plural(n, 'reply', 'replies')}, so the story state is from ${gap.from < 0 ? 'the start of the chat' : `message #${gap.from}`}.`));
    const row = el('div', { class: 'wihero-gap-actions' });
    for (const [how, label, title] of [
        ['catchUp', 'Catch up', 'Replay the skipped replies one by one, oldest first, matching key words as Preview does'],
        ['keep', 'Keep as is', 'Carry the old story state on from here'],
        ['fresh', 'Start from here', 'Start the story state again from the newest reply'],
    ]) {
        const b = el('div', { class: 'menu_button wihero-gap-button', 'data-how': how, title }, label);
        b.addEventListener('click', () => onFix(how));
        row.append(b);
    }
    box.append(row);
    return box;
}

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
        gapBox.replaceChildren();
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

    gapBox.replaceChildren(...(view.gap && view.enabled ? [gapActions(view.gap, how => handlers.onFixGap?.(how))] : []));
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
