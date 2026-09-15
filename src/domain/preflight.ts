import type { TrunkState } from "./git.ts"

/**
 * What the operator is told about their repository before a run starts, and the whole of what
 * replaced the old preflight's refusals (ADR-0018).
 *
 * Being ahead is a note: the spec branch is cut from the local trunk, so an unpushed commit is part
 * of the run by design. Being behind, and a dirty working tree, are warnings — they change what the
 * implementers will see, and they are shown before the one decision the operator makes.
 */
export type Notice = { kind: "note" | "warning"; message: string }

const commits = (count: number): string => `${count} commit${count === 1 ? "" : "s"}`

/** Warnings first, so that the screen they head reads top to bottom. */
export const trunkNotices = (trunk: TrunkState): readonly Notice[] => {
    const warnings: Notice[] = []
    const notes: Notice[] = []

    if (trunk.behind > 0) {
        warnings.push({
            kind: "warning",
            message:
                `${trunk.branch} is ${commits(trunk.behind)} behind origin/${trunk.branch}. ` +
                `afk does not pull: this run starts from your local ${trunk.branch}`,
        })
    }

    if (trunk.dirty) {
        warnings.push({
            kind: "warning",
            message: `uncommitted changes are not part of this run: the implementers see ${trunk.branch} as committed`,
        })
    }

    if (trunk.ahead > 0) {
        notes.push({
            kind: "note",
            message:
                `${trunk.branch} is ${commits(trunk.ahead)} ahead of origin/${trunk.branch}, ` +
                "and the spec branch is cut from it, so those commits are part of this run",
        })
    }

    if (!trunk.compared) {
        notes.push({
            kind: "note",
            message: `no remote to compare ${trunk.branch} with: this run starts from your local ${trunk.branch}`,
        })
    }

    return [...warnings, ...notes]
}
