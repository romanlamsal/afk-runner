---
status: superseded in part by ADR-0042
---

# The board fits the window and takes keys

The writer rewinds over the lines it last drew with cursor-up, and cursor-up clamps at the top row.
A frame taller than the window therefore pushed its top lines into scrollback on every redraw: a
13-ticket spec in a 13-row pane stacked rows #33 and #34 once a second until the pane grew (#66).
ADR-0031's "the block's height is the row count" only holds while the window can fit it.

**Decision: on a terminal, afk's output while a run is showing is one scrolled whole — everything
it printed in this process before the board, the board's rows, its notices, and what it printed
after — drawn in a window one line shorter than the terminal, and the operator scrolls it.** Only
the footer is pinned, as the window's last line. Lines above it that are hidden are announced as
`↑ N more` and `↓ N more`.

- **The first view is the top of the board**, because the rows are worked top to bottom and the
  top is where a run starts. The offset is counted from the top and kept across redraws, re-clamped
  on resize. Nothing follows the tail.
- **Keys**: ↑/↓ move a line, Home/End jump to the first and last line. Keys are taken from the first
  frame, which comes after every prompt's readline is closed, and only where stdin is a terminal.
- **The footer** is `last event <at>`, prefixed `Error - ` once afk reported one while the board was
  showing and `Draining - ` once the operator interrupted, in that fixed order. Both stay.
- **Error lines become notices**: while the board is showing, a line afk would have written to
  stderr goes under the rows beside the drain notice, and to stderr as well only where stderr is not
  the terminal. Two writers to one terminal was already ruled out (ADR-0029).
- **The last paint is whole.** Once the pull request lines are printed the board is drawn once
  more, unclipped and with nothing floating — footer under the rows — and the terminal is given
  back. The last frame is the run's summary, and `run.ts` prints no bucket summary where a board was
  drawn, so a clipped last frame would lose rows nobody can scroll to any more.
- **The viewer quits on its first Ctrl-C.** `--board-only` drains nothing, so a `Draining` footer
  there would be a false statement.

The board now takes input, which ADR-0029 had it never do, and ADR-0031's height claim becomes "the
ticket count, where the window can hold it".

## Considered options

- **log-update.** Rejected. It fits a frame to the height by dropping lines from the top, with no
  offset, no keys and no resize.
- **Ink.** Rejected. A frame taller than the terminal makes it clear the terminal, scrollback
  included, on every frame; it would still need clipping of our own, at 38 packages.
- ~~**The alternate screen.** Not decided here. It is what a later two-pane view would use, and it
  leaves nothing on the main screen unless the final state is replayed onto it.~~ **Decided by
  ADR-0042**: the board is drawn there, and the whole last paint is what goes onto the main screen.
- **Pin the footer and the lines before the board, scroll only the rows.** Rejected. The rows are
  what does not fit, and a pinned header takes the room they need.
- **Start at the bottom, like a terminal.** Rejected. The interesting rows are at the top by
  construction, so every run would begin with a scroll up.

## Consequences

- **Node built-ins only.** Raw mode stops Ctrl-C from raising SIGINT, so the adapter forwards it to
  its own process and the interrupt handling stays as it is (ADR-0016). Raw mode and the hidden
  cursor are undone on exit, a kill and a crash; stdin is released so the process can end.
- **Frames are written without a blank moment**: each line is overwritten and cleared to its end,
  and a frame is wrapped in synchronized output.
- ~~**A window narrowed or shortened mid-run can leave a stale line or push one into scrollback once.**
  Accepted: the redraw after a resize erases down from where it can reach.~~ **Superseded by
  ADR-0042.** It was not once: a window dragged shorter is a resize for every row, and each pushed
  the window's top line into scrollback again.
- **The slicing is pure and sits in the frame**; keys, resize, restore and the terminal's output are
  one cli adapter. Replay draws through the same writer and gets all of it by construction.
