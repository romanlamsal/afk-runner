import type { Line, Role } from "./board-span.ts"

/**
 * The board's colouring: a pure mapping from a line of spans to the string the writer writes. It is
 * the last thing that happens to a line, which is the whole point — every width the frame computed
 * was computed on plain text, and nothing here changes a span's width (ADR-0031).
 *
 * It holds the palette and no layout, and it is the only file that knows what a role looks like, so
 * that changing a colour breaks this and nothing else.
 */

/**
 * What a terminal is asked to do with each role.
 *
 * Nothing here is an intensity. The board used to carry a step's place in the run as the terminal's
 * own dim, normal and bright ladder, and on a real terminal that is not a ladder: SGR 2 is
 * unrendered by some, and SGR 1 is a hue the scheme chooses rather than a weight (ADR-0033). Two of
 * the three levels were therefore either invisible or a colour nobody picked.
 *
 * - `ahead` is bright black: a colour, so it is actually drawn, but a neutral one, so it recedes on
 *   a dark terminal and on a light one alike.
 * - `running` is underline rather than a hue, so the live edge of the run stays orthogonal to what
 *   a step comes to — a step can be running now and red later without the two wanting one channel.
 * - `conflicted` and `skipped` are both amber, which is one meaning and not two: it did not go
 *   clean, and nothing here broke. A conflict is a state git drew, and a skip is a blocker's
 *   failure rather than this ticket's.
 * - `failed` is red, which is reserved for the thing that actually broke.
 * - `verified` is green, and the ticket number is the only place it is ever reached.
 */
const ROLE_CODES: Record<Role, readonly string[]> = {
    // Not a code of its own but the terminal's own foreground, so a span with nothing to say about
    // itself reaches the screen as the text it is.
    plain: [],
    ahead: ["90"],
    running: ["4"],
    conflicted: ["33"],
    failed: ["31"],
    skipped: ["33"],
    verified: ["32"],
}

const SET = (codes: readonly string[]): string => `\u001b[${codes.join(";")}m`

const RESET = "\u001b[0m"

export const painted = (line: Line): string =>
    line
        .map(span => {
            const codes = ROLE_CODES[span.role]
            // Nothing to say, or nothing to say it about: an untreated span, and an empty one, are
            // written as they are rather than wrapped in a sequence that would draw nothing.
            return codes.length === 0 || span.text === "" ? span.text : `${SET(codes)}${span.text}${RESET}`
        })
        .join("")
