// The one line-icon set (VISUAL 4): 24px grid, 2px stroke, round caps, drawn in currentColor. No emoji.
import { Html } from './html.js';
export const ICON = {
    menu: '<path d="M4 7 H20 M4 12 H20 M4 17 H20"/>', down: '<path d="M6 9 L12 15 L18 9"/>', up: '<path d="M6 15 L12 9 L18 15"/>', right: '<path d="M9 6 L15 12 L9 18"/>', left: '<path d="M15 6 L9 12 L15 18"/>',
    back: '<path d="M19 12 H5 M11 6 L5 12 L11 18"/>', x: '<path d="M6 6 L18 18 M18 6 L6 18"/>', check: '<path d="M5 12 L10 17 L19 7"/>',
    undo: '<path d="M9 14 L4 9 L9 4 M4 9 H14 a6 6 0 0 1 0 12 H10"/>', redo: '<path d="M15 14 L20 9 L15 4 M20 9 H10 a6 6 0 0 0 0 12 H14"/>',
    home: '<path d="M4 11 L12 4 L20 11 V20 H14 V14 H10 V20 H4 Z"/>',
    canvas: '<path d="M4 5 H10 V10 H4 Z M14 14 H20 V19 H14 Z M7 10 V14 Q7 16.5 9.5 16.5 H14"/>',
    eye: '<path d="M2 12 Q12 3 22 12 Q12 21 2 12 Z M12 9 a3 3 0 1 0 0.01 0"/>',
    search: '<path d="M11 4 a7 7 0 1 0 0.01 0 M20 20 L16 16"/>', plus: '<path d="M12 5 V19 M5 12 H19"/>', spark: '<path d="M12 3 L13.8 10.2 L21 12 L13.8 13.8 L12 21 L10.2 13.8 L3 12 L10.2 10.2 Z"/>', import: '<path d="M12 4 V15 M7 10 L12 15 L17 10 M5 19 H19"/>', minus: '<path d="M5 12 H19"/>',
    select: '<path d="M4 4 H20 V20 H4 Z M8 12 L11 15 L16 9"/>', more: '<path d="M12 5 h.01 M12 12 h.01 M12 19 h.01" stroke-width="3"/>',
    book: '<path d="M5 4 H17 a2 2 0 0 1 2 2 V20 H7 a2 2 0 0 1 -2 -2 Z M5 18 a2 2 0 0 1 2 -2 H19"/>',
    folder: '<path d="M3 6 H9 L11 8 H21 V19 H3 Z"/>', entry: '<path d="M6 3 H14 L19 8 V21 H6 Z M14 3 V8 H19 M9 13 H16 M9 17 H14"/>',
    drawer: '<path d="M4 5 H20 V19 H4 Z M9 5 V19"/>',
    chain: '<path d="M10 14 L14 10 M8.5 11.5 L6.5 13.5 a3 3 0 0 0 4 4 L12.5 15.5 M15.5 12.5 L17.5 10.5 a3 3 0 0 0 -4 -4 L11.5 8.5"/>',
    lock: '<path d="M6 11 H18 V20 H6 Z M8.5 11 V8 a3.5 3.5 0 0 1 7 0 V11"/>', user: '<path d="M12 4 a4 4 0 1 0 0.01 0 M4 20 Q4 14 12 14 Q20 14 20 20"/>',
    bot: '<path d="M5 9 H19 V19 H5 Z M12 9 V5 M9 13 h.01 M15 13 h.01"/>',
    fit: '<path d="M4 9 V4 H9 M15 4 H20 V9 M20 15 V20 H15 M9 20 H4 V15"/>',
    tidy: '<path d="M8 4 H16 V9 H8 Z M3 16 H9 V21 H3 Z M15 16 H21 V21 H15 Z M12 9 V12 M6 16 V12 H18 V16"/>',
    panel: '<path d="M4 5 H20 V19 H4 Z M9 5 V19 M5.5 9 H7.5 M5.5 12 H7.5"/>',
    panelRight: '<g transform="translate(24 0) scale(-1 1)"><path d="M4 5 H20 V19 H4 Z M9 5 V19 M5.5 9 H7.5 M5.5 12 H7.5"/></g>',
    expand: '<path d="M14 4 H20 V10 M20 4 L13 11 M10 20 H4 V14 M4 20 L11 13"/>',
    restore: '<path d="M8 8 V4 H20 V16 H16 M4 8 H16 V20 H4 Z"/>',
    trash: '<path d="M5 7 H19 M10 7 V4 H14 V7 M7 7 L8 20 H16 L17 7"/>', code: '<path d="M8 7 L3 12 L8 17 M16 7 L21 12 L16 17"/>',
    on: '<path d="M12 3 V11 M6.5 6.5 a8 8 0 1 0 11 0"/>', off: '<path d="M4 4 L20 20 M12 3 V8 M6.5 6.5 a8 8 0 0 0 11.3 11.3 M19 13 a8 8 0 0 0 -1.5 -6.5"/>',
    move: '<path d="M3 6 H9 L11 8 H21 V19 H3 Z M10 13 H16 M13 10 L16 13 L13 16"/>',
    gear: '<path d="M12 9 a3 3 0 1 0 0.01 0 M12 2 V5 M12 19 V22 M2 12 H5 M19 12 H22 M5 5 L7 7 M17 17 L19 19 M5 19 L7 17 M17 7 L19 5"/>',
    edit: '<path d="M4 20 H8 L19 9 L15 5 L4 16 Z M13 7 L17 11"/>', tab: '<path d="M3 19 V8 H10 L12 5 H21 V19 Z"/>',
    // Added for N2: snapshots (a camera-like frame), copy, and the warning mark of problem badges.
    snap: '<path d="M4 8 H8 L10 5 H14 L16 8 H20 V19 H4 Z M12 10.5 a3 3 0 1 0 0.01 0"/>',
    copy: '<path d="M8 8 H19 V20 H8 Z M5 16 V4 H16"/>',
    alert: '<path d="M12 7 V13 M12 17 h.01"/>',
    // Added for N4: the greeting card's chat bubble, and help.
    chat: '<path d="M5 5 H19 V15 H10 L5 19 Z"/>',
    clock: '<path d="M12 4 a8 8 0 1 0 0.01 0 M12 8 V12 L15 14"/>',
    tag: '<path d="M4 4 H11 L20 13 L13 20 L4 11 Z M8 8 h.01"/>',
    // Home's view switch: a list of rows, a grid of tiles.
    rows: '<path d="M8 6 H20 M8 12 H20 M8 18 H20 M4 6 h.01 M4 12 h.01 M4 18 h.01"/>',
    grid: '<path d="M4 4 H10 V10 H4 Z M14 4 H20 V10 H14 Z M4 14 H10 V20 H4 Z M14 14 H20 V20 H14 Z"/>',
    help: '<path d="M9.5 9 a2.5 2.5 0 1 1 3.5 2.3 C12.4 11.6 12 12.2 12 13 M12 16.5 h.01"/>',
    // The pieces' own icons (#39), so the piece bar and the inspector don't rely on color alone.
    popen: '<path d="M4 12 H16 M12 6 L18 12 L12 18"/>', pclose: '<path d="M4 12 H15 M18 6 V18"/>',
    pglue: '<path d="M9 8 H7 a4 4 0 0 0 0 8 H9 M15 8 H17 a4 4 0 0 1 0 8 H15 M9 12 H15"/>', pswitch: '<path d="M4 12 H10 L18 6 M10 12 L18 18"/>',
    pmask: '<path d="M4 9 L12 5 L20 9 L12 13 Z M4 14 L12 18 L20 14"/>', ptrack: '<path d="M5 19 L8 18 L18 8 L16 6 L6 16 Z M14 8 L16 10"/>',
    ponce: '<path d="M9 8 L11 6 V18 M14 10 L18 14 M18 10 L14 14"/>', pby: '<path d="M12 4 a3.5 3.5 0 1 0 0.01 0 M5 20 a7 7 0 0 1 14 0"/>',
};

/** An icon as markup. `cls` 's' makes the 16px inline size. */
export const ic = (name, cls = '') => new Html(`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name] ?? ''}</svg>`);
