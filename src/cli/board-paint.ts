import type { Hue, Line, Tone } from "./board-span.ts"

/**
 * The board's colouring: a pure mapping from a line of spans to the string the writer writes. It is
 * the last thing that happens to a line, which is the whole point — every width the frame computed
 * was computed on plain text, and nothing here changes a span's width (ADR-0031).
 *
 * It holds the palette and no layout, so that changing a colour breaks this and nothing else.
 */

/** The terminal's own weight ladder: three levels for the three places a step can be in a run. */
const TONE_CODES: Record<Tone, readonly string[]> = {
    dim: ["2"],
    // Normal is the terminal's own foreground rather than a code of its own, so a span with nothing
    // to say about itself reaches the screen as the text it is.
    normal: [],
    bright: ["1"],
}

/** The four colours the board has. Amber is the terminal's yellow, which is what a terminal has. */
const HUE_CODES: Record<Hue, string> = {
    amber: "33",
    red: "31",
    green: "32",
}

const SET = (codes: readonly string[]): string => `\u001b[${codes.join(";")}m`

const RESET = "\u001b[0m"

export const painted = (line: Line): string =>
    line
        .map(span => {
            const codes = [...TONE_CODES[span.tone], ...(span.hue === undefined ? [] : [HUE_CODES[span.hue]])]
            // Nothing to say, or nothing to say it about: an untreated span, and an empty one, are
            // written as they are rather than wrapped in a sequence that would draw nothing.
            return codes.length === 0 || span.text === "" ? span.text : `${SET(codes)}${span.text}${RESET}`
        })
        .join("")
