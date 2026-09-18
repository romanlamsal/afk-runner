---
status: accepted
---

# State is carried by hue and underline, never by intensity

ADR-0031 made the trail's text fixed and put the state into colour, as the terminal's own dim,
normal and bright ladder — "three levels for the three places a step can be in a run". That ladder
does not exist. On Konsole's default scheme SGR 2 renders identically to normal, and SGR 1 is not a
weight at all: it selects the scheme's intense foreground, which in Breeze is blue. Two of the three
levels were an invisible one and a hue nobody picked, so every step of a ticket read the same.

It was never a bug in the board. `painted` emitted exactly what ADR-0031 asked for. The ladder was
the mistake, and it is not a mistake a colour scheme can be blamed for: SGR 1 and 2 are terminal
suggestions, and a board whose readability depends on which scheme the operator chose is a board
that does not work.

**Decision: a span carries a role, the colouring alone turns a role into a treatment, and no role
ever asks for an intensity.**

`Tone` and `Hue` are gone. The frame says a step has not been reached; what that looks like is
`board-paint.ts`'s, which is the one file the palette lives in — ADR-0031 already claimed this and
did not have it, because `toneOf` and the outcome-to-hue table sat in the frame.

Three things replace the ladder:

- **A step still ahead is bright black.** A colour, so it is drawn rather than suggested, but a
  neutral one, so it recedes on a dark terminal and on a light one alike.
- **A step the log started and has not ended is underlined.** Not a hue, so the live edge of the run
  stays orthogonal to what a step comes to: a step can be running now and red later without the two
  contending for one channel. Unlike bold, underline has no intense-colour backdoor for a scheme to
  reach through.
- **A step that simply worked is plain**, as it was. It is the background the rest is read against.

**The ticket number carries the run's verdict**, and that is the second half of the fix. ADR-0031
gave green to a verified ticket alone; a failed one now goes red and a skipped one amber, and the
`dead` marker at the end of its trail matches. The number column is the one a glance goes to, so it
answers in every direction: green landed, red broke, amber never got its chance, plain still going.
A screen of numbers is the run's tally, and a trail is only read when one of them is odd.

**Amber has one meaning and not two.** A conflicted step and a skipped ticket are both amber because
both say the same thing: it did not go clean, and nothing here broke. A conflict is a state git drew
rather than a failure, and a skip is a blocker's failure rather than this ticket's. Red is kept for
the thing that actually broke, which is what makes it findable.

## Considered options

- **Tell the operator to fix their colour scheme.** Rejected. It is a real fix for one machine and
  no fix at all for the decision, and the next scheme breaks it again.
- **Cyan for the running step** instead of underline. It was free — the board's only hues are amber,
  red and green, and nothing else in the codebase writes an escape sequence. Rejected for keeping
  the live edge on a channel of its own, so that a step's progress and a step's outcome never
  compete; the hue remains the fallback if underline proves unreadable somewhere.
- **256-colour or truecolor, so the board picks exact shades.** Rejected, and for ADR-0031's own
  reason: exact shades have to assume a background, a terminal does not reliably report one, and a
  light theme inverts the guess. Named hues delegate that to the scheme, which is what they are for.
- **Reinstate a fixed-width outcome marker, so the board survives with no colour.** Rejected. It is
  what ADR-0031 removed and its reasoning stands: the text still changes on transition, and
  re-reading a row is the cost that decision bought out.

## Consequences

- **The palette is not restated anywhere but `board-paint.ts`.** ADR-0031's table went stale because
  it was written down twice, so this decision records the constraint and the principle and leaves
  the role-to-code mapping in the one file that holds it.
- **A settled skipped step is amber too**, where it used to be untreated. It follows from amber's
  meaning rather than being a separate choice: a step's role is simply what it settled on.
- **`replay` is how the palette is checked.** `node src/replay/replay-board.ts --spec 26` draws a log
  carrying every role there is — conflicted, failed, skipped, ok, running, ahead and verified — so
  no probe of its own was added. No unit test can see what a terminal does with a code; what the
  suite guards instead is that no role ever asks for SGR 1 or 2.
- **ADR-0031's treatment table is superseded by this one.** Its fixed trail, its one block and its
  colour-after-layout rule are untouched.
