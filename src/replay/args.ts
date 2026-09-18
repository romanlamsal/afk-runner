import { cli } from "cleye"

/**
 * What the replay was asked for. A developer tool's flag surface rather than afk's own, so it is
 * allowed to be a thinner thing than `cli/args.ts`: cleye's own refusal is good enough for a value
 * that cannot be a number, because nothing here is a run and nothing here has an exit code anybody
 * reads.
 */
export type ReplayArgs = {
    /** The log to replay. Absent where `--spec` names it instead. */
    events: string | undefined
    /** A spec of this repository, which is a log and a manifest without naming either path. */
    spec: number | undefined
    manifest: string | undefined
    /** The wait between frames, where the log's own clock is not what paces it. */
    interval: number
    /** Divides the gaps the run actually had. Present is what makes the log's clock the pacer. */
    speed: number | undefined
    /** The width to fit frames to, for replaying a wide run's board into a narrow one. */
    width: number | undefined
    /** Draw the line board on a terminal too: what a pipe or a CI log would have seen. */
    lines: boolean
}

export const USAGE =
    "afk-replay [<events.jsonl>] [--spec <n>] [--manifest <path>] [--interval <ms>] [--speed <factor>] [--lines] [--width <n>]"

export const parseReplayArgs = (argv: string[]): ReplayArgs => {
    const parsed = cli(
        {
            name: "afk-replay",
            parameters: ["[events]"],
            flags: {
                spec: {
                    type: Number,
                    description: "Replay this spec's log from the current repository, instead of a path",
                    placeholder: "<n>",
                },
                manifest: {
                    type: String,
                    description: "The manifest to read ticket titles from (default: beside the log)",
                    placeholder: "<path>",
                },
                interval: {
                    type: Number,
                    description: "Milliseconds between frames",
                    placeholder: "<ms>",
                    default: 150,
                },
                speed: {
                    type: Number,
                    description: "Replay at the log's own pace, divided: 60 is a minute of the run per second",
                    placeholder: "<factor>",
                },
                lines: {
                    type: Boolean,
                    description: "One line per change instead of a redrawn block, as off a terminal",
                    default: false,
                },
                width: {
                    type: Number,
                    description: "Fit frames to this width instead of the terminal's",
                    placeholder: "<n>",
                },
            },
            help: { description: "Replays an afk event log as the board that run drew.", usage: USAGE },
        },
        undefined,
        // cleye takes the flags it recognises out of the array it is handed, and it gets a copy so
        // that parsing an argument vector never changes it.
        [...argv],
    )

    return {
        events: parsed._.events,
        spec: parsed.flags.spec,
        manifest: parsed.flags.manifest,
        interval: parsed.flags.interval,
        speed: parsed.flags.speed,
        width: parsed.flags.width,
        lines: parsed.flags.lines,
    }
}
