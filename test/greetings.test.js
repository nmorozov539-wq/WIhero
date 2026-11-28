// Hero greeting selection without a browser: the chat's character wins for every book, a no-chat pick is transient,
// unlinking drops the pick, and group chats have none. The cards and rules themselves are the engine tests' job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGreetings } from '../src/ui/greetings.js';
import { bookSettings, configOf, entriesOf } from '../src/ui/data.js';
import { buildModel } from '../src/engine/model.js';

const alice = {
    avatar: 'Alice.png', name: 'Alice', first_mes: 'Alice main.',
    data: { alternate_greetings: ['Alice alt.'] },
};
const bob = {
    avatar: 'Bob.png', name: 'Bob', first_mes: 'Bob main.',
    data: { alternate_greetings: ['Bob alt one.', 'Bob alt two.'] },
};

function harness({ chatOpen = false, characterId = 0, groupId = null, links = [], characters = [alice, bob] } = {}) {
    const H = {};
    const ctx = () => ({ characters, characterId, groupId });
    const library = { chatOpen: () => chatOpen, links: () => links };
    const settings = { books: {} };
    return {
        H, settings, characters, library,
        greetings: createGreetings({
            ctx, H, S: {}, library, settings, saveSettings: () => {}, layer: {}, render() {},
            bookSettings, entriesOf, configOf,
        }),
    };
}

test('no chat: one available linked character is selected automatically', () => {
    const { H, greetings } = harness({ links: [{ kind: 'char', name: 'Alice', avatar: 'Alice.png' }] });
    assert.equal(greetings.selection('Book')?.source, 'linked');
    assert.deepEqual(greetings.linkedCharacters('Book').map(x => x.avatar), ['Alice.png']);
    const sel = greetings.selection('Book');
    assert.equal(sel?.character, alice);
    const cards = greetings.chatGreetings({ entries: {} }, 'Book');
    assert.deepEqual(cards.map(g => g.ref.greeting), [0, 1]);
    assert.deepEqual(cards.map(g => g.title), ['Greeting', 'Alt 1']);
});

test('a manual pick is scoped to one book view and cleared when the book changes', () => {
    const { H, greetings } = harness({ links: [
        { kind: 'char', name: 'Alice', avatar: 'Alice.png' },
        { kind: 'char', name: 'Bob', avatar: 'Bob.png' },
    ] });
    greetings.selection('Book'); // entering the view
    H.greet = { book: 'Book', avatar: 'Alice.png' };
    assert.equal(greetings.selection('Book')?.avatar, 'Alice.png');
    assert.equal(greetings.selection('Other'), null);
    assert.equal(H.greet, null);
});

test('a draw for another book does not end the current view\'s pick', () => {
    const { H, greetings } = harness({ links: [
        { kind: 'char', name: 'Alice', avatar: 'Alice.png' },
        { kind: 'char', name: 'Bob', avatar: 'Bob.png' },
    ] });
    H.book = 'Book';
    greetings.selection('Book');
    H.greet = { book: 'Book', avatar: 'Alice.png' };
    assert.equal(greetings.selection('Another book'), null);
    assert.deepEqual(H.greet, { book: 'Book', avatar: 'Alice.png' }, 'the background book left it alone');
    assert.equal(greetings.selection('Book')?.avatar, 'Alice.png');
});

test('a single-character chat wins over the book links, globally and for another character', () => {
    const { H, greetings } = harness({
        chatOpen: true, characterId: 1,
        links: [{ kind: 'char', name: 'Alice', avatar: 'Alice.png' }],
    });
    greetings.selection('Book');
    H.greet = { book: 'Book', avatar: 'Alice.png' }; // a stale editing pick
    const sel = greetings.selection('Book');
    assert.equal(sel?.source, 'chat');
    assert.equal(sel?.avatar, 'Bob.png');
    assert.equal(H.greet, null, 'opening a chat clears the editing pick');
    assert.deepEqual(greetings.chatGreetings({ entries: {} }, 'Book').map(g => g.ref.greeting), [0, 1, 2]);
});

test('a global book with no links still uses the open chat character', () => {
    const { greetings } = harness({ chatOpen: true, characterId: 1 });
    assert.equal(greetings.selection('Global Book')?.avatar, 'Bob.png');
    assert.equal(greetings.linkedCharacters('Global Book').length, 0);
});

test('a group chat has no greeting selection at all', () => {
    const { H, greetings } = harness({ chatOpen: true, groupId: 'group', characterId: 1 });
    H.greet = { book: 'Book', avatar: 'Alice.png' };
    assert.equal(greetings.selection('Book'), null);
    assert.equal(H.greet, null);
    assert.deepEqual(greetings.chatGreetings({ entries: {} }, 'Book'), []);
});

test('group context suppresses the source row even before a chat is reported open', () => {
    const { greetings } = harness({
        groupId: 'group',
        links: [
            { kind: 'char', name: 'Alice', avatar: 'Alice.png' },
            { kind: 'char', name: 'Bob', avatar: 'Bob.png' },
        ],
    });
    assert.deepEqual(greetings.sourceState('Book'), { visible: false, selection: null, choices: [], canPick: false });
});

test('unlinking drops the no-chat pick but the rules stay in the book', () => {
    const links = [{ kind: 'char', name: 'Alice', avatar: 'Alice.png' }];
    const { H, greetings } = harness({ links });
    greetings.selection('Book');
    H.greet = { book: 'Book', avatar: 'Alice.png' };
    links.length = 0;
    assert.equal(greetings.selection('Book'), null);
    assert.equal(H.greet, null);
    assert.deepEqual(greetings.chatGreetings({ entries: {} }, 'Book'), []);
});

test('primary and auxiliary links are choices, deduplicated by avatar', () => {
    const { greetings } = harness({
        links: [
            { kind: 'char', name: 'Alice', avatar: 'Alice.png' },
            { kind: 'aux', name: 'Alice', file: 'Alice' },
            { kind: 'aux', name: 'Bob', file: 'Bob' },
            { kind: 'chat', name: 'This chat' },
        ],
    });
    assert.deepEqual(greetings.linkedCharacters('Book').map(x => x.avatar), ['Alice.png', 'Bob.png']);
});

test('missing linked characters are not selectable greeting sources', () => {
    const { greetings } = harness({ links: [
        { kind: 'char', name: 'Gone', avatar: 'Gone.png' },
        { kind: 'aux', name: 'Also gone', file: 'Also gone' },
    ] });
    assert.deepEqual(greetings.linkedCharacters('Book'), []);
    assert.equal(greetings.selection('Book'), null);
});

test('multiple linked characters wait for a book-scoped manual choice', () => {
    const { H, greetings } = harness({ links: [
        { kind: 'char', name: 'Alice', avatar: 'Alice.png' },
        { kind: 'char', name: 'Bob', avatar: 'Bob.png' },
    ] });
    assert.equal(greetings.selection('Book'), null);
    H.greet = { book: 'Book', avatar: 'Bob.png' };
    assert.equal(greetings.selection('Book')?.name, 'Bob');
    assert.deepEqual(greetings.chatGreetings({ entries: {} }, 'Book').map(g => g.ref.greeting), [0, 1, 2]);
});

test('a selected character remains the source when it has no usable greetings', () => {
    const quiet = { avatar: 'Quiet.png', name: 'Quiet', first_mes: '   ', data: { alternate_greetings: ['', '  '] } };
    const { greetings } = harness({
        characters: [quiet],
        links: [{ kind: 'char', name: 'Quiet', avatar: 'Quiet.png' }],
    });
    assert.equal(greetings.selection('Book')?.name, 'Quiet');
    assert.deepEqual(greetings.chatGreetings({ entries: {} }, 'Book'), []);
});

test('exporting and reimporting the book JSON keeps every greeting ref', () => {
    const ref = { greeting: 1, char: 'Alice.png', name: 'Alice', fp: 'fp' };
    const data = { entries: { 0: {
        uid: 0, world: 'Book', comment: 'Road', key: ['road'], content: '',
        extensions: { wihero: {
            id: 'road', gate: [[ref]], closeGate: [[ref]], gatedBy: [ref],
            masks: [{ name: 'm', content: 'Mask text.', gate: [[ref]], closeGate: [[ref]] }],
        } },
    } } };
    // The lorebook file is plain JSON: nothing extra may be needed for refs to come back.
    const imported = JSON.parse(JSON.stringify(data)).entries['0'];
    const model = buildModel([{ ...imported, world: 'Book' }], { greetingFp: () => 'fp', activeAvatar: 'Alice.png' });
    const node = model.nodes.get('Book/road');
    assert.equal(node.opens.rows[0].items[0].key, 'Book/@Alice.png:1');
    assert.equal(node.closes[0].row.items[0].key, 'Book/@Alice.png:1');
    assert.equal(node.opens.all[0].key, 'Book/@Alice.png:1');
    assert.equal(node.masks[0].opens[0].items[0].key, 'Book/@Alice.png:1');
    assert.equal(node.masks[0].closes[0].items[0].key, 'Book/@Alice.png:1');
});

test('a nickname is display state for the book, not a change to the greeting', () => {
    const { H, greetings } = harness({ links: [{ kind: 'char', name: 'Alice', avatar: 'Alice.png' }] });
    greetings.selection('Book');
    H.greet = { book: 'Book', avatar: 'Alice.png' };
    const fp = greetings.chatGreetings({ entries: {} }, 'Book')[1].fp;
    assert.equal(greetings.setNickname('Book', 'Alice.png', 1, fp, '  The letter  '), true);
    const named = greetings.chatGreetings({ entries: {} }, 'Book')[1];
    assert.equal(named.title, 'The letter');
    assert.equal(named.canonical, 'Alt 1');
    assert.equal(named.nickname, 'The letter');
    assert.equal(named.ref.fp, fp, 'the greeting ref is untouched');
    // Duplicate names are allowed: the character and alternate number remain the identity.
    const firstFp = greetings.chatGreetings({ entries: {} }, 'Book')[0].fp;
    assert.equal(greetings.setNickname('Book', 'Alice.png', 0, firstFp, 'The letter'), true);
    const both = greetings.chatGreetings({ entries: {} }, 'Book');
    assert.deepEqual(both.map(g => g.title), ['The letter', 'The letter']);
    assert.deepEqual(both.map(g => g.ref.greeting), [0, 1]);
    assert.equal(greetings.setNickname('Book', 'Alice.png', 1, fp, '   '), true);
    assert.equal(greetings.chatGreetings({ entries: {} }, 'Book')[1].title, 'Alt 1');
});
