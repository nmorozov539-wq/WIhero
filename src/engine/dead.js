// Dead branch report, static pass (AFTER_V1): what the book alone says can never happen. Reads the model and the
// ST entries, never a chat. Pure, no SillyTavern imports.
//
// An entry can fire when something can set it off (key words, Permanent, Vectorized, ride-along glue on a host
// that can fire, a Moment's phrases), it has no blocking problem, its Gates for sources can fire, and at least one
// gate row can open. A row can open when every item in it can fire and no two of them are paths of one switch
// (only one path of a switch ever fires). Pack readings count the members that can fire, at most one per switch.
// Greetings count as able to fire (a missing or changed greeting is reported elsewhere).

/**
 * @param {object} model buildModel's result
 * @param {object[]} entries the ST entries the model was built from (each with `world` and `uid`)
 * @returns {{ key: string, stKey: string, label: string, dead: boolean, reasons: string[] }[]}
 *   One finding per entry: `dead` when it can never fire, otherwise the gate rows (or masks) that can never open.
 *   Entries with a blocking problem are left out: Problems already lists them.
 */
export function deadBranches(model, entries) {
    const { nodes, switches } = model;
    const entryOf = new Map((entries ?? []).map(e => [`${e.world}.${e.uid}`, e]));
    const switchOf = new Map(); // path key → fork key
    for (const s of switches) for (const p of s.paths) switchOf.set(p, s.fork);
    const name = key => nodes.get(key)?.label ?? key;

    const triggered = node => {
        if (node.moment) return node.moment.phrases.length > 0;
        if (node.glue?.mode === 'ride') return true; // checked through its host below
        const e = entryOf.get(node.stKey);
        if (!e) return true;
        if (e.constant || e.vectorized) return true;
        return Array.isArray(e.key) && e.key.some(k => typeof k === 'string' && k.trim());
    };

    // Least fixed point: start from nothing, add what can fire until nothing changes.
    const can = new Set();
    const itemOk = item => {
        if (item.type === 'entry') return can.has(item.key);
        if (item.type === 'pack') return liveCount(item.keys) >= need(item);
        return true; // greetings, self
    };
    const need = item => item.mode === 'any' ? 1 : item.mode === 'all' ? item.keys.length : item.mode;
    // Members that can fire, counting at most one path per switch.
    const liveCount = keys => {
        const forks = new Set();
        let n = 0;
        for (const k of keys) {
            if (!can.has(k)) continue;
            const f = switchOf.get(k);
            if (f) { if (forks.has(f)) continue; forks.add(f); }
            n++;
        }
        return n;
    };
    const clash = row => {
        // Two items (entries, or members a reading needs all of) that are paths of the same switch.
        const seen = new Map();
        for (const item of row.items) {
            const keys = item.type === 'entry' ? [item.key] : item.type === 'pack' && item.mode === 'all' ? item.keys : [];
            for (const k of keys) {
                const f = switchOf.get(k);
                if (!f) continue;
                if (seen.has(f) && seen.get(f) !== k) return [seen.get(f), k, f];
                seen.set(f, k);
            }
        }
        return null;
    };
    const rowOk = row => !clash(row) && row.items.every(itemOk);
    const rowsOf = node => node.moment ? node.moment.rows : node.opens.rows;
    const opensOk = node => (!rowsOf(node).length || rowsOf(node).some(rowOk)) && node.opens.all.every(itemOk);
    const fireOk = node => !node.blocked && triggered(node) && (node.glue?.mode !== 'ride' || can.has(node.glue.host)) && opensOk(node);
    for (let changed = true; changed;) {
        changed = false;
        for (const node of nodes.values()) {
            if (!can.has(node.key) && fireOk(node)) { can.add(node.key); changed = true; }
        }
    }

    // Why a row can't open, in words.
    const rowWhy = row => {
        const c = clash(row);
        if (c) return `needs both ${name(c[0])} and ${name(c[1])}, two paths of the ${name(c[2])} switch: only one can ever fire`;
        for (const item of row.items) {
            if (item.type === 'entry' && !can.has(item.key)) return `needs ${name(item.key)}, which can never fire`;
            if (item.type === 'pack' && !itemOk(item)) {
                const n = liveCount(item.keys);
                return item.mode === 'any'
                    ? `needs a member of #${item.name}, and none of them can ever fire`
                    : `needs ${item.mode === 'all' ? 'every' : item.mode} member${item.mode === 1 ? '' : 's'} of #${item.name}, and only ${n} can ever fire${n < item.keys.length && item.keys.some(k => switchOf.has(k)) ? ' (one path per switch)' : ''}`;
            }
        }
        return null;
    };
    const rowText = row => JSON.stringify(row.raw);

    const out = [];
    for (const node of nodes.values()) {
        if (node.blocked) continue;
        const reasons = [];
        const dead = !can.has(node.key);
        if (dead) {
            if (!triggered(node)) reasons.push(node.moment ? 'has no phrases' : 'nothing sets it off: no key words, not Permanent or Vectorized, no glue');
            else if (node.glue?.mode === 'ride' && !can.has(node.glue.host)) reasons.push(`rides along with ${name(node.glue.host)}, which can never fire`);
            for (const item of node.opens.all) if (!itemOk(item)) reasons.push(`waits for ${item.type === 'pack' ? `#${item.name}` : name(item.key)} (Gates for), which can never fire`);
            if (rowsOf(node).length && !rowsOf(node).some(rowOk)) {
                for (const row of node.opens.rows) reasons.push(`gate row ${rowText(row)} ${rowWhy(row) ?? 'can never open'}`);
                if (!node.opens.rows.length && node.moment) for (const row of node.moment.rows) { const w = rowWhy(row); if (w) reasons.push(`its gate ${w}`); }
            }
            if (!reasons.length) reasons.push('can never fire');
        } else {
            for (const row of node.opens.rows) if (!rowOk(row)) reasons.push(`gate row ${rowText(row)} ${rowWhy(row)}`);
        }
        for (const mask of node.masks ?? []) {
            if (mask.opens.length && !mask.opens.some(rowOk)) reasons.push(`mask "${mask.name}" can never turn on: ${mask.opens.map(r => rowWhy(r)).filter(Boolean)[0] ?? 'its gate can never open'}`);
        }
        if (reasons.length) out.push({ key: node.key, stKey: node.stKey, label: node.label, dead, reasons });
    }
    return out;
}
