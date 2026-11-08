# Desktop layout: handoff brief

For the thread that builds it. The design is done and lives in
[docs/LAYOUT.md](../docs/LAYOUT.md) ("Desktop: normal mode", "Desktop: Hero
mode") and [docs/VISUAL.md](../docs/VISUAL.md) 7.6. Those docs are the spec;
this page is only the way in.

## What to build

A desktop version of both modes, used where ST uses its desktop layout (window
wider than 1000px). Phones and narrow windows keep today's UI unchanged.

- **Normal mode** sits exactly where ST's own World Info drawer sits: under the
  top bar, `--sheldWidth` wide (ST's Chat width, min 450px), above the send
  form. Today `:host` in `src/ui/app.css` is full width; desktop narrows it to
  that box. Below 640px of drawer width the entry list becomes an overlay.
- **Hero mode** opens widened (full window under the top bar) with a button to
  shrink it to the drawer box; remembered.
- **Mouse first** in both: hover reveals, right-click menus, menus at the
  control instead of bottom sheets, Ctrl/Shift-click selection instead of a
  selection mode, no bottom bar, keys listed in LAYOUT.

## Build order

1. **Shell**: desktop detection (ST's own 1000px breakpoint, re-checked on
   resize), drawer geometry, the 40px tab row, menus-as-popovers (one popover
   component the sheets can switch to on desktop), Esc order.
2. **Normal mode**: Home (tiles default, list, selection bar, drag to folder),
   the two-pane book (resizable list, book header, filter, rows, keyboard),
   entry tabs, the entry page's desktop changes (breadcrumb, ∧ ∨, keyword
   typing, parameter grid), bulk pane, Book settings pane, search overlay.
3. **Hero mode**: three columns (docked entry list, canvas with piece bar,
   docked inspector, both side columns resizable), book picker in the tab row,
   widen/drawer toggle, mouse on the canvas (drag cards, pan, Shift box select,
   wheel zoom, hover dim after 350ms, right-click menus), link by dragging from
   a port or hover handle, piece keys, inspector Story logic / Text tabs,
   Preview as a two-column tab.
4. **Left-to-right Tidy** (see below), then e2e coverage.

## The risky part: layout direction

`src/ui/canvas-graph.js` `layout()` is top to bottom, wrapping layers wider
than `ROW_W` (two cards) for phones. Desktop needs a left-to-right variant:
layers become columns, ordered by source position (barycenter), centered on the
tallest column, with a pack's unlinked members kept in a linked member's column
(VISUAL 7.6). `computePorts()` must then pick sides from the cards' relative
position: side by side uses right/left, stacked uses bottom/top, lone locks and
waits go on top; saved manual port sides still win. `route()` (the grid router)
is direction-agnostic and should not need changes. Keep it pure and add
`node --test` cases next to `test/canvas.test.js` for both directions.

Decide in code review whether a book remembers its canvas positions per
direction or re-tidies when switching between phone and desktop; the docs
leave the phone layout as is.

## What the demos fake

[normal-mode-demo.html](normal-mode-demo.html) and
[hero-mode-demo.html](hero-mode-demo.html) are click-through mockups, not code
to lift:

- The SillyTavern screen around them, and the "Demo controls" chat-width slider.
- Every toast that names a feature instead of doing it (Snapshots, Export,
  Move to another book, Hero mode switch, World Info settings, most strip
  settings for Mask, Pack, Lock, Wait and Switch).
- Data, story logic sentences and the Preview report are hard-coded.
- Links are simple elbows; the real router's lanes apply (VISUAL 7.3).
- No persistence: sizes, view choice and tabs reset on reload. The real build
  remembers column widths, Home view and the widen state.

## Checks before calling it done

- `npm test` green, plus new tests for the left-to-right layout and port sides.
- An e2e run per mode at 1920×1080 (drawer 960px) and 1366×768 (683px), plus
  one below 640px drawer width and one phone-size run showing nothing changed.
- Light theme pass, since desktop shows more surfaces at once.
