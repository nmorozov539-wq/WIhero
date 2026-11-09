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
