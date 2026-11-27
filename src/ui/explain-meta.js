// Explicit explain-mode metadata (LAYOUT "Explain mode"). Kept apart from explain.js so the small DOM helpers can mark
// controls without pulling in the Guide and the canvas. Explain mode is navigation only: every ordinary interactive
// control says what it is and whether following it is navigation. Nothing is classified from a label or a handler.

/** @typedef {{ title?: string, text?: string, navigate?: false | 'native' | 'guide', guide?: string | null, long?: boolean }} ExplainDesc */

/**
 * The catalogue. `navigate` is the only classification: 'native' lets one normal click through on the second
 * activation, 'guide' opens the Guide page there, false (the default) never acts. A `text` may be a function of the
 * marked node when the sentence needs the control's own value.
 */
export const EXPLAIN = {
    'nav.open': { navigate: 'native' },
    'nav.disclosure': { navigate: 'native', text: 'Shows or hides more here. Nothing is changed.' },
    'nav.tab': { navigate: 'native' },
    'nav.close': { navigate: 'native', text: 'Closes this without changing anything.' },
    'nav.scrim': { navigate: 'native', text: 'Closes this menu or sheet. Nothing in it is changed.' },
    'blocked.command': { navigate: false, text: 'Changes the book.' },
    'blocked.setting': { navigate: false, text: 'Changes this setting.' },
    'blocked.input': { navigate: false, text: 'Types into this field.' },
    'blocked.selection': { navigate: false, text: 'Starts or changes a selection.' },
    'blocked.edit': { navigate: false, text: 'Edits the book.' },
    'blocked.clipboard': { navigate: false, text: 'Copies to the clipboard.' },
    'blocked.file': { navigate: false, text: 'Reads or writes a file.' },
    'blocked.history': { navigate: false, text: 'Steps through your changes.' },
    'blocked.place': { navigate: false, text: 'Changes where things sit on the canvas.' },
    'blocked.mode': { navigate: false, text: 'Switches between Normal and Hero mode.' },
    'blocked.search': { navigate: false, text: 'Opens and focuses a search field.' },
    'blocked.confirm': { navigate: false, text: 'Carries out the change.' },

    'shell.menu': { navigate: 'native', text: 'Opens the menu: display, tabs, checks and the Guide.' },
    'shell.tab.canvas': { navigate: 'native', text: 'Shows the book\'s canvas: entries as cards and rules as lines.', guide: 'canvas' },
    'shell.tab.preview': { navigate: 'native', text: 'Shows a pretend exchange: what would fire, and why.' },
    'shell.tab.guide': { navigate: 'native', text: 'Opens the Guide: how each piece works in depth.' },
    'shell.tab.entry': { navigate: 'native', text: 'Brings this entry\'s tab forward.' },
    'shell.tab.close': { navigate: 'native', text: 'Closes this tab. The entry stays in the book.' },
    'shell.book': { navigate: 'native', text: 'Opens the book picker. Picking another book only looks at it.' },
    'shell.search': { navigate: false, text: 'Searches every book\'s entries and key words.' },
    'search.all': { navigate: false, text: 'Loads the books that are not searched yet in the background. Results update as they arrive; nothing in a book changes.' },
    'shell.widen': { navigate: false, text: 'Changes how much room the drawer takes.' },
    'shell.panel': { navigate: 'native', text: 'Opens or closes the list of every entry in the book.' },
    'shell.fit': { navigate: 'native', text: 'Brings every card into view.' },
    'shell.zoom': { navigate: 'native', text: 'Changes the size the canvas is drawn at.' },
    'shell.zoomLabel': { navigate: 'native', text: 'Back to 100%.' },
    'shell.tidy': { navigate: false, text: 'Tries to lay the cards out so the story reads better, and resets link ports. Undo puts it back.' },
    'shell.undo': { navigate: false, text: 'Undo the last change to this book — text, rules, or card layout. Moving the view doesn\'t count.' },
    'shell.checks': { navigate: 'native', text: 'Opens the list of rules that can never fire.' },
    'shell.legend': { navigate: false, text: 'The legend: what the line colors and card marks mean.' },
    'shell.chatState': { navigate: false, text: 'Shows what the open chat has fired.' },
    'shell.piecesFold': { navigate: false, text: 'Shows or hides the piece bar.' },
    'shell.morePieces': { navigate: 'native', text: 'Scrolls the piece bar to its other pieces. Nothing is changed.' },
    'shell.bookline': { navigate: 'native', text: 'Goes up to this entry\'s book.' },
    'shell.back': { navigate: 'native', text: 'Goes back one view.' },
    'shell.drawer': { navigate: 'native', text: 'Opens the entries of this book.' },
    'shell.entryMenu': { navigate: 'native', text: 'Opens this entry\'s actions.' },
    'shell.panel.header': { navigate: 'native', text: 'Shows or hides this folder. Nothing is changed.' },
    'shell.panel.row': { navigate: 'native', text: 'This entry. The colored dot is its strategy — and its handle to the canvas.' },
    'shell.panel.dot': { navigate: false, text: 'Lit when the entry is on the canvas. Drag it to place or move the card.' },
    'shell.panel.newEntry': { navigate: false, text: 'Makes a new entry.' },
    'shell.panel.select': { navigate: false, text: 'Starts picking entries for a bulk action.' },
    'shell.panel.clashes': { navigate: 'native', text: 'Opens the list of key words that fire more than one entry.' },
    'shell.panel.book': { navigate: 'native', text: 'Opens the book picker.' },
    'shell.panel.bookMenu': { navigate: 'native', text: 'Opens this book\'s actions.' },
    'shell.panel.resize': { navigate: false, text: 'Changes how wide the entry list is.' },
    'shell.inspectorToggle': { navigate: false, text: 'Shows or hides the inspector column.' },
    'shell.pieceGuide': { navigate: 'native', text: 'Opens this piece\'s page in the Guide.' },
    'shell.strip.cancel': { navigate: false, text: 'Puts the book back as it was before this piece was set up.' },
    'shell.strip.done': { navigate: false, text: 'Keeps the piece being set up.' },

    'menu.mode': { navigate: false, text: 'Switches to Normal mode.' },
    'menu.guide': { navigate: 'native', text: 'Opens the Guide: how each piece works in depth.' },
    'menu.notes': { navigate: 'native', text: 'Opens the patch notes: what changed in each version.' },
    'menu.bookPicker': { navigate: 'native', text: 'Opens the book picker. Picking another book only looks at it.' },
    'menu.folderPicker': { navigate: 'native', text: 'Opens the folders to move this entry to.' },
    'menu.colors': { navigate: 'native', text: 'Opens the colors for story pieces. Nothing changes until one is picked.' },
    'menu.snapshots': { navigate: 'native', text: 'Opens this book\'s snapshots: copies you can go back to.' },
    'menu.snapshot': { navigate: 'native', text: 'Opens this snapshot\'s Restore, Rename and Delete.' },
    'menu.links': { navigate: 'native', text: 'The characters and chats this book is linked to — they always use it, global or not.' },
    'menu.problems': { navigate: 'native', text: 'Opens the list of problems: rules that keep an entry from firing.' },
    'menu.clashes': { navigate: 'native', text: 'Opens the list of key words that fire more than one entry.' },
    'menu.dead': { navigate: 'native', text: 'Opens the list of rules that can never fire.' },
    'menu.checks': { navigate: 'native', text: 'Opens the book\'s checks.' },
    'menu.settings': { navigate: 'native', text: 'Opens SillyTavern\'s World Info settings. They apply to every book.' },
    'menu.bookOrder': { navigate: 'native', text: 'Opens the order books\' entries go into the prompt first.' },
    'menu.addLogic': { navigate: 'native', text: 'Opens the pieces this entry can still add.' },
    'menu.pieceTargets': { navigate: 'native', text: 'Opens the other entries and packs this rule can point at.' },
    'menu.entrySheet': { navigate: 'native' },
    'menu.result': { navigate: 'native', text: 'Goes to the entry this result is about.' },
    'menu.guideRow': { navigate: 'native', text: 'Opens the Guide page for this piece.' },
    'menu.maskActions': { navigate: 'native', text: 'Opens this mask\'s actions.' },
    'menu.addToPack': { navigate: 'native', text: 'Opens the packs this entry can join.' },
    'menu.maskText': { navigate: 'native', text: 'Opens this mask\'s text in a tab.' },
    'menu.report': { navigate: 'native', text: 'Opens the full Preview report.' },
    'menu.reportBack': { navigate: 'native', text: 'Goes back to the pretend exchange.' },
    'menu.previewSource': { navigate: 'native', text: 'Opens where the pretend exchange can start from.' },
    'menu.previewExplain': { navigate: 'native', text: 'Opens why this fired, matched or was blocked.' },
    'menu.previewEntry': { navigate: 'native', text: 'Opens this entry in a tab of its own.' },
    'menu.previewCanvas': { navigate: 'native', text: 'Finds this entry on the canvas.' },
    'menu.choose': { navigate: 'native', text: 'Opens the choices for where this goes.' },
    'menu.starter': { navigate: 'native', text: 'Opens this starting point in the pretend exchange.' },
    'menu.inspectorTab': { navigate: 'native', text: 'Shows this part of the inspector.' },
    'menu.sheetBack': { navigate: 'native', text: 'Closes this sheet and goes back one step.' },

    'book.global': { navigate: false, text: 'Global = every chat uses this book when a key word matches.' },
    'book.rename': { navigate: false, text: 'Renames this book. Its story progress carries over to the new name in every chat.' },
    'book.duplicate': { navigate: false, text: 'Makes a copy of this book.' },
    'book.delete': { navigate: false, text: 'Deletes this book and its snapshots. Undo for a few seconds; after that it\'s gone.' },

    'inspector.close': { navigate: 'native', text: 'Closes the inspector. The entry stays as it is.' },
    'inspector.row': { navigate: 'native' },
    'inspector.guide': { navigate: 'native', text: 'Opens this piece\'s page in the Guide.' },
    'inspector.addLogic': { navigate: 'native', text: 'Opens the pieces this entry can still add.' },
    'inspector.settings': { navigate: 'native', text: 'Shows or hides this entry\'s settings. Nothing is changed.' },
    'inspector.readEntry': { navigate: 'native', text: 'Opens this entry in a tab of its own.' },
    'inspector.data': { navigate: 'native', text: 'Opens this entry\'s story logic as stored, read-only.' },
    'inspector.showOnCanvas': { navigate: 'native', text: 'Finds this entry on the canvas.' },
    'inspector.maskText': { navigate: 'native', text: 'Opens this mask\'s text in a tab.' },
    'inspector.maskActions': { navigate: 'native', text: 'Opens this mask\'s actions.' },
    'inspector.target': { navigate: 'native', text: 'Goes to the entry or pack this rule points at.' },
    'inspector.sources': { navigate: 'native', text: 'Goes to the entry that keeps this rule.' },
    'inspector.remove': { navigate: false, text: 'Removes this piece.' },
    'inspector.rename': { navigate: false, text: 'Renames this entry.' },
    'inspector.switch': { navigate: false, text: 'Changes this entry\'s setting.' },
    'inspector.reopen': { navigate: false, text: 'Reopens this entry in the open chat.' },
    'inspector.takeOff': { navigate: false, text: 'Takes this card off the canvas.' },
    'inspector.deleteMoment': { navigate: false, text: 'Deletes this Moment.' },
    'inspector.note': { navigate: false, text: 'Edits your private note.' },
    'inspector.repick': { navigate: false, text: 'Links this greeting again.' },
    'inspector.edit': { navigate: false, text: 'Edits this piece.' },

    'panel.folder': { navigate: 'native', text: 'Shows or hides this folder. Nothing is changed.' },
    'panel.rowMenu': { navigate: 'native', text: 'Opens this entry\'s actions.' },

    'canvas.tools.tidy': { navigate: false, text: 'Tries to lay the cards out so the story reads better, and resets link ports. Undo puts it back.' },
    'canvas.zoomLabel': { navigate: 'native', text: 'Back to 100%.' },
    'canvas.maskFlip': { navigate: false, text: 'Shows another version of this card\'s text.' },
    'canvas.port': { navigate: 'guide', text: 'Starts a link to or from this card.' },
    'canvas.line': { navigate: 'guide', text: 'Sets up this link.' },
    'canvas.pill': { navigate: 'guide', text: 'Sets up this condition.' },
};

/** Per-node overrides (the descriptor built where the control is created). */
const META = new WeakMap();

/** Names the element for a tooltip: its aria-label, its row's label, or its short text. */
export function nodeLabel(node) {
    const a = node?.getAttribute?.('aria-label');
    if (a) return String(a).replace(/\s+/g, ' ').trim();
    const lab = node?.querySelector?.('.lab');
    if (lab?.textContent) return String(lab.textContent).replace(/\s+/g, ' ').trim();
    const t = String(node?.textContent ?? '').replace(/\s+/g, ' ').trim();
    return t.length > 40 ? `${t.slice(0, 40)}…` : t || 'This';
}

/** Marks `node` as an explainable control: `key` into EXPLAIN, and this control's own descriptor choices. */
export function explainNode(node, key, extra = {}) {
    if (!node) return node;
    node.setAttribute?.('data-xkey', key);
    if (node.dataset) node.dataset.xkey = key;
    META.set(node, { ...extra, key });
    return node;
}

/** Marks a region as an editor: everything inside is blocked and explained unless it has a descriptor of its own. */
export function blockRegion(node) {
    node?.setAttribute?.('data-xblock', '1');
    return node;
}

/** The key a node was marked with, or null. */
export function explainKey(node) {
    return node?.dataset?.xkey ?? node?.getAttribute?.('data-xkey') ?? null;
}

/** True for an element that is itself a control, so canonical resolution stops there (never inheriting a parent's permission). */
export function isInteractive(node) {
    if (!node?.matches) return false;
    if (node.matches('button, a[href], input, select, textarea, [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"]')) return true;
    const tab = node.getAttribute?.('tabindex');
    return tab !== null && tab !== undefined && tab !== '-1' && node.matches('[tabindex]');
}

/** The selectors that are one canvas concept (their tooltip comes from explainTip). */
const CONCEPT = '.pchip[data-piece], .card, .card .badge1, .card .fired, .card .cbang, .card .sticky, .card .wval, [data-grip], .lockp, .junc, .packframe, .mnav, .layercard, [data-flip], .lhit, [data-port], [data-open], .also, .hl, mark, .hit, .zlabel, .checkchip, .histbtns button, .canvas-tools button, .panelBtn, .pfold, .plist .phdr, .tab';

/** Whether a node is one of the canvas concepts explained by the selector mapping. */
export function isConcept(node) {
    return !!node?.matches?.(CONCEPT);
}

/**
 * The canonical control for a press at `node`: the nearest explicitly marked node, canvas concept, or interactive
 * control. An unmarked nested button is its own canonical control, so it can never borrow an ancestor's permission.
 * @param {Element} node
 */
export function canonicalTarget(node) {
    let n = node;
    if (n?.nodeType === 3) n = n.parentElement;
    for (; n; n = n.parentElement) {
        if (explainKey(n)) return n;
        if (isConcept(n)) return n;
        if (isInteractive(n)) return n;
    }
    return null;
}

/** The descriptor for a marked control or a control inside an editor region, or null when it has none. */
export function describeNode(node) {
    if (!node) return null;
    const key = explainKey(node);
    if (key) {
        const base = EXPLAIN[key];
        const own = META.get(node) ?? {};
        if (!base && own.text === undefined) return null;
        const d = { ...base, ...own };
        const text = typeof d.text === 'function' ? d.text(node) : d.text;
        if (text === undefined || text === null || text === '') return null;
        const title = typeof d.title === 'function' ? d.title(node) : d.title;
        return {
            key,
            title: (title ?? nodeLabel(node)) || 'This',
            text,
            navigate: d.navigate === 'native' || d.navigate === 'guide' ? d.navigate : false,
            guide: d.guide ?? null,
            long: !!d.long,
        };
    }
    const region = node.closest?.('[data-xblock]');
    if (region) {
        return {
            key: 'blocked.edit',
            title: nodeLabel(node),
            text: EXPLAIN['blocked.edit'].text,
            navigate: false,
            guide: null,
            long: false,
        };
    }
    return null;
}

/**
 * One activation of explain mode, as a state change: the armed target, and what this activation may do. Exported so
 * the contract can be tested without a browser. `arm` is the still-connected target that had its first activation.
 * @returns {{ arm: Element|null, action: 'tip' | 'native' | 'guide' | 'none' }}
 */
export function activationStep(arm, target, desc) {
    if (!target || !desc) return { arm: null, action: 'none' };
    const connected = target.isConnected !== false;
    if (arm === target && connected) {
        if (desc.navigate === 'guide' && desc.guide) return { arm: null, action: 'guide' };
        if (desc.navigate === 'native') return { arm: null, action: 'native' };
        return { arm, action: 'tip' }; // blocked: stays armed, repeats the tooltip
    }
    return { arm: target, action: 'tip' };
}
