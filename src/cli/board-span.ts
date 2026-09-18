/**
 * What a board's line is made of, and the vocabulary the layout and the colouring share.
 *
 * A span is a run of text with what it is to be read at beside it, and never the escape sequence
 * that would say so. That split is arithmetic rather than taste: the frame pads and truncates with
 * `padEnd` and a length check, and an escape sequence is characters to both, so colour inside the
 * layout pads every coloured row crooked. A test asserting the finished string would not catch it,
 * because the expected string is wrong in exactly the same way (ADR-0031).
 */

/**
 * Where a span's text sits in the run: the terminal's own ladder rather than blended colour,
 * because blending has to assume a background and inverts on a light theme (ADR-0031).
 */
export const TONES = ["dim", "normal", "bright"] as const

export type Tone = (typeof TONES)[number]

/** An outcome worth noticing, which is the only thing on the board that gets a colour of its own. */
export const HUES = ["amber", "red", "green"] as const

export type Hue = (typeof HUES)[number]

/** A run of text, at one tone, and in one hue where it has an outcome to say. */
export type Span = {
    text: string
    tone: Tone
    hue?: Hue
}

/** One line of the frame. The layout hands these out and the colouring turns each into a string. */
export type Line = readonly Span[]

/** Text with nothing to say about itself: an indent, a separator, the padding of a column. */
export const plain = (text: string): Span => ({ text, tone: "normal" })

/** What a line is worth in columns, which is its plain text and never what colour made of it. */
export const widthOf = (line: Line): number => line.reduce((columns, span) => columns + span.text.length, 0)

/** A line as the operator reads it, with no colour in it. What the layout is asserted as. */
export const textOf = (line: Line): string => line.map(span => span.text).join("")
