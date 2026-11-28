# Prompt for OpenCode

Implement WI Hero's greeting system in this repository. You are the
coordinator. Launch subagents for each major task, agree on their shared
interfaces and file ownership first, and review every subagent's changes
before any commit. Subagents must not commit. You make the commits after
review and verification.

Work on a **new branch from `main`**, named `greetings` or another
unused `greetings-*` name. Never implement or commit this feature on
`main`. The handoff docs may be present as uncommitted workspace changes;
carry them onto the new branch and include them in your reviewed commit.
Leave unrelated untracked files alone.

Read these files in order:

1. `docs/GREETINGS_DESIGN.md` — product decisions and acceptance stories.
2. `docs/GREETINGS_IMPLEMENTATION.md` — storage, runtime, UI, tests, and
   subagent boundaries. Treat its concrete behavior as the implementation
   contract.
3. Existing greeting sections in `docs/BUILD_SPEC.md`, `docs/CONCEPTS.md`,
   `docs/LAYOUT.md`, and `docs/VISUAL.md`, plus the current source and tests.
   Those old sections are historical where they conflict with the two new
   handoff docs.

Nonnegotiable outcomes:

- Hero shows the open single-character chat's greetings for any book,
  including global books and books linked only to another character. Other
  characters' stored greeting rules are hidden and inactive in that chat.
- With no chat, Hero starts with no greetings. A nonmodal canvas prompt offers
  linked characters for editing: one direct choice or a name-and-avatar
  picker for several. Manual choice never fires a greeting.
- Unlinking removes a character from the no-chat picker but preserves every
  rule in the book. Group chats receive no greeting feature behavior.
- Greeting logic remains stored on affected entries, with book-scoped runtime
  state. Preserve old exported refs; do not add hidden metadata entries.
- Greeting nicknames ship now. Rename/Clear lives beside each greeting in the
  Hero entry-panel Greetings drawer. Nicknames are per-book display settings,
  not character-card edits or rule identity.
- Moments remain unchanged.

Do not simply flip `GREETINGS` to `true`. First implement character isolation,
book-scoped keys, editor selection, and the required tests. Then enable it
and run the full suite. Verify the interface on desktop and phone using the
available harness; test against live SillyTavern if it is running, and state
clearly if it is not. Follow the repository's version and changelog practice
if this work is prepared as a release.

Before committing, inspect the combined diff for unrelated changes and
review the runtime semantics, stale-cache handling, accessibility, layout,
undo/save behavior, and export/import compatibility. Run `npm test` and
`git diff --check`; run focused browser tests. Commit only after your own
review, with a message describing the feature. Report the branch, commit(s),
tests, and any remaining live-ST verification gap. Do not push or merge unless
I ask for it separately.
