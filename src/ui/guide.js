// The Guide (LAYOUT "Guide"): one page per piece, and anchors for the canvas controls, the strip, the inspector and
// Preview. The one place the pieces are explained in depth; the inspector's "?", the strip's "?", "+ Add logic" and
// explain mode all open it at an anchor. The fine print follows CONCEPTS.md: change one, change the other.

import { GREETINGS } from '../engine/model.js';

/**
 * One page per piece, in the piece bar's order, then the entry settings and the start cards.
 * Each: { id, title, family (VISUAL 6.2), line, example, fine[], mistakes[], show (a card key in the Sample book) }.
 */
export const PAGES = [
    {
        id: 'opens', title: 'Opens', family: 'open',
        line: 'One card waits for another: it can only fire once the other has fired.',
        example: 'Road opens Mill: the mill only shows up after the road has come up in the chat.',
        fine: [
            'From the next message: the card opens for the generation after the one where the other fired, so a chain never runs ahead of the chat.',
            'Several links into one card are joined: "both" (all of them, one row) or "either one" (any of them, separate rows).',
            'A pack can open a card, read as any one, all, or at least a number of its members.',
            'Stored on the waiting card as its Gate, or on the source as Gates for when the other end is a pack. Both mean the same.',
        ],
        mistakes: [
            'A link the wrong way round: the first card you pick is the one doing the opening. ⇄ in the strip turns it around.',
            'A loop (A waits for B, B waits for A): it can never open. WI Hero refuses it.',
        ],
        show: 'id:mill',
    },
    {
        id: 'closes', title: 'Closes', family: 'close',
        line: 'When one card fires, another closes for good.',
        example: 'Crossing closes Ferry: once the party has crossed, the ferry is no longer mentioned.',
        fine: [
            'Closed stays closed for this branch of the chat. A swipe or a delete rewinds it; Reopen in the inspector undoes it by hand.',
            'Closing beats opening: a card closed this turn didn\'t happen. It fires nothing and opens nothing.',
            'From the next message, like Opens. A running sticky finishes first.',
            'Its own close gate can also hold locks and waits: "close when someone says the rain stops".',
            'A close gate can name its own card, meaning "after it first fires": Fog with a wait of 3 closes three messages after the fog rolls in.',
            'To let a card show in the same turn as the one that closes it, add a wait of 1 to that close row: it then closes from the next message.',
        ],
        mistakes: [
            'A card that should show once and then close: use Once, or its own card in its close gate.',
            'A close gate that is always met before the gate opens: the card can never fire. WI Hero warns about it.',
        ],
        show: 'id:crossing',
    },
    {
        id: 'glue', title: 'Glue', family: 'glue',
        line: 'Keeps a card on whether or not its key words match.',
        example: 'Storm holds until it passes: once the storm starts, it stays in every reply until its close gate is met.',
        fine: [
            'Ride along: the card fires whenever its host fires, and only then. One host per card.',
            'Hold: from its first firing it stays on every turn until something closes it.',
            'Glue is not exempt from closing: any close ends it.',
        ],
        mistakes: [
            'A hold with nothing that closes it stays on for the rest of the chat.',
            'A cooldown, or a probability under 100%, still drops a glued card now and then.',
        ],
        show: 'id:storm',
    },
    {
        id: 'switch', title: 'Switch', family: 'close',
        line: 'A fork: when one path fires, every other path closes for good.',
        example: 'Fork, left or right: taking the left path closes the right one.',
        fine: [
            'Two or more paths, entries only (not packs).',
            'If two paths would fire in the same turn, only the first in switch order goes in; the others close.',
            '"The paths can\'t fire before the fork does" (on by default) makes the switch a gate too: each path waits for the fork card.',
            '"Roll the dice" picks the path at random when the fork first fires; the other paths close. The picked path still fires the usual way, so to have it just happen, make the paths Permanent and keep them waiting for the fork (else they fire on the first turn, before the roll). A swipe keeps the roll; rewriting the message before it rolls again.',
        ],
        mistakes: ['A path that doesn\'t wait for its fork can be taken before the fork. WI Hero warns about it.'],
        show: 'id:fork',
    },
    {
        id: 'mask', title: 'Mask', family: 'mask',
        line: 'Another version of a card\'s text, used when the story calls for it.',
        example: 'Tower, ruined after the storm: the same tower, described as a ruin once the storm has passed.',
        fine: [
            'Each mask has its own text, an "on when" (its gate) and an "off when" (its close gate).',
            'Order is priority: the last mask that is on wins. Below them all is the main text.',
            'A mask with no "on when" is only used when picked by hand (/wihero-mask).',
            'The masked text doesn\'t drive recursion.',
        ],
        mistakes: ['Two masks that are both on: only the later one is used. Reorder them with ↑ ↓.'],
        show: 'id:tower',
    },
    {
        id: 'tracker', title: 'Tracker', family: 'track',
        line: 'Text the model writes: WI Hero reads each new reply for its line and sends the newest value.',
        example: 'Gold: the model ends its replies with [Gold: 7], and from the next message the card sends 7.',
        fine: [
            'The main text or any mask can be written by the model. The card\'s own text is the start value.',
            'A written mask is on while it holds a value: writing it turns it on, an empty value ([Gold: ]) turns it off.',
            'A reply without the line keeps the last value. Swipes, deletes and branches rewind it.',
            'Only an open card reads: not waiting on its gate, not closed, not switched off.',
            'One syntax per book (Syntax and teaching…). Your preset can tell the model what to write, or WI Hero can teach it with one short instruction.',
            'Fix a value by hand from the card, or with /wihero-set entry=<id> [mask=<name>] <text>.',
        ],
        mistakes: ['Two trackers with the same label: neither is read.', 'Labels that start the same way (Gold, Gold bag): the model mixes them up.'],
    },
    {
        id: 'pack', title: 'Pack', family: 'pack',
        line: 'A tag that groups cards, so rules can treat them as one.',
        example: '#town holds the tavern and the market; Gatehouse opens all of #town at once.',
        fine: [
            'town/inn sits inside town: a rule on town covers it too.',
            'Read as any one (#town), all (#town:all) or at least a number (#town:2).',
            'As a target it takes Opens and Closes: the rule applies to every member.',
            'The frame shows as soon as one member is on the canvas.',
        ],
        mistakes: ['A pack with no members doesn\'t exist: a rule on it is a problem.'],
        show: 'id:tavern',
    },
    {
        id: 'lock', title: 'Lock', family: 'open',
        line: 'Waits for a phrase in the chat.',
        example: 'Cave opens when someone says "red beard".',
        fine: [
            'Checked against your newest message and the newest reply.',
            'Said in your message, it counts in the reply to it. Said in a reply, it counts from the next message.',
            'Armed only once the rest of its row has fired; a phrase said before that does nothing. A lock alone in a row is always armed.',
            'Several phrases: any one is enough. Who says it: anyone, you, or the character.',
        ],
        mistakes: ['A lock that is never armed because its row waits for a card that never fires.', 'Many cards reacting to the same phrase: make it a Moment instead.'],
        show: 'id:cave',
    },
    {
        id: 'wait', title: 'Wait', family: 'open',
        line: 'Waits for a number of messages to pass.',
        example: 'Bridge opens two messages after the road.',
        fine: [
            'It counts from when the rest of its row has fired; alone in a row, from the start of the chat. With the card itself in its close gate, from its first firing.',
            'Whose messages count: everyone\'s, yours, or the character\'s.',
            'In a close gate it gives timed endings: "close three messages after the storm starts".',
            'A row with a wait and a lock: the lock is armed once the wait has run out.',
        ],
        mistakes: ['A wait on a card that never fires never runs out.'],
        show: 'id:bridge',
    },
    {
        id: 'moment', title: 'Moment', family: 'moment',
        line: 'Something that can happen in the story, said in the chat, on a card of its own.',
        example: 'Missing tooth happens when someone says "missing tooth"; Dentist waits for it, and Tower closes when it happens.',
        fine: [
            'It happens when one of its phrases is in your newest message or the newest reply, said by the side it allows.',
            'Timing follows locks: in your message, in time for the reply to it; in a reply, from the next message.',
            'Once it has happened it stays happened, and rewinds with the chat.',
            'Its own gate arms it: "only counts after the kiss".',
            'It sends nothing to the model, and can\'t be closed.',
        ],
        mistakes: ['A Moment with no phrases can never happen.', 'A Moment nothing uses does nothing: link it to a card.'],
        show: null,
    },
    {
        id: 'once', title: 'Once', family: 'close',
        line: 'The card fires one time, then closes.',
        example: 'Omen fires once: the first sign is mentioned, and never again.',
        fine: ['It closes from the next message on, and rewinds with the chat.', 'Not offered on glued cards: glue has its own way of ending.'],
        mistakes: [],
        show: 'id:omen',
    },
    {
        id: 'by', title: 'Who triggers', family: 'by',
        line: 'Whose messages the key words are matched against.',
        example: 'Whisper only fires when you say its word, not when the character does.',
        fine: [
            'Your messages, the character\'s replies, or both (the default).',
            'WI Hero checks the key words itself for these cards, within their scan depth.',
            'Only chat messages count. A match through another entry\'s text (recursion), the character card, the persona or the scenario doesn\'t, and only the main key words are checked, not the optional filter.',
            'A book can set it in New entry defaults.',
        ],
        mistakes: [],
        show: 'id:whisper',
    },
    {
        id: 'greeting', title: 'Greeting', family: 'by',
        line: 'A start card for one of the character\'s greetings.',
        example: 'Alt 2 opens the night market: a chat that starts on that greeting starts that scenario.',
        fine: [
            'It counts as fired from the chat\'s first message when that is the greeting the chat opened with.',
            'Only the open chat\'s character\'s greetings show; single-character chats only.',
            'It can open and close cards; it takes no gate of its own.',
            'If the greeting\'s text changes, it stops until it is re-picked.',
        ],
        mistakes: [],
        show: null,
    },
].filter(p => GREETINGS || p.id !== 'greeting'); // greetings are retired for v1 (#33)

/** Anchors for things that aren't pieces: the canvas controls, the strip, the inspector and Preview. */
export const TOPICS = [
    { id: 'canvas', title: 'Cards and lines', line: 'Each card is an entry; each line is a rule between two of them.', fine: ['A socket (a notch) is a way in, a knob (a half disc) a way out. Teal opens, red closes, yellow is glue.', '"and" and "or" chips are where several links meet before a card.', 'On a phone, cards move by their six-dot grip and everything else pans; with a mouse, drag the whole card.', 'A long press on empty canvas, then a drag, picks every card in the box: pack them, unpack them, or drag them together by a grip. Let go without dragging to place an entry there.'] },
    { id: 'fit', title: 'Fit', line: 'Brings every card into view.', fine: ['On a phone, a book opens at a readable size, fitting the width and scrolling down from there; Fit zooms out until everything shows.'] },
    { id: 'tidy', title: 'Tidy layout', line: 'Lays every card out again from the links.', fine: ['Ports go back to their default sides. Undo puts everything back.'] },
    { id: 'undo', title: 'Undo and redo', line: 'Steps back through your changes to this book, and forward again.', fine: ['Everything WI Hero keeps for the book counts: text, parameters, story logic, where cards sit and how links are shaped. Looking around (pan and zoom) doesn\'t.', 'On desktop: Ctrl Z, and Ctrl Shift Z or Ctrl Y to redo. In a text box they undo the typing instead.', 'A piece being set up in the strip is one step once you press Done.', 'A change made outside WI Hero (ST\'s own editor, a slash command) starts the book\'s history over.'] },
    { id: 'checks', title: 'Dead branches and clashes', line: 'The chip at the top of the canvas counts what the book alone says is off.', fine: ['Dead: an entry that can never fire, or a gate row or mask that can never open. The chip\'s mark turns red when anything is dead.', 'Clashes: a key word that fires two or more entries. Their marking can be turned off: ⌄ menu, Display, Mark keyword clashes.', 'Tap the chip for the list; tap a line there to go to the card. The chip is gone when the book is clean.'] },
    { id: 'panel', title: 'Entry panel', line: 'Every entry in the book, with a dot to place it on the canvas.', fine: ['A filled dot is on the canvas; a hollow dot isn\'t yet.', 'Moments have their own group at the top.'] },
    { id: 'strip', title: 'The strip', line: 'The piece bar turns into it while a piece is set up.', fine: ['What it sets is written at once, so the canvas shows it.', 'Cancel puts the book back as it was; Done keeps it.', 'Anything that would be a problem is refused with one line saying why.'] },
    { id: 'inspector', title: 'The inspector', line: 'One card\'s story logic: a row per piece, tap one to edit it.', fine: ['"From other entries" lists the rules other cards aim at this one.', 'The "?" by a piece opens its page here.'] },
    { id: 'highlights', title: 'Preview highlights', line: 'In the pretend exchange, the words that set something off.', fine: ['Solid: a card with story logic; dotted: a plain entry. Struck through: blocked, with the reason on tap.', 'Lock and Moment phrases are marked in the color of what they do.'] },
    { id: 'also', title: 'Also active', line: 'What goes in without a word pointing at it.', fine: ['Permanent and vector entries, glue, and key words matched in earlier messages.'] },
];

export const pageOf = id => PAGES.find(p => p.id === id) ?? TOPICS.find(t => t.id === id) ?? null;

/** The Guide page for an inspector piece key (CONCEPTS 3) or a piece bar chip. */
export const PIECE_ANCHOR = { gate: 'opens', gatesFor: 'opens', closeGate: 'closes', closesFor: 'closes', glue: 'glue', switch: 'switch', masks: 'mask', written: 'tracker', packs: 'pack', once: 'once', by: 'by', opens: 'opens', closes: 'closes', mask: 'mask', pack: 'pack', lock: 'lock', wait: 'wait', moment: 'moment' };
