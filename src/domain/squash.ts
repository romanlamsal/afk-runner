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

/** The same record, for the commit that takes a ticket back off the branch (ADR-0009). */
const REVERT_TRAILER = "afk-reverted"

/** `afk-ticket: <spec>/<n>`, and it is the body's last paragraph so that git reads it as a trailer. */
export const ticketTrailer = (spec: number, ticket: number): string => `${TRAILER}: ${spec}/${ticket}`

/** `afk-reverted: <spec>/<n>`, and the reason a reverted ticket does not read as one that landed. */
export const revertTrailer = (spec: number, ticket: number): string => `${REVERT_TRAILER}: ${spec}/${ticket}`

const paragraphs = (texts: readonly (string | undefined)[]): readonly string[] =>
    texts.flatMap(text => {
        const trimmed = text?.trim() ?? ""
        return trimmed === "" ? [] : [trimmed]
    })

/** The resolver's reasoning, named as such — a resolver that said nothing leaves nothing. */
const resolution = (note: string | undefined): readonly string[] =>
    paragraphs([note]).map(paragraph => `Conflict resolution: ${paragraph}`)

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
 * The commit that takes a ticket back off the spec branch, when the gate stayed red with it on
 * there and the one fix attempt did not help (ADR-0009). It is a revert commit and never a reset
 * and a force-push: append-only history is the only thing compatible with a pool of worktrees
 * sitting off the tip.
 */
export const revertMessage = ({ spec, ticket, title }: { spec: number; ticket: number; title: string }): string =>
    [
        `Revert "${title} (#${ticket})"`,
        `The gate could not prove this branch with #${ticket} on it, and the one fix attempt afk makes did not make it green. Everything that landed from that merge onwards is undone here; the ticket's own work is untouched on its own branch.`,
        revertTrailer(spec, ticket),
    ].join("\n\n")

/** The ticket a trailer of this spec names, or nothing where the message carries no such trailer. */
const trailed = (name: string, spec: number, message: string): number | undefined => {
    const found = new RegExp(`^${name}: ${spec}/(\\d+)$`, "m").exec(message)
    return found?.[1] === undefined ? undefined : Number(found[1])
}

/**
 * Where each of this spec's tickets stands by these commit messages: landed or reverted, by the last
 * trailer naming it. History is append-only, so a reverted ticket's squash is still on the branch
 * and its revert is too, and only the later of the two says where the ticket is (ADR-0009).
 */
const trailedTickets = (spec: number, messages: readonly string[]): ReadonlyMap<number, "merged" | "reverted"> => {
    const standing = new Map<number, "merged" | "reverted">()

    for (const message of messages) {
        const merged = trailed(TRAILER, spec, message)
        const reverted = trailed(REVERT_TRAILER, spec, message)
        if (merged !== undefined) {
            standing.set(merged, "merged")
        }
        if (reverted !== undefined) {
            standing.set(reverted, "reverted")
        }
    }

    return standing
}

const standingAs = (standing: "merged" | "reverted", spec: number, messages: readonly string[]): readonly number[] =>
    [...trailedTickets(spec, messages)].flatMap(([ticket, where]) => (where === standing ? [ticket] : []))

/**
 * Which of this spec's tickets these commit messages say are on the branch. It is read as a
 * **cross-check** and never as the dispatcher: which ticket is taken through the merge track is the
 * event log's to say, and a commit can only answer whether that ticket's work is already there —
 * never which step failed, or why (ADR-0011).
 *
 * A reverted ticket is not on it, which is what keeps "ask git which tickets landed" answerable from
 * a fresh clone after a revert (ADR-0009).
 */
export const mergedTickets = (spec: number, messages: readonly string[]): readonly number[] =>
    standingAs("merged", spec, messages)

/**
 * Which of this spec's tickets these commit messages say were taken back off the branch — the same
 * cross-check, asked by a revert: a revert a killed run left `running` may already have landed its
 * commit, and reverting a second time would undo whatever came after it (ADR-0009).
 */
export const revertedTickets = (spec: number, messages: readonly string[]): readonly number[] =>
    standingAs("reverted", spec, messages)
