// Extension settings.

export const MODULE = 'wihero';

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
});

export function getSettings(extensionSettings) {
    const merged = { ...DEFAULT_SETTINGS, ...(extensionSettings[MODULE] ?? {}) };
    extensionSettings[MODULE] = merged;
    return merged;
}
