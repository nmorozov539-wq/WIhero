// ST 1.19's saveWorldInfo resolves even on HTTP errors and updates its cache before writing.
// Commit through the same endpoint, then publish the confirmed copy to ST's cache and listeners.
export async function writeBook(ctx, WI, name, data) {
    if (!WI.worldInfoCache?.set || !ctx.eventSource?.emit || !ctx.eventTypes?.WORLDINFO_UPDATED) {
        throw new Error('This SillyTavern cannot confirm lorebook saves');
    }
    const response = await fetch('/api/worldinfo/edit', {
        method: 'POST', headers: ctx.getRequestHeaders(), body: JSON.stringify({ name, data }),
    });
    if (!response.ok) throw new Error(`Could not save ${name} (HTTP ${response.status})`);
    WI.worldInfoCache.set(name, data);
    await ctx.eventSource.emit(ctx.eventTypes.WORLDINFO_UPDATED, name, data);
}
