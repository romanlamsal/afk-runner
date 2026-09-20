# replay

A developer tool, and not a layer: it replays a finished run's event log as the board that run drew.
Holds: the moments a log is — a prefix of it and where the replayed clock stands — its flag surface,
where a run's own records are, and the entry point that reads the files and draws.

Nothing in afk imports it. It reads the log, the manifest and the terminal, and writes nothing.

It is possible at all because the board is a pure function of the run directory and an instant
(ADR-0034): the manifest, the log, and the transcripts and command logs a row's colour comes from
are all on disk, and the instant is the only thing a finished run cannot hand over. So `frames.ts`
reconstructs it — the replayed clock, standing at each line's own instant and advancing across the
gaps between them at the speed factor, which is the live board's tick replayed. A replayed row shows
the elapsed figure and the colour the live row showed. A replay pacing itself (`--interval`) has no
speed factor and so no gap to tick through: its clock moves with the log and nowhere else.

A log outside a run directory, or a run whose records have been deleted, still replays: the rows
carry their numbers and their figures, and claim no silence they cannot see.

```
node src/replay/replay-board.ts .afk/37/events.jsonl        # 150ms a frame
node src/replay/replay-board.ts --spec 37 --speed 120       # the run's own pace, two minutes a second
node src/replay/replay-board.ts --spec 37 --lines           # what a CI log saw
```

See `docs/agents/layers.md` for the layers this sits outside of.
