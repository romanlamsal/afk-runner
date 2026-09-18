# cli

The boundary adapter. Holds: argument parsing, flag-combination validation, the confirmation
screen, the operator-facing output, and the exit codes.

It resolves the invocation and calls one thing. It holds no rules about a run.

## The board

What the board says is the domain's (`board.ts`); what it looks like is this layer's, and it is
three pieces with one seam between each (ADR-0031).

- **The frame** (`board-frame.ts`) holds the layout and nothing else: a pure mapping from a view
  and a terminal width to lines of spans. The trail, the ticket number's padding, one block in
  manifest order, the markers at the end of a row, cutting a row too wide for the terminal, and
  the footer under the rows with its own wrapping. It says what each span is to be read at — a
  tone, and a hue where there is an outcome worth one — and never what colour that is, so every
  width it computes is computed on plain text.
- **The colouring** (`board-paint.ts`) holds the palette and no layout: a pure mapping from a line
  of spans to the string the writer writes. It is the last thing that happens to a line, and it
  changes no span's width. Changing a colour is a change here and nowhere else.
- **The writer** (`board-writer.ts`) holds the cursor and nothing else: it rewinds over the lines
  it last drew, writes the coloured ones, and swallows a write that fails, because a terminal that
  went away is not a run that failed. Off a terminal the second adapter of the same port runs, and
  it prints `board-lines.ts` — one line per row the next view changed.

`board-span.ts` is the vocabulary the three share: a span, a tone, a hue, and what a line is worth
in columns.

The tests follow the same seam. Layout rules are asserted against the frame as plain text, with no
escape sequence in any of them; palette rules are asserted against the colouring, with no layout in
any of them; and no rule of the frame is asserted in two places.

See `docs/agents/layers.md`.
