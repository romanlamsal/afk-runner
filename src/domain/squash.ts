/**
 * The commit that lands a ticket on the spec branch, and the trailer that is the git-side record of
 * which ticket it carried.
 *
 * The body is the implementer's own commit messages — what somebody who was there wrote about the
 * work — plus the resolver's note where there was a conflict. A spec-PR reviewer has no other way to
 * learn that an agent made an unreviewed judgement call inside that commit, which is this design's
 * live risk (ADR-0007).
 *
 * There is no conflict trailer. A trailer is for a machine, and the only machine that would read one
 * already has the event log (ADR-0011).
 */

const TRAILER = "afk-ticket"

/** `afk-ticket: <spec>/<n>`, and it is the body's last paragraph so that git reads it as a trailer. */
export const ticketTrailer = (spec: number, ticket: number): string => `${TRAILER}: ${spec}/${ticket}`

const paragraphs = (texts: readonly (string | undefined)[]): readonly string[] =>
    texts.flatMap(text => {
        const trimmed = text?.trim() ?? ""
        return trimmed === "" ? [] : [trimmed]
    })

/** The resolver's reasoning, named as such — a resolver that said nothing leaves nothing. */
const resolution = (note: string | undefined): readonly string[] =>
    paragraphs([note]).map(said => `Conflict resolution: ${said}`)

export const squashMessage = ({
    spec,
    ticket,
    title,
    commits,
    note,
}: {
    spec: number
    ticket: number
    title: string
    /** The implementer's own commit messages, oldest first. */
    commits: readonly string[]
    /** What the resolver said it did, where there was a conflict to resolve at all. */
    note: string | undefined
}): string =>
    [`${title} (#${ticket})`, ...paragraphs(commits), ...resolution(note), ticketTrailer(spec, ticket)].join("\n\n")

/**
 * Which of this spec's tickets these commit messages say are on the branch. It is read as a
 * **cross-check** and never as the dispatcher: which ticket is taken through the merge track is the
 * event log's to say, and a commit can only answer whether that ticket's work is already there —
 * never which step failed, or why (ADR-0011).
 */
export const mergedTickets = (spec: number, messages: readonly string[]): readonly number[] => {
    const trailer = new RegExp(`^${TRAILER}: ${spec}/(\\d+)$`, "m")
    return messages.flatMap(message => {
        const found = trailer.exec(message)
        return found?.[1] === undefined ? [] : [Number(found[1])]
    })
}
