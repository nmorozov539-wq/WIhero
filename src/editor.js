// WI Hero block in SillyTavern's World Info entry editor. The form logic is in editor-model.js.
// ST renders an entry's edit area only when its drawer opens, and emits no event for it, so a
// MutationObserver on the entry list adds the block to every edit area that appears.
// See docs/TECHNICAL_NOTES.md section 9.
import { el } from './panel.js';
import { COLORS, folderList } from './bulk.js';
import { UI_FIELDS } from './engine.js';
import { EMPTY_MASK, slugify, configToForm, formToConfig, applyConfig, issuesFor, knownIds, knownLabels } from './editor-model.js';

let deps;
/** Uid whose block opens expanded after the editor re-renders on save. */
let reopenUid = null;

/**
 * @param {{ ctx: () => object, loadedEntries: () => object[], onSaved: () => void }} d
 */
export function mountEditor(d) {
    deps = d;
    const list = document.getElementById('world_popup_entries_list');
    if (!list) return;
    new MutationObserver(injectAll).observe(list, { childList: true, subtree: true });
    injectAll();
}

/** Name of the book open in ST's editor (its select's value is an index into the book names). */
export function bookName() {
    const value = document.getElementById('world_editor_select')?.value;
    return value === '' || value === undefined ? undefined : deps.ctx().getWorldInfoNames()[Number(value)];
}

function injectAll() {
    for (const edit of document.querySelectorAll('#world_popup_entries_list .world_entry_edit')) {
        if (edit.querySelector(':scope > .wihero-entry')) continue;
        const uid = edit.closest('.world_entry')?.getAttribute('uid');
        const name = bookName();
        if (uid === null || uid === undefined || !name) continue;
        const block = el('div', { class: 'wihero-entry' });
        edit.append(block);
        fillBlock(block, name, uid).catch(error => console.error('[WI Hero] entry editor', error));
    }
}

/** The other loaded entries, with the edited book's entries taken from its current data. */
function entriesFor(name, data) {
    const book = Object.values(data.entries ?? {}).map(e => ({ ...e, world: name }));
    return [...deps.loadedEntries().filter(e => e.world !== name), ...book];
}

const field = (label, control, hint) => el('label', { class: 'wihero-field' },
    el('small', {}, label), control, ...(hint ? [el('small', { class: 'wihero-hint' }, hint)] : []));

function textInput(name, value, placeholder = '') {
    const input = el('input', { type: 'text', class: 'text_pole', name, placeholder });
    input.value = value;
    return input;
}

function checkbox(name, checked, label) {
    const input = el('input', { type: 'checkbox', name });
    input.checked = checked;
    return [input, el('label', { class: 'checkbox_label' }, input, el('span', {}, label))];
}

/** Clickable ids that add themselves to an id list input. */
function suggestions(input, ids, onChange) {
    const box = el('div', { class: 'wihero-suggestions' });
    const update = () => {
        const used = new Set(input.value.split(/[,\n]/).map(s => s.trim()));
        box.replaceChildren(...ids.filter(id => !used.has(id)).map(id => {
            const chip = el('span', { class: 'wihero-chip', title: `Add ${id}` }, id);
            chip.addEventListener('click', () => {
                input.value = [input.value.trim().replace(/,$/, ''), id].filter(Boolean).join(', ');
                onChange();
            });
            return chip;
        }));
    };
    input.addEventListener('input', update);
    update();
    return [box, update];
}

/** One mask's fields; returns its element, a reader and a chip refresher. */
function maskRow(mask, ids, onChange, onRemove) {
    const name = textInput('wihero_mask_name', mask.name, 'name');
    const gates = textInput('wihero_mask_gates', mask.gates, 'gates: ids, comma separated (none: only when selected)');
    const gateMode = el('select', { name: 'wihero_mask_gate_mode', class: 'text_pole' },
        el('option', { value: 'all' }, 'all of them'), el('option', { value: 'any' }, 'any of them'));
    gateMode.value = mask.gateMode;
    const content = el('textarea', { class: 'text_pole', name: 'wihero_mask_content', rows: '3', placeholder: 'content injected instead of the entry\'s own' });
    content.value = mask.content;
    const remove = el('div', { class: 'menu_button fa-solid fa-trash-can wihero-mask-remove', title: 'Remove this mask' });
    const [chips, updateChips] = suggestions(gates, ids, onChange);
    const row = el('div', { class: 'wihero-mask' },
        el('div', { class: 'wihero-row' }, field('Mask', name), field('Active when', gates), field('Needs', gateMode), remove),
        chips,
        content);
    remove.addEventListener('click', () => { row.remove(); onRemove(); });
    name.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
    gates.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
    return { row, read: () => ({ name: name.value, content: content.value, gates: gates.value, gateMode: gateMode.value }), updateChips };
}

/**
 * The story-logic form of one entry: every WI Hero field, live issues, Save and Remove (which saves null).
 * Used by the block in ST's entry editor and by the workspace's Story logic tab.
 * @param {{ title: () => string, onSave: (config: object | null, status: HTMLElement) => void }} options
 *   `title` gives the entry's current title, for the id suggestion.
 */
export function logicForm(name, uid, data, { title, onSave }) {
    const entry = data.entries[uid];
    const target = { ...entry, world: name };
    const entries = entriesFor(name, data);
    const ids = knownIds(entries, target);
    const labelNames = knownLabels(entries);
    // Gate-like lists take ids and #labels; switch paths take ids only.
    const refs = [...ids, ...labelNames.map(l => `#${l}`)];
    const form = configToForm(entry.wihero);
    let suggested = '';

    const id = textInput('wihero_id', form.id, 'e.g. arrive-town');
    const useSuggested = el('span', { class: 'wihero-chip', title: 'Use this id' });
    useSuggested.addEventListener('click', () => { id.value = suggested; update(); });
    const gates = textInput('wihero_gates', form.gates, 'ids, comma separated');
    const gateMode = el('select', { name: 'wihero_gate_mode', class: 'text_pole' },
        el('option', { value: 'all' }, 'all of them'), el('option', { value: 'any' }, 'any of them'));
    gateMode.value = form.gateMode;
    const [closeGates, closeGatesLabel] = checkbox('wihero_close_gates', form.closeGates, 'Close its gates when this fires');
    const [glue, glueLabel] = checkbox('wihero_glue', form.glue, 'Glue: inject every turn from its first firing until closed');
    const closeKeywords = el('textarea', { class: 'text_pole', name: 'wihero_close_keywords', rows: '2', placeholder: 'one per line, /regex/flags allowed' });
    closeKeywords.value = form.closeKeywords;
    const closeWhenFired = textInput('wihero_close_when_fired', form.closeWhenFired, 'ids, comma separated');
    const closeWhenAllFired = textInput('wihero_close_when_all_fired', form.closeWhenAllFired, 'ids, comma separated');
    const switchPaths = textInput('wihero_switch', form.switch, 'ids, comma separated');
    const labels = textInput('wihero_labels', form.labels, 'names, comma separated');
    const gatesFor = textInput('wihero_gates_for', form.gatesFor, 'ids or #labels');
    const closes = textInput('wihero_closes', form.closes, 'ids or #labels');
    const folder = textInput('wihero_folder', form.folder, 'e.g. Town/Inn');
    const folderChoices = el('datalist', { id: `wihero_folders_${uid}` }, ...folderList(Object.values(data.entries ?? {})).map(f => el('option', { value: f })));
    folder.setAttribute('list', folderChoices.id);
    const color = el('select', { name: 'wihero_color', class: 'text_pole' }, el('option', { value: '' }, 'none'),
        ...Object.keys(COLORS).map(c => el('option', { value: c }, c)));
    color.value = form.color;
    const issues = el('ul', { class: 'wihero-issues wihero-entry-issues' });
    const summary = el('small', { class: 'wihero-entry-summary' });
    const status = el('small', { class: 'wihero-entry-status' });

    const maskList = el('div', { class: 'wihero-masks' });
    let masks = [];
    const addMask = mask => {
        const row = maskRow(mask, refs, () => update(), () => { masks = masks.filter(m => m !== row); update(); });
        masks.push(row);
        maskList.append(row.row);
    };
    form.masks.forEach(addMask);
    const addMaskButton = el('div', { class: 'menu_button wihero-mask-add', title: 'Add alternate content for this entry' }, 'Add mask');
    addMaskButton.addEventListener('click', () => { addMask({ ...EMPTY_MASK }); update(); });

    const read = () => ({
        id: id.value, gates: gates.value, gateMode: gateMode.value, closeGates: closeGates.checked, glue: glue.checked,
        closeKeywords: closeKeywords.value, closeWhenFired: closeWhenFired.value, closeWhenAllFired: closeWhenAllFired.value,
        switch: switchPaths.value, masks: masks.map(m => m.read()),
        labels: labels.value, gatesFor: gatesFor.value, closes: closes.value,
        folder: folder.value, color: color.value,
    });
    const glueFields = el('div', { class: 'wihero-glue-fields' },
        field('Close when the turn contains', closeKeywords),
        field('Close when any of these fires', closeWhenFired),
        field('Close when all of these have fired', closeWhenAllFired));
    const [gateChips, updateGateChips] = suggestions(gates, refs, () => update());
    const [firedChips, updateFiredChips] = suggestions(closeWhenFired, refs, () => update());
    const [allChips, updateAllChips] = suggestions(closeWhenAllFired, refs, () => update());
    const [switchChips, updateSwitchChips] = suggestions(switchPaths, ids, () => update());
    const [labelChips, updateLabelChips] = suggestions(labels, labelNames, () => update());
    const [gatesForChips, updateGatesForChips] = suggestions(gatesFor, refs, () => update());
    const [closesChips, updateClosesChips] = suggestions(closes, refs, () => update());

    function update() {
        const config = formToConfig(read());
        const found = issuesFor(entries, target, config);
        issues.replaceChildren(...found.map(i => el('li', { class: i.warning ? 'wihero-warning' : '' }, i.message)));
        const gated = config && !Object.keys(config).every(k => UI_FIELDS.includes(k));
        summary.textContent = !gated ? 'not gated' : `${config.id ?? 'no id'}${found.some(i => !i.warning) ? ' · problem' : ''}`;
        glueFields.style.display = glue.checked ? '' : 'none';
        suggested = slugify(title() || entry.comment || entry.key?.[0]);
        useSuggested.textContent = suggested;
        useSuggested.style.display = !id.value.trim() && suggested ? '' : 'none';
        updateGateChips(); updateFiredChips(); updateAllChips(); updateSwitchChips();
        updateLabelChips(); updateGatesForChips(); updateClosesChips();
        masks.forEach(m => m.updateChips());
        status.textContent = '';
    }

    const save = el('div', { class: 'menu_button wihero-save', title: 'Save the WI Hero config of this entry' }, 'Save');
    const remove = el('div', { class: 'menu_button wihero-remove', title: 'Remove the WI Hero config: the entry goes back to vanilla' }, 'Remove');
    save.addEventListener('click', () => onSave(formToConfig(read()), status));
    remove.addEventListener('click', () => onSave(null, status));

    const content = el('div', { class: 'wihero-logic' },
        el('div', { class: 'wihero-row' }, field('Id', id), useSuggested),
        el('div', { class: 'wihero-row' }, field('Folder', folder), folderChoices, field('Color', color)),
        field('Labels', labels),
        labelChips,
        el('div', { class: 'wihero-row' }, field('Gates: fires only after', gates), field('Needs', gateMode)),
        gateChips,
        closeGatesLabel,
        glueLabel,
        glueFields,
        field('Switch: when one of these paths fires, the others close', switchPaths),
        switchChips,
        field('Gates for: these also need this entry to have fired', gatesFor),
        gatesForChips,
        field('Closes: when this fires, these close', closes),
        closesChips,
        el('small', {}, 'Masks: content injected instead, by its own gates or /wihero-mask'),
        maskList,
        el('div', { class: 'wihero-row' }, addMaskButton),
        el('div', { class: 'wihero-row' }, firedChips, allChips),
        issues,
        el('small', { class: 'wihero-hint' }, "Saving changes the entry, which resets its own sticky and cooldown timers, like any edit."),
        el('div', { class: 'wihero-row' }, save, remove, status),
    );
    // The chips for the two glue lists sit with their inputs.
    closeWhenFired.after(firedChips);
    closeWhenAllFired.after(allChips);
    for (const input of [id, gates, closeWhenFired, closeWhenAllFired, switchPaths, labels, gatesFor, closes, folder]) {
        input.addEventListener('keydown', e => { if (e.key === 'Enter') e.preventDefault(); });
    }
    content.addEventListener('input', update);
    content.addEventListener('change', update);
    update();
    return { content, update, summary };
}

async function fillBlock(block, name, uid) {
    const ctx = deps.ctx();
    const data = await ctx.loadWorldInfo(name);
    const entry = data?.entries?.[uid];
    if (!entry) {
        // A new entry reaches ST's cache (and its save) with its first edit. Until then there's nothing to save to.
        block.replaceChildren(el('small', { class: 'wihero-hint' }, 'WI Hero: edit any field of this new entry first.'));
        block.closest('.world_entry')?.addEventListener('input', () => fillBlock(block, name, uid), { once: true });
        return;
    }
    // The title can change while the block is open, so the id suggestion reads ST's field.
    const { content, update, summary } = logicForm(name, uid, data, {
        title: () => block.closest('.world_entry')?.querySelector('textarea[name="comment"]')?.value ?? '',
        onSave: (config, status) => store(name, uid, config, status),
    });
    content.classList.add('inline-drawer-content');
    content.style.display = reopenUid === String(uid) ? '' : 'none';
    const open = content.style.display === '';
    reopenUid = null;

    const drawer = el('div', { class: 'inline-drawer' },
        el('div', { class: 'inline-drawer-toggle inline-drawer-header' },
            el('span', {}, el('b', {}, 'WI Hero '), summary),
            el('div', { class: `inline-drawer-icon fa-solid ${open ? 'fa-circle-chevron-up up' : 'fa-circle-chevron-down down'}` })),
        content);
    // ST's drawer toggle bubbles; the entry's own drawer listens for it.
    $(drawer).on('inline-drawer-toggle', e => { e.stopPropagation(); update(); });
    block.replaceChildren(drawer);
}

/** Saves a config through ST's own save path, then reloads the editor so its copy of the book has it. */
async function store(name, uid, config, status) {
    const ctx = deps.ctx();
    // loadWorldInfo returns a copy of ST's cache, which already has every edit made in the editor.
    const data = await ctx.loadWorldInfo(name);
    if (!data?.entries?.[uid]) return;
    applyConfig(data.entries[uid], config);
    status.textContent = 'Saving…';
    await ctx.saveWorldInfo(name, data, true);
    // ST's editor saves its own copy of the book on every edit, so it must be reloaded to pick this up.
    reopenUid = String(uid);
    const old = document.querySelector(`#world_popup_entries_list .world_entry[uid="${uid}"]`);
    ctx.reloadWorldInfoEditor(name);
    await reopenEntry(uid, old);
    deps.onSaved();
}

/** After the editor re-renders, opens the entry again (as ST does when it re-renders an entry). */
async function reopenEntry(uid, old) {
    for (let i = 0; i < 50; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const header = document.querySelector(`#world_popup_entries_list .world_entry[uid="${uid}"]`);
        if (!header || header === old) continue;
        if (!header.querySelector('.world_entry_edit')) $(header).find('.inline-drawer-icon').first().trigger('click');
        return;
    }
    reopenUid = null;
}
