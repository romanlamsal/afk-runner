---
status: accepted
---

# The board is drawn on the alternate screen

ADR-0041 drew the board on the main screen and accepted that a resize "can … push one into scrollback
once". It was not once. A window dragged shorter is a resize for every row, and each one pushed the
window's top line into the operator's scrollback, while the window went on drawing that same line as
its own content. Scrolled to the top of spec #52's board, six rows of dragging left the preflight
note in scrollback six times over, above the window that still showed it. A window narrowed does the
same with every line the terminal rewraps.

**Decision: while a board is showing, it is drawn on the terminal's alternate screen, every frame
from the top-left corner. The lines printed before it stay on the main screen, and the last paint —
at the end, and on an exit before it — goes back there and paints the rest under them, whole.**

- **No resize reaches scrollback**, because the alternate screen has none. Nothing is rewound, so
  nothing depends on how far cursor-up reaches or on what a terminal did to its rows on a resize.
- **The window's content is still everything afk printed in this process** (ADR-0041): the lines
  printed before the board scroll with it, all of them rather than only the ones cursor-up reached.
- **The last paint leaves out the lines printed before the board**, which the main screen has
  already, so every line afk printed is on the main screen once.
- **A kill or a crash** goes back to the main screen and paints there too, from the exit hook that
  used to only show the cursor. A SIGKILL runs no hook, and leaves the terminal on the alternate
  screen until it is reset.
- **The kill's own line goes through the board** as a notice, not to stderr: while the board shows,
  stderr on this terminal is the alternate screen, which the exit leaves and discards. Anything else
  written straight to the terminal while the board shows is lost the same way, which is why every
  line afk says goes through the writer (ADR-0041). That includes children: one spawned with
  `stdio: "inherit"` would draw onto the alternate screen, tear the frames while it runs and be lost
  at the exit, so children keep piped output (`src/infrastructure/process.ts`).

## Considered options

- **Stay on the main screen, and account for what a resize pushed into scrollback.** Rejected. What
  a terminal does to its rows on a resize is its own: xterm.js pulls scrollback back down when it
  grows, Konsole rewraps, and a rule written against one is wrong on the next.
- **Clear the scrollback on a resize.** Rejected. It is the operator's history, not afk's.

## Consequences

- **The writer is tested against a terminal emulator** (`@xterm/headless`, a dev dependency), since
  what reaches the screen and the scrollback is what a terminal made of the output, not the output
  itself. That catches what xterm.js does; a quirk only another terminal has is not caught. The
  tests are in the default suite: the emulator is in-process and deterministic, a stand-in for the
  operator's terminal the way a fake stands in for a port, and no more real for being called an
  integration test.
- **Scrolling moves the screen with every key.** A marker stands on the first or last line of the
  slice and hides that line too, and the top marker hides the rest of a wrapped line along with the
  row it stands on, so the first ↓ from the top is no longer spent on putting the marker there and no
  tail of a wrapped line is left showing under it.
