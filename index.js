// WI Hero: story-gated World Info. Entries only become eligible once the story reaches them,
// and retire once it moves past. See docs/DESIGN.md.
import { MODULE, getSettings } from './src/settings.js';
import { mountPanel, renderSummary } from './src/panel.js';
import { buildModel } from './src/engine.js';

const ctx = () => SillyTavern.getContext();
const { eventSource, eventTypes, extensionSettings, saveSettingsDebounced } = ctx();
const settings = getSettings(extensionSettings);

/** Model of the gated entries in the books ST loaded last. */
let model = null;

function onEntriesLoaded(lore) {
    const entries = Object.values(lore ?? {}).filter(Array.isArray).flat();
    model = buildModel(entries);
    renderSummary({ gated: model.byKey.size, issues: model.issues });
}

mountPanel({
    settings,
    handlers: {
        onToggle(value) {
            settings.enabled = value;
            saveSettingsDebounced();
        },
    },
});

eventSource.on(eventTypes.WORLDINFO_ENTRIES_LOADED, onEntriesLoaded);

globalThis.wihero = {
    get model() { return model; },
    settings,
    module: MODULE,
};
