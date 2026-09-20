/**
 * What a board's line is made of, and the vocabulary the layout and the colouring share.
 *
 * A span is a run of text with what it is beside it, and never the escape sequence that would say
 * so. That split is arithmetic rather than taste: the frame pads and truncates with `padEnd` and a
 * length check, and an escape sequence is characters to both, so colour inside the layout pads every
 * coloured row crooked. A test asserting the finished string would not catch it, because the
 * expected string is wrong in exactly the same way (ADR-0031).
 */

/**
 * What a span is on the board — a role, and never a treatment. The layout says a step has not been
 * reached; what that looks like is the colouring's, so the palette is one table in one file and the
 * frame holds no opinion about colour (ADR-0033).
 *
 * The step roles are the outcomes a step settles on, `ok` aside: a step that simply worked is the
 * background everything else is read against, so it carries the same role as an indent.
 */
export const ROLES = [
    "plain",
    "ahead",
    "running",
    "quiet",
    "interrupted",
    "conflicted",
    "failed",
    "skipped",
    "verified",
] as const

export type Role = (typeof ROLES)[number]

/** A run of text, and what it is. */
export type Span = {
    text: string
    role: Role
}

/** One line of the frame. The layout hands these out and the colouring turns each into a string. */
export type Line = readonly Span[]

/**
 * Text with nothing to say about itself: an indent, a separator, the padding of a column, a step
 * that settled on nothing worth noticing.
 */
export const plain = (text: string): Span => ({ text, role: "plain" })

/** What a line is worth in columns, which is its plain text and never what colour made of it. */
export const widthOf = (line: Line): number => line.reduce((columns, span) => columns + span.text.length, 0)

/** A line as the operator reads it, with no colour in it. What the layout is asserted as. */
export const textOf = (line: Line): string => line.map(span => span.text).join("")
