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
