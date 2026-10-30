// Settings panel in the Extensions drawer.

let handlers = {};
let summary;
let issueList;

function el(tag, attrs = {}, ...children) {
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

    summary = el('div', { id: 'wihero_summary' }, 'No lorebooks loaded yet.');
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
            ),
        ),
    );
    document.getElementById('extensions_settings2')?.append(root);
}

/** @param {{ gated: number, issues: object[] } | null} info */
export function renderSummary(info) {
    if (!summary) return;
    if (!info) {
        summary.textContent = 'No lorebooks loaded yet.';
        issueList.replaceChildren();
        return;
    }
    const problems = info.issues.length ? ` · ${info.issues.length} problem${info.issues.length === 1 ? '' : 's'}` : '';
    summary.textContent = `${info.gated} gated entr${info.gated === 1 ? 'y' : 'ies'}${problems}`;
    issueList.replaceChildren(...info.issues.map(i =>
        el('li', { title: i.key }, el('b', {}, i.id ?? i.label), ` ${i.message}`)));
}
