# Greetings in WI Hero — design

This describes how greetings work in Hero mode. It replaces the retired
greeting behavior in [BUILD_SPEC.md](BUILD_SPEC.md#15-greetings-d23): greetings
are active (`GREETINGS = true` in `src/engine/model.js`), and the engine and
editor use the selection and runtime rules below.

## Which character Hero shows

The greeting cards are an **editing view of one character at a time**, within
the book open on the canvas. A greeting card is not a World Info entry.

- With a single-character chat open, Hero shows that chat's character's
  greetings. This wins over the book's links: a book linked only to Alice still
  shows Bob's greetings when Bob's chat is open. This is the same for global
  books and character-linked books.
- With no chat open, Hero starts with no greeting cards. The Greetings drawer
  is the only source selector. One available linked character is used
  automatically and starts collapsed. With several available linked
  characters and none chosen, its header reads `Greetings · Choose character`
  and opens an avatar-and-name dropdown. With no available linked character,
  there is no Greetings row.
- A manual pick with no chat is for editing only. It fills the Hero entry
  panel's Greetings drawer but does not add greeting cards to the canvas: a
  card appears only when its row dot places it, or when a stored rule links it.
  The pick does not mark a greeting as fired or create chat state. The choice
  belongs to the current Hero view; it does not silently select a character
  the next time the book opens. Choosing manually expands the drawer at once;
  its character-name control opens the same dropdown. Collapsing the drawer is
  the only hide action and does not remove explicitly placed cards.
- The source header remains visible while searching. An expanded source with
  greetings but no matches says `No matching greetings`; one with no usable
  greetings says `<name> has no greetings` and still permits switching when
  several linked characters are available.
- Unlinking or deleting a character removes it from this no-chat picker. The
  rules already written for its greetings stay in the book. Opening that
  character's chat shows its greetings and rules again, even if the book is no
  longer linked to it.
- Group chats get no greeting selection, cards, rules, Preview starts, or
  runtime greeting behavior.

When another character is selected, the previous character's greeting cards,
links, and greeting-specific problems are absent from Hero's canvas and
inspector. Their data remains in the book. The runtime also ignores those
rules in that chat; hiding them in the UI alone would be misleading.

## What a greeting can do

A greeting is a start point. It can be used in an entry's Waits for, Closes
when, and mask conditions. From its card, the user can add Gates for and
Closes for links to entries or packs. Those links are written onto the affected
entries. A greeting itself has no content to inject and takes no gate, close
gate, mask, glue, wait, Once, or Who triggers.

Each stored use identifies the character by avatar key and the greeting by its
main/alternate number, with a fingerprint of the greeting text to detect an
edit or reorder. The book containing the affected entry supplies the book
scope; a separate metadata-only World Info entry is unnecessary. A greeting
with no rules needs no exported record. Existing greeting refs in books should
remain readable.

The fingerprint validates a selected greeting; it is not a search key for
automatically attaching a rule to a similar greeting. If the character is
missing, the numbered greeting no longer exists, or its text has changed, the
rule stays stored but does not fire. Hero offers Re-pick for changed text, and
the book menu's Unavailable greeting rules sheet for a missing character or
number. Export and import preserve the refs; another installation may need a
user to repoint them to a different avatar.

A missing character or numbered greeting is listed in the book menu's
`Unavailable greeting rules` sheet, with the affected entries and a Repoint
action. Repoint rewrites every matching ref in the book through the normal book
edit and undo path. Changed text on a greeting that still exists is a
fingerprint-only change: it is fixed with Re-pick, not Repoint.

## Nicknames

Greeting nicknames ship with this feature. They are labels in WI Hero, never
changes to the character card's greeting text. In Hero's entry-panel drawer,
the Greetings group gives each greeting a Rename action beside its row. It
opens a short text input prefilled with the current nickname, saves a trimmed
name of at most 40 characters, and has a Clear action to restore the default
"Greeting" or "Alt n" label. Empty or whitespace-only input clears it.

The nickname is shown on the drawer row, canvas card, inspector, link chips,
target picker, and Preview. The canonical label ("Greeting" or "Alt n") stays
visible as secondary text wherever the nickname could otherwise obscure which
alternate is meant. Names need not be unique: the character and alternate
number remain the identity. Nicknames do not affect logic, hashes, or chat
state.

Store them under WI Hero's existing per-book extension settings at
`settings.books[book].greetingNames[avatar][number]`, with the greeting
fingerprint alongside the name. A stored nickname is shown only while its
fingerprint still matches the greeting. If that text changes, show the default
label and a review indicator until the user keeps the nickname for the changed
greeting or clears it. A nickname is local display state, like canvas placement;
it does not create a World Info entry, alter greeting refs, or affect logic,
hashes, or chat state. Book rename, duplicate, and delete move, copy, and remove
the nicknames with the other per-book settings. Lorebook JSON export therefore
keeps the rules but not these display-only nicknames.

## Runtime isolation

At the beginning of a single-character chat, only the greeting actually used
for its first message can count as fired. Every loaded book may use that event
in its own entries, whether the book is global, chat-linked, or character-linked.
Only refs for the chat's character participate. Unlinking a character does not
erase a book's rules, and a global book does not need a character link to use
the open chat's greeting.

The opening greeting is recognised structurally, never by matching text:
`chat[0]` must be the character's message, its swipe list must be the
character's greeting list (the main greeting when present, plus every
alternate, with ST's no-main offset), and `swipe_id` must be a valid index. An
edited first message, or a chat whose swipe list predates a card edit or
reorder, keeps its greeting identity. A chat with no swipe list recognises only
a sole main greeting, by its exact text; a similar phrase does not count.
Swiping the opening greeting before the first reply rewinds the dependent state.

An inactive character's greeting ref is treated as unwritten when compiling
that book's rules for the current chat. In an AND row, the other conditions
remain. A row containing only inactive greeting refs disappears; if that
removes every Waits for row, the entry has no Waits for gate. The same filtering
applies to close and mask rows, to `gatedBy`, and to greeting rules aimed at a
pack (`via: '#pack'` on a member). A ref for the selected character whose
fingerprint fails validation is different: it remains a condition that cannot
be met until the user repairs it with Re-pick. A missing character or greeting
number stays dormant the same way; Hero never searches for a similar greeting
or reattaches the ref.

Greeting state keys include the book, the character and the greeting number:
`<book>/@<avatar>:<n>`. Old bare `@<avatar>:<n>` keys are inert. Two loaded
books' refs therefore never share a validation result or state key. Book renames
translate these keys in saved chat snapshots, and book copy and delete handle
their settings and rules as they do the rest of the book. A separate
metadata-only World Info entry is neither needed nor written. Swiping the
opening greeting before the first reply changes the fired greeting and rewinds
dependent state.

## Acceptance stories

1. Open a global book without a chat: no greetings appear. If it is linked to
   Alice alone, the collapsed Greetings drawer uses Alice automatically, but no
   greeting card is placed and none is marked fired.
2. Link that book to Alice and Bob: the drawer offers both with names and
   avatars. Choose Alice and it expands immediately. Open Bob's chat: Bob
   appears automatically, and Alice's greeting
   rules are neither drawn nor applied.
3. Open Bob's chat and a book linked only to Alice: Hero still shows Bob's
   greetings. A rule for Alice on an entry does not gate or close it in Bob's
   chat. A rule for Bob in that book can run.
4. Unlink Alice: her rules remain in an exported copy of the book and disappear
   from the no-chat picker. Opening Alice's chat makes them available again.
5. Edit or reorder Bob's Alt 3: rules pointing to the old Alt 3 stay stored but
   pause. Re-pick attaches them to the greeting the user chooses.

6. Rename Bob's Alt 3 in the Greetings drawer. Its nickname appears on the
   card and in rule pickers, while "Alt 3" remains visible and the character
   card's text is unchanged. Clearing the nickname restores "Alt 3".
