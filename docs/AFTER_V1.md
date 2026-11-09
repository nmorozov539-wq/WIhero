# WI Hero: ideas kept out of V1

Big ideas we agreed are worth doing, but not in V1. Each has a short note on why it waits.

## Locks that match by meaning

**The idea:** a lock option, "match by meaning". The lock opens when a message says something close to the phrase, not only the exact words. It would use ST's vector service, the same way vectorized entries work.

**Why it waits:**
- The lock check would have to wait on the embedding service.
- It needs a similarity threshold that someone has to tune.
- The result must be saved in the chat state, so swipes give the same answer.
- Preview couldn't predict it without calling the embedding service.

## Curved links

**The idea:** a "Link style" setting in ⌄, with straight or curved lines. The cheap version smooths the route the grid router already finds, so lines still go around cards.

**Why it waits:** it's visual polish, and the lines are readable as they are.

## Ship the editor and Hero mode separately

**The idea:** split the product for shipping: the normal editor as one, Hero mode as another, each on its own track.

**Why it waits:** only marked for now, not worked out yet.

## Configurable behavior

**The idea:** a Behavior section in ⌄ for how actions work, not how things look. The first setting: explain mode ends after one tap (the default) or stays on until you cancel it. Other candidates that already behave one fixed way: whether the mode switch asks for a second tap, and whether opening from the list uses this tab or a new one.

**Why it waits:** each setting doubles the cases to test, and the defaults should prove themselves first.

## Explain mode in Normal mode, for ST's settings

**The idea:** the same "?" and explain mode in Normal mode, explaining ST's own entry settings (Sticky, Cooldown, Scan depth, the character filter and the rest) with a Guide page each. That's where newcomers need it most.

**Why it waits:** the Guide's piece pages come first; ST's settings need their own pages, written against ST's behavior.

## Masks the model writes (state tracking)

**The idea** (the owner's, 2026-11-08): let the model keep track of things like gold, without a separate call. The user sets up a pattern, for example a line the model ends each reply with: `**gold in pockets = 10**`. WI Hero watches the chat for that pattern and writes what it finds into a chosen mask, creating it or replacing its text. From then on the mask carries the current value into every prompt.

- **Why it's worth it:** it tracks anything the user cares about (money, wounds, time of day, a relationship score), in any format they like, and needs almost no new machinery: masks already swap text in (CONCEPTS 3.7). People build complicated outside systems for this today.
- **Why it beats keeping it in the chat:** a summarizer that rewrites or drops old messages would lose a running total. A value held by WI Hero survives that.
- **What can go wrong:** only the model failing the math or the syntax. Modern models should manage a gold exchange even deep into a long context.

**Why it waits:** it's a design job, because it reaches into two places WI Hero doesn't touch today.

- **The chat:** a hook that reads each new reply for the user's patterns. Probably the same moment the story state is written (`MESSAGE_RECEIVED`, BUILD_SPEC 6.6).
- **The prompt:** the model has to be told the syntax, and the instruction is different for every build a user makes. One option that avoids touching the preset: the instruction rides in an always-on (glued) entry of the same book, so it travels with the book.

Questions to settle when it's designed:

- **Where the value lives.** Mask text is stored in the book (D16), but the book doesn't rewind. A value written there would survive a swipe or a deleted message that should have undone it. Keeping the value in the chat's story state, per message, would make it rewind with everything else (CONCEPTS 2.3), and the mask would only show it.
- **What the user sees.** Whether the tracking line stays visible in the chat, or is hidden from display (for example with an ST regex script) while still being read.
- **When the model gets it wrong.** A missing or garbled line could keep the last value, and Preview or the chat bubble could show what was read from each reply.
- **Scope.** CONCEPTS 9 keeps variables and math out of story logic. This doesn't change that: the model does the math, and WI Hero only copies the result. Gating on the value (opening an entry when gold reaches 100) would be a separate, bigger step.
