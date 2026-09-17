import { runDirectory } from "../domain/paths.ts"

/**
 * What starting over leaves on screen. It names what went, because the flag asks nothing and the
 * operator's only account of what was thrown away is this — and it names what stayed, because a
 * claim surviving is a decision rather than an oversight.
 */
export const freshOutput = (spec: number, { pullRequest }: { pullRequest: boolean }): string[] => [
    `spec #${spec}: branches deleted, ${runDirectory(spec)} cleared, claims left alone`,
    ...(pullRequest ? [`spec #${spec}: its pull request is closed`] : []),
]
