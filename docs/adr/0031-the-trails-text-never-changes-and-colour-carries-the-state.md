---
status: accepted, extended by ADR-0034
---

# The trail's text never changes, and colour carries the state

The board's trail wrote a step differently at every weight it could be read at: `(setup)` ahead,
`<setup>` while it ran, `setup✓` once it settled. The brackets and the outcome glyph were load
bearing, and `board-frame.ts` said twice why: what a step is read at has to survive `NO_COLOR`, so
colour may repeat it and may never be the only thing saying it. Ticket #35 shipped that as an
acceptance criterion, and the board was built with no colour in it at all.

The cost landed on the one thing the board exists for, which is being read at a glance. Every
transition rewrote the step's text and changed its width, so every column to its right moved:

```
#28  rebase✓ (resolve) merge✓ gate✓ (fix) (revert)
```

`(resolve)` is nine characters, `<resolve>` is nine, `resolve✓` is eight. Nothing on that row holds
still, so the eye never learns where a column is and re-reads the whole line each frame.

**Decision: every row carries the same step names in the same columns for the whole run, and the
state is carried by colour.**

The trail is `setup implement rebase resolve merge gate fix revert`, identical on every row and in
every frame. A step's place in the run is a tone, and an outcome worth noticing is a hue:

> **The table below is superseded by ADR-0033.** The tone ladder was the part of this decision that
> failed: on a real terminal SGR 2 can go unrendered and SGR 1 selects the scheme's intense
> foreground rather than a weight, so two of its three levels did not read. State is now carried by
> hue and underline, and the palette lives only in `board-paint.ts`. Everything else here stands.

| meaning | treatment |
| --- | --- |
| step still ahead | dim |
| step settled | normal |
| step started and not ended | bright |
| settled conflicted | amber |
| settled failed | red |
| ticket verified | the ticket number goes green |

Three tones for three step states, which is what ADR-0030 left after it collapsed `live` and
`interrupted` into `running`. The ladder is the terminal's own dim, normal and bright rather than
blended colour, because blending has to assume a background and inverts on a light theme.

**The board now needs a colour terminal.** That is the reversal, and it is the whole price: with
colour off, every row reads as the same eight words. `board-frame.ts`'s two comments and #35's
criterion are wrong from here, and the board no longer consults `NO_COLOR`.

## What the fixed trail pays for

**One block, and no track headings.** A row spans every step rather than its current track's, so a
ticket reaching the merge track changes its colours and not its shape. The row set is the
manifest's, so the height is the ticket count.

**No titles.** A fixed trail is 52 columns and the ticket number takes five more, which left 21
columns for an issue title on an 80-column terminal — enough for `refactor: one cl...` and nothing
else. The number identifies the ticket and the title was never read, so it goes. A row is 59
columns, and nothing truncates at any width worth having.

**Colour is applied after layout, never inside it.** The frame does its padding and truncation on
plain text and hands out spans, which are coloured last. Escape sequences are characters to
`padEnd` and to a length check, so colour inside the layout would pad every coloured row crooked —
and a test asserting the finished string would not catch it, because the expected string is wrong
in exactly the same way. `layers.md` declines this question outright, in its closing list of what
it does not cover; the arithmetic decides it instead.

## Considered options

- **Keep the text encoding and add colour on top of it.** Rejected. Colour over moving columns does
  not stop them moving, and the reflow is the complaint.
- **Pad every weight to one width, so `(setup)`, `<setup>` and `setup✓` all occupy the same
  columns.** Rejected, and it is the serious alternative: it holds the columns still *and* keeps a
  colourless board readable, which is everything this decision gives up. It was turned down because
  the text still changes on every transition. A row that does not move but reads differently each
  time still has to be re-read, and re-reading is the cost being removed.
- **Abbreviate the step names to fixed-width tokens.** Rejected. It buys width that is only short
  because of the title, and the title is gone. Eight four-letter codes are a puzzle where eight
  words are not.
- **Blend colours against the background for exact transparency ratios.** Rejected. A terminal does
  not reliably report its background, so the ratios are guesses and a light theme inverts them. The
  dim, normal and bright ladder is three levels, which is exactly three states.

## Consequences

- **The board is unreadable with colour disabled**, and afk accepts that rather than working around
  it. Off a terminal there is no board at all: `boardLines` prints a line per change and names its
  ticket, step and outcome in words, and it is untouched by this.
- **`board-frame.ts` stops returning joined strings.** It returns each line as spans carrying text,
  tone and hue, and a colouring step turns spans into what the writer writes. The layout stays
  assertable as plain text and colour gets a suite of its own.
- **Most of the frame's assertions are rewritten.** They encode the bracket and glyph scheme this
  removes, which is the point of having had them.
- **The trail's width is constant**, so `waiting` and `dead` sit at the end of a row with nothing
  after them to push around. ADR-0030 already took `beyond repair` off the board.
- **The outcome glyphs go.** `OUTCOMES` in the frame existed so a green step and a red one differed
  without colour, and hue says it now.

## Extension: colour may carry liveness

The decision above gave colour one job: the state a step is in. It is extended so that colour may
also carry **liveness** — whether a running step has written anything recently — and it does so on
the same terms: the trail's words still never change, and what colour says is a role the frame
hands out and the palette alone treats (ADR-0033).

What does change is the row's end. A row with a running step ends in how long that step has been
going (ADR-0034). That figure is text, because a number is read rather than glanced at, and it sits
after `waiting` and `dead` so that nothing to its left moves as it counts. A figure that counts up
cannot say whether the step behind it is alive — a killed step counts like a working one — and that
is what colour is for.

A running step that has gone quiet takes the `quiet` role: still underlined, because it is still
the live edge of the run, and amber, because silence is a warning rather than a failure. The step's
name and its elapsed figure both take it. A step still writing keeps `running`, and its figure stays
plain.

A step a run nothing holds any more left open takes the `interrupted` role: amber, because it did
not go clean and nothing broke, and *not* underlined, because it is not the live edge — nothing is.
It is what `quiet` is a suspicion of, and the underline is the whole of the difference between
wondering whether a step is still going and reading that it is not. The row's words are unchanged
again, and the row ends in no figure at all: an interrupted step is not counting towards anything.
