// Model issues grouped once per entry (C2): a book draw asks for one entry's problems and warnings per row, and
// Hero mode asks for the blocking set once, so the split is done here instead of filtering every issue each time.

/** Issues by the entry they name (`stKey`). Issues without one are kept under '', which names no entry. */
export function groupIssues(issues) {
    const by = new Map();
    for (const i of issues) {
        const k = i.stKey ?? '';
        const list = by.get(k);
        if (list) list.push(i); else by.set(k, [i]);
    }
    return by;
}

/** A model built outside modelOf (a test, a trial copy) still answers: fall back to the whole list. */
const issuesFor = (model, key) => (model.issuesByStKey ? model.issuesByStKey.get(key) : model.issues.filter(i => i.stKey === key)) ?? [];

/** An entry's blocking problems: the list's and the inspector's red mark. */
export const problemsOf = (model, uid, book) => issuesFor(model, `${book}.${uid}`).filter(i => !i.warning && i.blocking !== false);

/** An entry's warnings and non-blocking notes, for the entry page and the inspector (problemsOf has the rest). */
export const warningsOf = (model, uid, book) => issuesFor(model, `${book}.${uid}`).filter(i => i.warning || i.blocking === false);

/** The uids of a book's entries with blocking problems: the canvas's problem mark. */
export function blockingUids(book, model) {
    const prefix = `${book}.`;
    const by = model.issuesByStKey ?? groupIssues(model.issues);
    const uids = new Set();
    for (const [key, issues] of by) {
        if (key.startsWith(prefix) && issues.some(i => !i.warning && i.blocking !== false)) uids.add(Number(key.slice(prefix.length)));
    }
    return uids;
}
