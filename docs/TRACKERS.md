# WI Hero — Trackers

Design spec for text the model writes into the book. **Built in 0.37.0**;
section 9 records how its open questions were settled.
It follows the rules in [CONCEPTS.md](CONCEPTS.md) and the turn in
[BUILD_SPEC.md](BUILD_SPEC.md) 6; where this file needs a change to either, it
says so. Grown out of "Masks the model writes" in [AFTER_V1.md](AFTER_V1.md)
and the discussion of 2026-11-09.

## 1. What it is

- Any **text slot** of an entry, its main content or one of its masks, can be
  marked **written by the model**. The text in that slot then comes from the
  chat: WI Hero reads each new reply for the slot's line and keeps the newest
  value it finds.
- An entry with a written slot is a **tracker**. It is still an entry in every
  other way: keywords, glue, gates, close gates, packs, Once and Who triggers
  all work as they do today. Only where its text comes from is different.
- The value is **free-form text**. "120", "12 gold and a ruby", or a whole
  configuration block. WI Hero never does maths on it; the model does, and
  WI Hero copies the result (CONCEPTS 9 stays true).
- There are **no prebaked trackers**. No gold tracker, no clothes tracker. The
  user decides what is tracked and in what syntax, and WI Hero's job is to
  make that syntax easy to design well (section 5).

### 1.1 Two examples

**Gold.** Entry *Gold*, glued on hold. Its main is written, label `Gold`, start
value `10`. The model ends its replies with `[Gold: 7]`; from the next message
on, the entry injects `7`.

**A temporary configuration** (the case that started this). Entry *Ship
config*. Its main is the standard configuration, written by hand, as today.
One mask, *Custom*, is written: an AI character turns the player's words into
a configuration block in its own format. While *Custom* holds a value, the
entry injects it. When the event is over, the character writes an empty block,
*Custom* is cleared and the entry falls back to the standard configuration.
The model never has to remember what the standard was.

## 2. Rules

### 2.1 Reading

- A slot reads **the newest reply** when it lands (BUILD_SPEC 6.6), and the
  **greeting** the chat opens with (3.12). A greeting that carries a line seeds
  that chat's starting value, so each alternate greeting can start with
  different values.
- It reads the user's messages too only if its Who triggers allows it
  (`by`, CONCEPTS 3.8). Default for a written slot: `"char"`.
- **The last match in the message wins.** Labels match without regard to case
  or extra spaces.
- **A reply without a line keeps the last value.** Presets that print a
  tracker only when something changes work without extra setup.
- **An empty value clears the slot** (`[Gold: ]`, `<config></config>`).
- **Timing follows locks** (CONCEPTS 2.1): a value written in a reply is used
  from the next generation. A value in the user's message (when allowed) is
  used in the reply to that same message.
- **A slot reads only while its entry is open**: not waiting on a gate, not
  closed, not switched off. Lines meant for a closed tracker are ignored. This
  one rule gives scoping for free: a tracker in a pack reads only while that
  pack's gates let it, and a tracker gated on a greeting reads only in chats
  that opened with it.

### 2.2 Which text is injected

- **Written main:** the value if there is one, else the entry's own content
  in the book, which acts as the **start value**.
- **Written mask:** the mask rules stay (CONCEPTS 3.7), with one change. A
  written mask is **on while it holds a value**, as long as its own gate (if
  it has one) is open and it isn't closed. A written mask with no gate is
  therefore on whenever the model has written it, not only when picked by
  hand. Cleared or never written, it is off, and the next mask or main shows.
- So a written mask switches **both ways, as often as the story needs**:
  writing turns it on, an empty write turns it off. Its close gate is still
  "closed for good", as for every mask.
- Like mask text, written text doesn't drive recursion; the book's own content
  does.

### 2.3 By hand

- `/wihero-set entry=<id> [mask=<name>] <text>` sets a slot's value;
  without text it clears it. Written onto the latest message, like the other
  manual actions (BUILD_SPEC 7), so it rewinds.
- The entry's inspector shows the current value in this chat, with Edit and
  Clear buttons that run the same action.

### 2.4 Rewind

- Values are story state (CONCEPTS 2.3): saved per message and per swipe.
  Swiping, regenerating, deleting or branching rewinds them with everything
  else. A **continue** reads the whole message again.
- Editing the **latest** reply reads it again. Editing an older message
  changes nothing; `/wihero-set` is the way to fix an old value.
- Summarising or hiding old messages changes nothing either: the value belongs
  to the story, not to the text on screen.

## 3. Teaching the model

Two modes, chosen per book.

### 3.1 Bring your own

The user's preset or character card already tells the model what to write
(Megumin Suite's `{{user}}.Carrying: …`, Nemo Engine's Regex trackers, a
card's own config format). WI Hero **only reads**: it sends nothing and
changes nothing in the prompt.

### 3.2 WI Hero teaches it

For plain presets. WI Hero injects **one short instruction** through ST's
extension prompt (`setExtensionPrompt`), the way Author's Note and Summarize
add theirs, as a system message at a chosen depth (default 1). It is not part
of the preset and not an entry.

- Built from the book's syntax and the slots that are open right now: each
  slot's label, the user's one-line description of it ("coins the player
  carries"), and, for one-line slots, the current value.
- Sent only when at least one written slot is open; nothing otherwise.
- Sent only for replies that land in the chat (a send, swipe, regenerate or
  continue): a quiet generation (`/gen`, another extension's summary or image
  prompt) or an impersonation gets none, so tracker lines don't end up in it.
- The builder (5) shows the exact text that will be sent.

This is the one thing WI Hero adds to the prompt, so CONCEPTS 1 ("Nothing WI
Hero adds is sent to the model") gains an exception, opt-in per book.

### 3.3 Keeping old lines out of the prompt

In WI Hero's own mode, the tracker lines in older messages are stripped from
the prompt before it is sent: the model reads each current value once, from the
entry, and not a hundred stale copies. In bring-your-own mode the preset
manages its own lines and WI Hero leaves them alone.

## 4. Showing it in the chat

- **Per slot: Show in chat** on or off. A configuration the player should see
  stays visible; a clothes tracker can be hidden. Hiding is display only; the
  line stays in the message and is still read.
- The chat bubble (BUILD_SPEC 17.3) lists what each reply wrote
  ("Gold → 7", "Custom config written").
- On the canvas and in Preview, a tracker's card shows its current value in the
  open chat.

## 5. The syntax builder

The syntax is the feature. Every book picks its own, and WI Hero steers it
towards something a model can keep up for hundreds of replies.

- **One syntax per book**, with `{label}` and `{value}` in it. Each slot's label
  defaults to its entry's name (and mask's, `Ship config · Custom`), so two
  characters' inventories are just two entries, *Anna · Inventory* and *Bob ·
  Inventory*, and the model writes `[Anna · Inventory: …]` with no mix-up.
- **Two shapes only:**
  - **Line**: `[{label}: {value}]`. The value runs to the closing mark, on one
    line. The closing mark may repeat the label, `<{label}>{value}</{label}>`,
    and then it must be the same label.
  - **Block**: `<{label}>` … `</{label}>`. The value can span lines, for
    configurations and lists.
  A slot picks its shape; the book's templates for both are set once.
- **Live test**: the builder runs the syntax over the open chat's last few
  replies and shows, slot by slot, what it would have caught.
- **Warnings** for the usual mistakes: two labels that are too alike, a label
  that is a prefix of another, a closing mark that can appear inside values, a
  block that was opened and never closed in the test replies, a line slot whose
  test values span lines.
- **Examples, not presets**: a few starting syntaxes to pick from (square
  brackets, an HTML comment `<!-- label=value -->`, a `<state>` block). Picking
  one only fills in the templates.
- **Advice in the builder**, short: keep labels short and distinct, ask for the
  lines at the very end of the reply, use a block only when the value really
  needs several lines, write one fact per label.

## 6. Problems and warnings

Added to CONCEPTS 5.

- Problem: two written slots in one book with the same label (neither reads).
- Problem: a syntax that can't be compiled (no `{value}`, or no `{label}`
  when more than one slot is written).
- Problem: a written slot on a Moment (it has no text).
- Warning: a written main on an entry that can never fire (it reads, but
  nothing is injected).
- Warning: own mode on, but a slot has no description (the model is told the
  label only).

## 7. Storage

- **On the entry**, in `extensions.wihero` (CONCEPTS 8), so trackers travel
  with export, cards and import:
  - `written: { label?, shape: "line"|"block", describe?, show: true, labelled: true }`
    for a written main;
  - the same object as `written` on a mask in `masks`;
  - the book's syntax and mode, copied onto every written slot as
    `written.syntax` and `written.teach`, since a book has no field of its own
    that survives ST's import. The builder edits them all at once.
- **In the story state** (BUILD_SPEC 4): the message where a value was read
  keeps the text, `wrote: { "<book>/<id>": "7", "<book>/<id>|m:Custom": "…" }`.
  Every later snapshot keeps only where to find it,
  `written: { "<book>/<id>": 14 }`, so a long configuration is stored once, not
  copied onto every message.
- **Per slot settings** (show in chat, description) live on the slot, in the
  book.

## 8. Not now

- A macro, `{{wihero::label}}`, to quote a value inside any other text
  (another entry, Author's Note). Cheap with ST's macro parser, and it would
  let one value appear in several places.
- Gating on a value ("open *Rich* when Gold is at least 100"). Needs
  comparisons, which CONCEPTS 9 keeps out for now.
- "When *X* is written" as an item in other entries' gate rows.
- Clearing on a phrase ("reset when the storm ends"), on top of an empty write.
- Readers made for specific presets. Presets change often (Nemo Engine is on
  v12); a template the user writes ages better.
- Anything that needs a separate model call. WI Hero never makes one.

## 9. Decisions (were open questions)

Settled with the user on 2026-11-10.

- **Show in chat** hides lines with WI Hero's own render hook (the message is
  rendered again without them), not with a regex script written into ST's
  list. It touches nothing outside the book; the lines show again while WI Hero
  is off.
- **Stripping old lines** uses ST's generate interceptor
  (`generate_interceptor` in the manifest, script.js `runGenerationInterceptors`),
  which runs for both chat and text completion before the prompt is built. Its
  list holds the chat's own message objects, so changed ones are replaced by
  copies, never edited. A continue keeps the message it continues.
- **Instruction depth** is a per-book setting in the builder, default 1 (it
  travels with the book's syntax as `written.teach.depth`). With several
  teaching books, the shallowest depth is used for the one instruction.
- **Labels a preset varies** (Nemo's model-chosen labels): left out.
- **Normal mode** shows written values too: the entry page has the value with
  Edit and Clear, above the text (which is the start value).

Built details not spelled out above:

- The Tracker piece (inspector, "Tracker") switches each slot on or off and
  sets its label, shape, description and Show in chat; "Syntax and teaching…"
  opens the builder.
- A tracker that reads the user's messages is one whose entry has Who triggers
  "only you" (`by: "user"`); otherwise only replies are read.
- `/wihero-set` and the Edit and Clear buttons store the value on the latest
  message's snapshot (`wrote`), like the other manual actions.
- **Send with its label** (`written.labelled`, on by default, added 2026-11-10):
  the value is sent in the book's own form, `[Gold: 12]`, not bare, and so is a
  written main's start value (its own text). Off sends the bare value and leaves
  the book text alone until a value is written. Found playing real chats: a bare
  "10" in World Info means nothing to the model.
- For several coins, one tracker rewritten whole (`[Purse: 12g 5s 30c]`, the
  format in its description) beats three that the model must keep in sync;
  split them only when they are independent. Partial updates inside one
  tracker stay out (CONCEPTS 9).
- The instruction asks for the trackers whose value changed, at the very end of
  the reply, and lists each slot's form, its description and (for one-line
  slots) the current value.

## 10. Background: what big presets print

Read from their source on 2026-11-09, to check that bring-your-own is real.

- **Nemo Engine v12.3**: trackers are optional modules with three render
  modes. The default is HTML/CSS the model designs itself, which changes every
  reply and can't be read reliably. Its Regex mode can be read
  (`<st-row k="Gold" v="120"/>`), but the model picks the labels and prints a
  tracker only when something changes. A strict "Final Output Manifest" orders
  everything at the end of a reply, so an injected instruction has to fit in
  with it, not compete.
- **Megumin Suite V11**: structured lines such as
  `{{user}}.Carrying: sword, 12 gold`, `Time:` and `Loc:`. By default the model
  writes only what changed and the extension holds the full state. It can also
  hand tracking to a second model, in which case the main reply may not carry
  the block at all (not checked).
- **Freaky Frankenstein**: only on MediaFire links from Reddit, not read.
- Megumin already stores state the way this spec does: changes journaled per
  message and swipe in `chat_metadata`, old blocks stripped from the history
  and the current values fed back once. Good evidence that per-message story
  state is the right home for the value.
- Still to test: a heavy preset plus WI Hero's instruction, to see whether the
  model writes two blocks or garbles one.
