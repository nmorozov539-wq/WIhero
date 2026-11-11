// The editor's pure parts (N2): book and entry helpers, folders and settings, search, the Story logic sentences
// and the snapshot helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../src/engine/model.js';
import {
    MIXED, PARAM_LIST, addEntry, bookFolderOf, bookSettings, cardKey, commonValue, copyBookSettings, deleteBookSettings, forgetReusedNames,
    duplicateEntry, ensureSettings, entryAsText, folderOf, groupEntries, sortEntries, idOf, isBlank, moveEntry, paramSummary, paramText,
    rekeyEntry, removeEntry, renameBookSettings, reorderEntries, search, setBookFolder, setFolder, setParam, setStrategy, strategyOf,
} from '../src/ui/data.js';
import { closedText, logicLines, logicSummary } from '../src/ui/logic-text.js';
import { defaultSnapshotName, snapshotFileName, sortSnapshots, toBase64 } from '../src/ui/snapshots.js';
import { e } from './sim.js';

const TEMPLATE = { key: [], keysecondary: [], comment: '', content: '', constant: false, vectorized: false, selective: true, selectiveLogic: 0, order: 100, position: 0, disable: false, probability: 100, useProbability: true, depth: 4, sticky: null, cooldown: null, delay: null, scanDepth: null, caseSensitive: null, matchWholeWords: null, group: '' };
const book = (...entries) => ({ entries: Object.fromEntries(entries.map(x => [x.uid, x])) });
const by = name => PARAM_LIST.find(p => p.field === name);

test('strategy: keys, permanent, vectorized, off', () => {
    const x = { ...TEMPLATE };
    assert.equal(strategyOf(x), 'keys');
    setStrategy(x, 'perm');
    assert.equal(strategyOf(x), 'perm');
    setStrategy(x, 'vec');
    assert.deepEqual([x.constant, x.vectorized, strategyOf(x)], [false, true, 'vec']);
    x.disable = true;
    assert.equal(strategyOf(x), 'off');
});

test('a new entry takes the template, then the book\'s defaults, at a free uid', () => {
    const data = book(e(0, 'road'), e(2, 'mill'));
    const x = addEntry(data, TEMPLATE, { order: 50 });
    assert.equal(x.uid, 1);
    assert.equal(x.order, 50);
    assert.equal(data.entries[1], x);
    assert.ok(isBlank(x));
    x.content = 'Something';
    assert.ok(!isBlank(x));
});

test('duplicating gives the copy a fresh id; moving keeps it unless the target has it', () => {
    const data = book(e(0, 'mill', { id: 'mill', gate: [['road']] }));
    const copy = duplicateEntry(data, 0);
    assert.equal(copy.uid, 1);
    assert.equal(copy.comment, 'mill copy');
    assert.equal(idOf(copy), 'mill-copy');
    assert.deepEqual(copy.extensions.wihero.gate, [['road']]);

    const target = book(e(0, 'other', { id: 'mill' }));
    const moved = moveEntry(data, 0, target);
    assert.equal(data.entries[0], undefined);
    assert.equal(moved.uid, 1);
    assert.equal(idOf(moved), 'mill-2');
    const free = book();
    const moved2 = moveEntry(data, 1, free);
    assert.equal(idOf(moved2), 'mill-copy');
});

test('a book imported from a card: deleting or moving an entry drops its originalData entry, like ST', () => {
    const data = book(e(0, 'road', { id: 'road' }), e(1, 'mill', { id: 'mill' }));
    data.originalData = { entries: [{ uid: 0, keys: ['road'] }, { uid: '1', keys: ['mill'] }] };
    removeEntry(data, 1);
    assert.equal(data.entries[1], undefined);
    assert.deepEqual(data.originalData.entries.map(x => x.uid), [0], 'a string uid matches too');
    moveEntry(data, 0, book());
    assert.deepEqual(data.originalData.entries, []);
    const plain = book(e(0, 'road', { id: 'road' }));
    removeEntry(plain, 0);
    assert.equal(plain.originalData, undefined);
});

test('parameters: text, summary, and Who triggers stored in the story logic', () => {
    const data = book({ ...TEMPLATE, uid: 0, comment: 'Wolf', key: ['wolf'] });
    const x = data.entries[0];
    assert.equal(paramSummary(x), 'Defaults');
    assert.equal(paramText(x, by('sticky')), '0 messages', 'ST\'s null shows as the default');
    setParam(data, 0, by('probability'), 40);
    setParam(data, 0, by('position'), 4);
    assert.equal(paramSummary(x), 'Position At depth, Probability 40%');
    setParam(data, 0, by('by'), 'user');
    assert.equal(x.extensions.wihero.by, 'user');
    assert.equal(idOf(x), 'wolf', 'the first piece gives the entry an id');
    setParam(data, 0, by('by'), null);
    assert.equal(x.extensions.wihero.by, undefined);
    assert.equal(paramText(x, by('caseSensitive')), 'Use global');
});

test('bulk Edit: a value the selected entries share, or Mixed', () => {
    const a = { ...TEMPLATE, uid: 0, order: 100 };
    const b = { ...TEMPLATE, uid: 1, order: 120 };
    assert.equal(commonValue([a, b], by('order')), MIXED);
    assert.equal(commonValue([a, b], by('probability')), 100);
});

test('settings: folders by id or uid, and a first id moves them', () => {
    const s = ensureSettings({});
    assert.equal(s.colorMode, 'standard');
    const x = e(3, 'inn');
    setFolder(s, 'Town', x, ' Places / Town ');
    assert.equal(s.books.Town.folders['uid:3'], 'Places/Town');
    assert.equal(folderOf(s, 'Town', x), 'Places/Town');
    rekeyEntry(s, 'Town', 3, 'inn');
    assert.deepEqual(s.books.Town.folders, { 'id:inn': 'Places/Town' });
    const y = e(3, 'inn', { id: 'inn' });
    assert.equal(cardKey(y), 'id:inn');
    assert.equal(folderOf(s, 'Town', y), 'Places/Town');
    setFolder(s, 'Town', y, '');
    assert.deepEqual(s.books.Town.folders, {});
});

test('settings: renaming, duplicating and deleting a book carry its settings', () => {
    const s = ensureSettings({});
    bookSettings(s, 'Old').snapshots = [{ name: 'x', at: 1 }];
    setBookFolder(s, 'Old', 'Drafts');
    renameBookSettings(s, 'Old', 'New');
    assert.equal(s.books.Old, undefined);
    assert.equal(s.books.New.snapshots.length, 1);
    assert.equal(bookFolderOf(s, 'New'), 'Drafts');
    assert.equal(s.renamed.Old, 'New');
    renameBookSettings(s, 'New', 'Newer');
    assert.deepEqual(s.renamed, { Old: 'Newer', New: 'Newer' }, 'chats saved under either old name still find the book');
    copyBookSettings(s, 'Newer', 'Copy');
    assert.deepEqual(s.books.Copy.snapshots, [], 'a copy has no snapshots of its own');
    assert.equal(bookFolderOf(s, 'Copy'), 'Drafts');
    deleteBookSettings(s, 'Newer');
    assert.equal(s.books.Newer, undefined);
    assert.deepEqual(s.bookFolders, { Drafts: ['Copy'] });
});

test('a new book under an old name ends that rename (review finding 2)', () => {
    const s = ensureSettings({});
    renameBookSettings(s, 'Kingdom', 'Kingdom v2');
    assert.equal(forgetReusedNames(s, ['Other']), false);
    assert.equal(forgetReusedNames(s, ['Kingdom', 'Kingdom v2']), true);
    assert.deepEqual(s.renamed, {});
});

test('folders are containers; entries sort inside them by order, A–Z or a strategy first', () => {
    const list = [e(0, 'road'), e(1, 'inn', undefined, { constant: true }), e(2, 'mill', undefined, { disable: true }), e(3, 'Bell', undefined, { vectorized: true })];
    const folders = { 0: 'Places', 2: 'Places' };
    assert.deepEqual(groupEntries(list, 'order', x => folders[x.uid] ?? '').map(([g, l]) => [g, l.map(x => x.uid)]), [['', [1, 3]], ['Places', [0, 2]]]);
    const uids = by => sortEntries(list, by).map(x => x.uid);
    assert.deepEqual(uids('order'), [0, 1, 2, 3]);
    assert.deepEqual(uids('az'), [3, 1, 2, 0]);
    assert.deepEqual(uids('perm'), [1, 0, 3, 2], 'permanent first, off last');
    assert.deepEqual(uids('vec'), [3, 0, 1, 2]);
    assert.deepEqual(uids('keys'), [0, 1, 3, 2]);
});

test('search: the open book\'s entries first, then other books\', books and folders', () => {
    const books = [
        { name: 'Eldoria', folder: 'Fantasy', entries: [e(0, 'river'), e(1, 'King', undefined, { key: ['king'] })], folderOf: x => (x.uid === 0 ? 'Rivers' : '') },
        { name: 'River tales', folder: '', entries: [e(0, 'riverbank')], folderOf: () => '' },
    ];
    const hits = search(books, 'river', 'River tales');
    assert.deepEqual(hits.map(h => `${h.kind}:${h.book ?? ''}:${h.entry?.comment ?? h.folder ?? ''}`), [
        'entry:River tales:riverbank', 'entry:Eldoria:river', 'book:River tales:', 'folder:Eldoria:Rivers',
    ]);
    assert.deepEqual(search(books, 'fantasy', null).map(h => h.kind), ['folder']);
    assert.deepEqual(search(books, 'river', null).map(h => `${h.kind}:${h.book ?? ''}`), ['book:River tales', 'folder:Eldoria', 'entry:Eldoria', 'entry:River tales'],
        'with no book open, books come first');
    assert.deepEqual(search(books, '  ', null), []);
});

test('copy as text', () => {
    assert.equal(entryAsText({ comment: 'Mill', key: ['mill', 'wheel'], content: 'An old mill.' }), 'Mill\nKey words: mill, wheel\n\nAn old mill.');
});

test('Story logic sentences, with the rules other entries put on this one', () => {
    const entries = [
        e(0, 'road', { id: 'road' }, { comment: 'Road' }),
        e(1, 'mill', { id: 'mill', gate: [['road']], closesFor: ['road'] }, { comment: 'Mill' }),
        e(2, 'tunnel', { id: 'tunnel', gate: [['mill', { lock: ['red beard'], by: 'user' }]], closesFor: ['mill'] }, { comment: 'Tunnel' }),
        e(3, 'echo', { id: 'echo', glue: { mode: 'ride', host: 'tunnel' }, once: true, by: 'char' }, { comment: 'Echo' }),
        e(4, 'storm', { id: 'storm', glue: { mode: 'hold' }, closeGate: [[{ lock: ['calm', 'the rain stops'] }], [{ wait: 3 }]], packs: ['weather'] }, { comment: 'Storm' }),
        e(5, 'fork', { id: 'fork', switch: ['road', 'storm'], gatesFor: ['#weather'] }, { comment: 'Fork' }),
    ];
    const model = buildModel(entries);
    const lines = key => logicLines(model.nodes.get(`Book/${key}`), model).map(l => `${l.label}: ${l.text}`);
    assert.deepEqual(lines('mill'), ['Gate: Opens when Road has fired', 'Closed by: Tunnel when it fires', 'Closes for: When it fires, closes Road']);
    assert.deepEqual(lines('tunnel'), ['Gate: Opens when Mill has fired and you say "red beard"', 'Closes for: When it fires, closes Mill', 'Ridden by: Echo rides along when it fires']);
    assert.deepEqual(lines('echo'), ['Glue: Rides along with Tunnel: fires when it fires', 'Once: Fires one time, then closes', 'Who triggers: Only the character\'s replies trigger it']);
    assert.deepEqual(lines('storm'), [
        'Held back by: Waits until Fork has fired',
        'Close gate: Closes when "calm" or "the rain stops" is said; or when 3 messages have passed',
        'Glue: Holds: once fired it stays on until its close gate',
        'Switch path: Closes when Road fires: only one path of the fork can follow',
        'Packs: In #weather',
    ]);
    assert.ok(lines('fork').includes('Gates for: Holds back #weather until this fires'));
    assert.equal(logicSummary(logicLines(model.nodes.get('Book/mill'), model)), 'Gate, Closed by, Closes for');
    assert.deepEqual(logicLines(null, model), []);
});

test('delayed closing reads "it has fired" in the story logic', () => {
    const model = buildModel([e(0, 'fog', { id: 'fog', glue: { mode: 'hold' }, closeGate: [['fog', { wait: 3 }]] }, { comment: 'Fog' })]);
    const lines = logicLines(model.nodes.get('Book/fog'), model).map(l => `${l.label}: ${l.text}`);
    assert.ok(lines.includes('Close gate: Closes when it has fired and 3 messages have passed'), lines.join('\n'));
});

test('closed in this chat by …', () => {
    const name = key => ({ 'Book/tunnel': 'Tunnel' })[key] ?? null;
    assert.equal(closedText('closesFor:Book/tunnel', name), 'Tunnel');
    assert.equal(closedText('switch:Book/gone', name), 'a rule that no longer exists');
    assert.equal(closedText('closeGate', name), 'its close gate');
    assert.equal(closedText('once', name), 'Once, after it fired');
});

test('snapshot helpers', () => {
    assert.equal(snapshotFileName('Eldoria Tales', 1700000000000), 'wihero-snap-eldoria-tales-1700000000000.json');
    assert.match(snapshotFileName('Сказки', 5), /^wihero-snap-book-[a-z0-9]+-5\.json$/, 'a name with no ASCII letters still makes a valid file name');
    assert.equal(defaultSnapshotName(new Date(2026, 10, 2, 9, 5)), '2026-11-02 09:05');
    assert.deepEqual(sortSnapshots([{ at: 1, imported: true }, { at: 2 }, { at: 3 }]).map(s => s.at), [3, 2, 1]);
    assert.equal(Buffer.from(toBase64('Ünïcode ✓'), 'base64').toString('utf8'), 'Ünïcode ✓');
});

test('ST settings without a control of their own: groups, recursion, extra sources, characters, generation types', async () => {
    const { PARAM_LIST: L, paramSummary: sum, paramText: txt, setParam: put, filterChoices } = await import('../src/ui/data.js');
    const p = f => L.find(x => x.field === f);
    const ent = { uid: 0, comment: 'A', key: ['a'], content: '' };
    assert.equal(sum(ent), 'Defaults');
    assert.equal(p('groupWeight').when(ent), false, 'group settings only with a group');
    ent.group = 'weather';
    assert.equal(p('groupWeight').when(ent), true);
    ent.groupOverride = true;
    ent.delayUntilRecursion = true;
    assert.equal(txt(ent, p('delayUntilRecursion')), '1', 'true is level 1');
    ent.delayUntilRecursion = 0;
    assert.equal(txt(ent, p('delayUntilRecursion')), 'No');
    ent.matchScenario = true;
    ent.triggers = ['swipe', 'normal'];
    assert.equal(txt(ent, p('triggers')), 'Normal, Swipe');
    assert.equal(txt({ ...ent, triggers: [] }, p('triggers')), 'All');
    const was = filterChoices.get;
    filterChoices.get = () => ({ chars: [{ key: 'Seraphina', name: 'Seraphina' }], tags: [{ key: 't1', name: 'fantasy' }] });
    const data = { entries: { 0: ent } };
    put(data, 0, p('characterFilter'), { isExclude: true, names: ['Seraphina'], tags: ['t1'] });
    assert.deepEqual(ent.characterFilter, { isExclude: true, names: ['Seraphina'], tags: ['t1'] });
    assert.equal(txt(ent, p('characterFilter')), 'All but Seraphina, #fantasy');
    put(data, 0, p('characterFilter'), null);
    assert.equal(txt(ent, p('characterFilter')), 'Any', 'cleared, as ST keeps it: an empty filter');
    filterChoices.get = was;
    ent.useProbability = false;
    const s = sum(ent);
    for (const part of ['Inclusion group weather', 'Prioritize in its group Yes', 'Also match the scenario Yes', 'Generation types Normal, Swipe', 'Also set: probability off']) assert.ok(s.includes(part), `${part} in "${s}"`);
});

test('reorderEntries moves entries by displayIndex only, never the Order parameter', () => {
    const d = { entries: {
        0: { uid: 0, comment: 'A', order: 100, displayIndex: 0 },
        1: { uid: 1, comment: 'B', order: 50, displayIndex: 1 },
        2: { uid: 2, comment: 'C', order: 10, displayIndex: 2 },
        3: { uid: 3, comment: 'D', order: 5 },
    } };
    const old = reorderEntries(d, [2], 0);
    assert.deepEqual(sortEntries(Object.values(d.entries), 'order').map(e => e.comment), ['C', 'A', 'B', 'D']);
    assert.deepEqual(Object.values(d.entries).map(e => e.order), [100, 50, 10, 5]);
    assert.equal(old.get(2), 2);
    // Several at once keep their own order; "after" lands below the target. D had no displayIndex: Undo knows it.
    const old2 = reorderEntries(d, [3, 0], 1, true);
    assert.deepEqual(sortEntries(Object.values(d.entries), 'order').map(e => e.comment), ['C', 'B', 'A', 'D']);
    assert.ok(old2.has(0));
    assert.equal(reorderEntries(d, [1], 1), null); // onto itself
    assert.equal(reorderEntries(d, [9], 1), null); // nothing to move
});

test('sortEntries by prompt order: the Order parameter (100 when unset), then list order', () => {
    const list = [
        { uid: 0, comment: 'A', order: 200, displayIndex: 0 },
        { uid: 1, comment: 'B', displayIndex: 1 },
        { uid: 2, comment: 'C', order: 5, displayIndex: 2 },
        { uid: 3, comment: 'D', order: 100, displayIndex: 3 },
    ];
    assert.deepEqual(sortEntries(list, 'prompt').map(e => e.comment), ['C', 'B', 'D', 'A']);
    assert.deepEqual(sortEntries(list, 'order').map(e => e.comment), ['A', 'B', 'C', 'D']);
});
