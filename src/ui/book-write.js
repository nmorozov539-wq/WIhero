// ST 1.19's saveWorldInfo resolves even on HTTP errors and updates its cache before writing.
// Commit through the same endpoint, then publish the confirmed copy to ST's cache and listeners.
export async function writeBook(ctx, WI, name, data) {
    if (!(WI.worldInfoCache instanceof Map) || !ctx.eventSource?.emit || !ctx.eventTypes?.WORLDINFO_UPDATED) {
        throw new Error('This SillyTavern cannot confirm lorebook saves');
    }
    const pending = Map.prototype.get.call(WI.worldInfoCache, name);
    const before = JSON.stringify(pending);
    const response = await fetch('/api/worldinfo/edit', {
        method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ name, data }),
    });
    if (!response.ok) throw new Error(`Could not save ${name} (HTTP ${response.status})`);
    // ST's exported cache is a Map with clone-on-get. Its raw value is also the object captured by a
    // pending native debounce. Bring that payload up to date after confirmation, so it cannot write old text
    // over this save later. No global fetch interception and no private debounce function are needed.
    const current = Map.prototype.get.call(WI.worldInfoCache, name);
    // A native edit made during the request belongs to the next revision; leave it for the library to merge.
    const unchanged = current === pending && JSON.stringify(current) === before;
    if (unchanged && pending && typeof pending === 'object' && pending !== data) {
        for (const key of Object.keys(pending)) delete pending[key];
        Object.assign(pending, structuredClone(data));
    }
    if (unchanged) WI.worldInfoCache.set(name, data);
    await ctx.eventSource.emit(ctx.eventTypes.WORLDINFO_UPDATED, name, data);
}
