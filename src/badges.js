// Color stripe and status badge on each entry row of ST's World Info editor (the collapsed headers).
// Rows are re-rendered by ST on every page change and edit, so a MutationObserver re-decorates them.
import { el } from './panel.js';
import { COLORS } from './bulk.js';
import { shortStatus, statusClass } from './status.js';

let deps;
/** Colors of the open book's entries by uid, loaded when the list renders. */
let colors = new Map();

/** @param {{ ctx: () => object, bookName: () => string, statusOf: (key: string) => string | undefined }} d */
export function mountBadges(d) {
    deps = d;
    const list = document.getElementById('world_popup_entries_list');
    if (!list) return;
    new MutationObserver(() => loadColors().then(updateBadges)).observe(list, { childList: true });
}

async function loadColors() {
    const name = deps.bookName();
    const data = name ? await deps.ctx().loadWorldInfo(name) : null;
    colors = new Map(Object.values(data?.entries ?? {}).map(e => [String(e.uid), e.wihero?.color]));
}

/** Sets every row's stripe and badge from the current statuses. Cheap; called on every panel refresh too. */
export function updateBadges() {
    if (!deps) return;
    const name = deps.bookName();
    for (const row of document.querySelectorAll('#world_popup_entries_list .world_entry')) {
        const uid = row.getAttribute('uid');
        const color = COLORS[colors.get(uid)];
        row.classList.toggle('wihero-colored', !!color);
        if (color) row.style.setProperty('--wihero-color', color);
        else row.style.removeProperty('--wihero-color');

        const status = name ? deps.statusOf(`${name}.${uid}`) : undefined;
        const short = status === undefined ? null : shortStatus(status);
        let badge = row.querySelector(':scope .wihero-badge');
        if (!short) {
            badge?.remove();
            continue;
        }
        if (!badge) {
            badge = el('span', { class: 'wihero-badge' });
            const title = row.querySelector('.WIEntryTitleAndStatus');
            (title ?? row.querySelector('.inline-drawer-header'))?.append(badge);
        }
        badge.textContent = short;
        badge.title = `WI Hero: ${status}`;
        badge.className = `wihero-badge ${statusClass(status)}`;
    }
}
