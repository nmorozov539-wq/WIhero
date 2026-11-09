// Markup that is safe to put in innerHTML (review 2026-11-09, finding 1). Anything else that reaches the DOM is
// text: book content (titles, names, keys) can come from a lorebook downloaded from the internet.

/** A piece of trusted markup: static strings and icons, never book content. */
export class Html {
    constructor(markup) { this.markup = String(markup); }
    toString() { return this.markup; }
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = s => String(s).replace(/[&<>"']/g, ch => ESC[ch]);

/** Tagged template: the literal parts are markup, values are escaped unless they are Html themselves. */
export function html(strings, ...values) {
    let out = strings[0];
    values.forEach((v, i) => { out += (v instanceof Html ? v.markup : escapeHtml(v ?? '')) + strings[i + 1]; });
    return new Html(out);
}
