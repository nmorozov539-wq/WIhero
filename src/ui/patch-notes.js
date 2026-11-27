// The Patch notes sheet (☰ → Patch notes): the changelog from src/changelog.js, newest version first. It is the
// user-facing record of what changed; the plan is the technical one.
import { CHANGELOG } from '../changelog.js';
import { el } from './dom.js';

/** The version shown beside the menu row. */
export const notesVersion = CHANGELOG[0]?.version ?? '';

/** Opens the changelog over whatever is showing. */
export function openPatchNotes(layer) {
    layer.sheet('Patch notes', sh => {
        for (const v of CHANGELOG) {
            const sec = el('section', 'note');
            const head = el('div', 'notehead');
            head.append(el('h3', '', v.version), el('span', 'notedate', v.date));
            sec.append(head);
            for (const g of v.groups) {
                sec.append(el('div', 'notegroup', g.title));
                const ul = el('ul', 'notelist');
                for (const item of g.items) ul.append(el('li', '', item));
                sec.append(ul);
            }
            sh.append(sec);
        }
    }, { cls: 'notes', help: 'What changed, newest first.' });
}
