# replay

A developer tool, and not a layer: it replays a finished run's event log as the board that run drew.
Holds: the frames a log is and the wait between two of them, its flag surface, and the entry point
that reads the files and draws.

Nothing in afk imports it. It reads the log, the manifest and the terminal, and writes nothing.

It is possible at all because the board is a pure function of the manifest, the log and the live
action set (ADR-0029) — the first two are on disk, and the third is reconstructed in `frames.ts`,
which is the only thing here that is not simply afk's own code called again.

```
node src/replay/replay-board.ts .afk/37/events.jsonl        # 150ms a frame
node src/replay/replay-board.ts --spec 37 --speed 120       # the run's own pace, two minutes a second
node src/replay/replay-board.ts --spec 37 --lines           # what a CI log saw
```

See `docs/agents/layers.md` for the layers this sits outside of.
