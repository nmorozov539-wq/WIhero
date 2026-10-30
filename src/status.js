// Short forms of an entry's status for badges. Pure.

/** The status class, as the panel uses it: the first word ("gate open" → "gate", "waiting for x" → "waiting"). */
export const statusClass = status => `wihero-status-${String(status).split(' ')[0]}`;

/**
 * One word for a badge (open / waiting / closed / glued / sticky / problem), plus the active mask's name.
 * @param {string} status The panel's status text, e.g. "gate open · mask: ruined".
 * @returns {string | null} null for an entry WI Hero doesn't gate.
 */
export function shortStatus(status) {
    const [main, mask] = String(status).split(' · mask: ');
    const word = main === 'not gated' ? null
        : main === 'open' || main === 'gate open' ? 'open'
            : main.startsWith('waiting') ? 'waiting'
                : main.startsWith('closed') ? 'closed'
                    : main.startsWith('sticky') ? 'sticky'
                        : main === 'glued' ? 'glued'
                            : main === 'config problem' ? 'problem' : main;
    return word && mask ? `${word} · ${mask}` : word;
}
