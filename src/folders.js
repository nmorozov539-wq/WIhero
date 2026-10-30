// Folder filter and bulk actions above ST's World Info entry list. The logic is in bulk.js.
// The filter is one more function in ST's own worldInfoFilter, so it works with ST's search, sort and
// pagination (docs/TECHNICAL_NOTES.md section 10).
import { el } from './panel.js';
import { ACTIONS, COLORS, NO_FOLDER, bulkEdit, folderList, inFolder } from './bulk.js';
import { worldInfoFilter } from './st.js';

const FILTER = 'wihero_folder';
let deps;
let select;
let bar;

/** @param {{ ctx: () => object, bookName: () => string, onSaved: () => void }} d */
export function mountFolders(d) {
    deps = d;
    const search = document.getElementById('world_info_search');
    if (!search || !worldInfoFilter?.filterFunctions) return;
    worldInfoFilter.filterData[FILTER] = '';
    worldInfoFilter.filterFunctions[FILTER] = data => data.filter(entry => inFolder(entry, worldInfoFilter.filterData[FILTER]));

    select = el('select', { id: 'wihero_folder_filter', class: 'text_pole textarea_compact', title: 'WI Hero folder: show only the entries in it' });
    select.addEventListener('change', () => {
        worldInfoFilter.setFilterData(FILTER, select.value);
        bar.style.display = select.value ? '' : 'none';
    });
    bar = bulkBar();
    bar.style.display = 'none';
    const open = el('div', { class: 'menu_button wihero-open-workspace', title: 'Open this book in the WI Hero workspace' }, 'Workspace');
    open.addEventListener('click', () => deps.onOpenWorkspace());
    search.after(el('div', { class: 'wihero-folders' }, select, open, bar));

    const list = document.getElementById('world_popup_entries_list');
    if (list) new MutationObserver(() => refreshFolders()).observe(list, { childList: true });
    refreshFolders();
}

/** Rebuilds the folder choices from the open book, keeping the current one if it still exists. */
async function refreshFolders() {
    const name = deps.bookName();
    const data = name ? await deps.ctx().loadWorldInfo(name) : null;
    const folders = folderList(Object.values(data?.entries ?? {}));
    const current = worldInfoFilter.filterData[FILTER];
    const options = [el('option', { value: '' }, 'All folders'), el('option', { value: NO_FOLDER }, 'No folder'),
        ...folders.map(f => el('option', { value: f }, f.split('/').map((_, i, a) => i < a.length - 1 ? '  ' : _).join('')))];
    const key = JSON.stringify(folders);
    if (select.dataset.folders !== key) {
        select.replaceChildren(...options);
        select.dataset.folders = key;
    }
    const keep = current === NO_FOLDER || folders.includes(current) ? current : '';
    select.value = keep;
    bar.style.display = keep ? '' : 'none';
    if (keep !== current) worldInfoFilter.setFilterData(FILTER, keep);
}

function bulkBar() {
    const action = el('select', { class: 'text_pole textarea_compact', name: 'wihero_bulk_action' },
        ...Object.entries(ACTIONS).map(([value, a]) => el('option', { value }, a.label)));
    const number = el('input', { type: 'number', class: 'text_pole textarea_compact', name: 'wihero_bulk_number' });
    const text = el('input', { type: 'text', class: 'text_pole textarea_compact', name: 'wihero_bulk_text', placeholder: 'prefix' });
    const color = el('select', { class: 'text_pole textarea_compact', name: 'wihero_bulk_color' },
        el('option', { value: '' }, 'no color'), ...Object.keys(COLORS).map(c => el('option', { value: c }, c)));
    const apply = el('div', { class: 'menu_button wihero-bulk-apply', title: 'Apply to every entry in this folder' }, 'Apply');
    const show = () => {
        const input = ACTIONS[action.value].input;
        number.style.display = input === 'number' ? '' : 'none';
        text.style.display = input === 'text' ? '' : 'none';
        color.style.display = input === 'color' ? '' : 'none';
    };
    action.addEventListener('change', show);
    show();
    apply.addEventListener('click', () => {
        const input = ACTIONS[action.value].input;
        const value = input === 'number' ? number.value : input === 'text' ? text.value : input === 'color' ? color.value : null;
        run(action.value, value).catch(error => console.error('[WI Hero] bulk edit', error));
    });
    return el('div', { class: 'wihero-bulk', title: 'Bulk edits change the entries, which resets their sticky and cooldown timers, like any edit.' },
        el('small', {}, 'In this folder:'), action, number, text, color, apply);
}

/** Asks, then edits the folder's entries in a copy of the book and saves it through ST, as the entry editor does. */
async function run(action, value) {
    const ctx = deps.ctx();
    const name = deps.bookName();
    const folder = worldInfoFilter.filterData[FILTER];
    const data = await ctx.loadWorldInfo(name);
    if (!data || !folder) return;
    const count = Object.values(data.entries ?? {}).filter(e => inFolder(e, folder)).length;
    const result = bulkEdit(structuredClone(data), folder, action, value);
    if (result.error) return void toastr.warning(result.error, 'WI Hero');
    const where = folder === NO_FOLDER ? 'entries without a folder' : `entries in ${folder}`;
    const ok = await ctx.callGenericPopup(
        `${ACTIONS[action].label}${value !== null && value !== '' ? ` (${value})` : ''} on ${count} ${where}?<br><small>This changes the entries, so their sticky and cooldown timers reset, like any edit.</small>`,
        ctx.POPUP_TYPE.CONFIRM);
    if (!ok) return;
    bulkEdit(data, folder, action, value);
    await ctx.saveWorldInfo(name, data, true);
    ctx.reloadWorldInfoEditor(name);
    toastr.success(`${ACTIONS[action].label}: ${count} entries.`, 'WI Hero');
    deps.onSaved();
}
