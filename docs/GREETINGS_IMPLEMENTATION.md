# Greetings implementation notes

Read [GREETINGS_DESIGN.md](GREETINGS_DESIGN.md) first. That document defines
the product behavior. This one records the implementation boundaries the
feature was built to.

## Scope and precedence

- Greeting behavior is built for single-character chats and Hero mode. Runtime
  logic applies regardless of whether the user is looking at Normal or Hero;
  greeting editing UI is in Hero only.
- Group chats get no greeting selection, cards, rules, Preview starts, or
  nickname UI. Their behavior is otherwise unchanged.
- Moments are unchanged: a Moment is never turned into a greeting, and Moment
  rules are not migrated.
- Existing greeting refs in books are preserved. No metadata-only World Info
  entry is added. Greeting cards themselves write no book data until a rule is
  attached to an affected entry.
- Nicknames live in the Greetings drawer of the Hero entry panel.
- The old greeting sections of BUILD_SPEC, CONCEPTS, LAYOUT and VISUAL
  described the retired implementation. They now describe this shipped
  behavior.

## Data contract

A greeting reference is stored on the affected entry as:

```js
{ greeting: 2, char: 'Seraphina.png', name: 'Seraphina', fp: '...' }
```

`greeting` is 0 for the main greeting and `n` for Alt n; `char` is the avatar
file name. `name` is fallback display text. `fp` uses the existing
`greetingFingerprint` so old refs remain valid. The containing entry's World
Info book supplies the book scope. Refs stay in `gate`, `closeGate`, mask rows,
and `gatedBy`. `Gates for` and `Closes for` from a greeting write onto target
entries and pack members. No logic is stored on the greeting card.

Runtime state uses a book-scoped key, `<book>/@<avatar>:<greeting-number>`.
The book name is never put into exported refs. Old `@<avatar>:<number>` state
keys in chat snapshots are ambiguous if several books used them: they are
inert, and the current opening greeting is derived from chat[0]. `renameBooks`
moves the new keys on book rename.

Nickname settings are per book, under
`settings.books[book].greetingNames[avatar][number]`. A stored name is trimmed
(1–40 characters) with the greeting fingerprint alongside it. A nickname is
shown only while its stored fingerprint matches that greeting; if it changes,
the drawer shows the default label with a review indicator and offers to keep
the nickname on the changed greeting or clear it. Re-picking a greeting rule
does not silently change nickname bindings. `renameBookSettings`,
`copyBookSettings` and `deleteBookSettings` handle the surrounding per-book
settings, including this nested field. Nicknames are UI display state and are
not written into World Info JSON exports.

## Runtime contract

The active runtime character is `ctx().characters[ctx().characterId]` only
when a single-character chat is open and `groupId` is absent. The current
chat character wins over the book's character links. Thus a global book or a
book linked only to Alice can run a Bob greeting rule in Bob's chat.

Greeting refs compile for that active avatar only. For any other avatar, the
ref is omitted from its AND row; a row left with no items, locks or waits is
dropped; and the ref is skipped in `gatedBy`. This applies to entry gates,
close gates, mask gates and mask close gates. The other character's rules
neither block nor close the entry, and do not appear as a current problem.
The stored JSON stays untouched. With no single-character chat, no greeting
refs compile for runtime. A selected character for no-chat editing never
reaches runtime state or marks a greeting fired.

For an active-avatar ref whose `fp` does not match, the condition stays but is
unmet and reported for repair. An absent greeting number or missing character
likewise stays dormant. Nothing searches by fingerprint or silently reattaches
a ref to another greeting. `openingGreeting` uses the first message's
SillyTavern swipe structure, including the no-main-greeting offset; it never
infers the greeting from substring or keyword matching. Only the selected
opening greeting fires at chat index 0, and a swipe before the first reply
changes that state. An unrelated first message with a similar phrase does not
count. An edit to a genuine greeting's message that retains its swipe identity
continues to represent that selected greeting. The structural check follows
ST's `getFirstMessage` and first-message edit behavior.

`src/engine/model.js`, `src/engine/turn.js`, `src/chat-state.js`,
`src/st-hooks.js`, and every reader of greeting state keys work together. The
model signature in `src/st-hooks.js` includes the active avatar and all
greeting fields on which the model depends; a same-length greeting edit
rebuilds it. The editor's `modelOf` cache includes its selected editing
avatar and greeting signature. The caches stay cheap in the generation hot
path.

## Hero selection and UI contract

Selection is separate from runtime:

1. Single-character chat open: that chat's character is used automatically for
   every book, including global and differently linked books. The no-chat
   prompt is not shown. Switching chats switches the displayed character and
   removes the previous character's greeting cards and links from view.
2. No chat open: every book view starts with no greeting cards. A slim
   nonmodal notice, under the canvas's established top controls, reads
   `N linked chars found. Pick one to load its greetings.` `Pick` is a button
   opening an avatar-and-name dropdown at itself; a cross on the right
   dismisses the notice for that view. The list combines primary and auxiliary
   character links, deduplicated by avatar; chat links are not character
   choices. The notice highlights only its text background, stays on one line,
   and does not move the legend or cards.
3. A manual no-chat pick fills the Greetings drawer for editing only; it does
   not place greeting cards. A card appears only when its drawer dot places it
   or a stored rule links it. A small `Greetings: <name> · Change · Hide`
   control sits in the same notice. `Change` opens the same dropdown; `Hide`
   clears the selection. The choice is transient, scoped to the current Hero
   book view. Reopening a book, changing books, opening a chat, or unlinking
   the selected character clears it. It is never saved to settings.
4. No linked characters and no chat: no notice and no greeting cards. Group
   chat: no greeting cards or notice.

The selection uses `library.links(book)` for book-to-character choices. Avatar
fallback images and duplicate display names stay distinguishable via avatar
identity. The notice does not intercept canvas pan/zoom outside itself. It
follows the existing desktop, phone, theme and reduced-motion patterns.

The Hero entry panel's Greetings group is the greeting drawer. Each row has
an adjacent Rename action that opens a compact text input with the current
nickname, Save and Clear. Empty/whitespace-only input clears it; nonempty names
are trimmed and limited to 40 characters. The nickname is primary text and
`Greeting`/`Alt n` is secondary text. That pair is used on canvas cards, the
inspector, target picker, link chips, and Preview starts. The character name
stays visible wherever two characters' rules could be named. The ST card
greeting text is never edited. No nickname is required to create a rule.

The greeting card keeps its shape and only its outward ports. All existing
greeting link operations and the inspector work for the selected
character only. A ref to another avatar remains in the book but is absent
from current canvas links and greeting-specific inspector controls. The
book menu has an `Unavailable greeting rules` sheet for orphaned refs (missing
character or greeting): it lists their stored character/alternate and affected
entries, with an explicit Repoint action. It is a management sheet, not an
active greeting card. Repoint updates every matching ref in the book through
the normal book edit/undo path; changing only a fingerprint is Re-pick.

## Acceptance and verification

Focused tests cover at least:

- No chat: zero fired greetings; Hero notice for 0, 1, and multiple linked
  characters; manual choice fills the drawer without placing cards or changing
  runtime state.
- Global and linked books in Bob's chat: Bob's greeting rules apply even if
  the book is linked only to Alice; Alice's stored rules are invisible and
  inactive. For a mixed AND row, the remaining conditions still work; a row
  of only Alice refs is removed. Repeat for close and mask rows.
- Two books using the same character and alternate with different stored
  fingerprints remain independent; book rename migrates new state keys.
- Main greeting, Alt n, no-main offset, swipe before first reply, deleted or
  structurally unrelated first message, edited greeting message, edited or
  reordered card greeting, and a same-length card edit.
- Unlink/relink preserves rules; exported and reimported book preserves refs;
  missing avatar stays dormant until explicit Repoint.
- Nickname add, edit, clear, changed-text review, duplicate names, book
  rename/copy/delete, and no effect on rule identity or exported book.
- Group chats do not run greeting logic or expose greeting UI; Moment tests
  and ordinary non-greeting rule tests still pass.

Verification covers `npm test`, `git diff --check`, and relevant browser/UI
tests. A live SillyTavern session is used for real chat, alternate swipe,
no-chat picker and unlink behavior where available; otherwise the limitation
is reported. The feature was enabled only after the new greeting tests passed,
not from the old skipped greeting tests.

## Coordinator boundaries

The `activeAvatar`, greeting state-key, nickname-setting and UI selection
interfaces were agreed before agents edited files. Ownership was split as
follows:

1. Engine/runtime: model, turn, rows, chat-state, st-hooks and engine tests.
2. Hero selection/rendering: app, hero panel, canvas, graph, inspector and UI
   tests.
3. Ref editing, nickname settings and unavailable-rule management: pieces,
   links, data, book settings and focused tests.
4. Integration/QA/docs: cross-layer tests, live ST checks where available,
   BUILD_SPEC/CONCEPTS/LAYOUT/VISUAL updates, changelog/version if released.

The coordinator integrated cross-layer interfaces, reviewed every agent diff,
resolved conflicts and verified the full behavior before committing. Agent
work was not committed independently. Implementation is on the `greetings`
branch, never on `main`.
