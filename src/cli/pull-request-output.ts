import type { FinishResult } from "../service/finish.ts"

type Finished = Exclude<FinishResult, { outcome: "failed" }>

const WHAT_IT_DID = { opened: "opened", updated: "updated", left: "closed, not reopened" } as const

/**
 * The last line a run prints: where the pull request is, whether it is a draft — the one-word
 * version of whether the spec is whole — and what this run did to it. The link is there whichever
 * it was, so that the operator can open it straight from the terminal.
 */
export const pullRequestOutput = ({ outcome, draft, url }: Finished): string[] => {
    const what = `${draft ? "draft pull request" : "pull request"} ${WHAT_IT_DID[outcome]}`
    return [url === undefined ? what : `${what}: ${url}`]
}
