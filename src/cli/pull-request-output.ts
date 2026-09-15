/**
 * The last line a run prints: where the pull request is, and whether it is a draft — which is the
 * one-word version of whether the run was the whole spec.
 */
export const pullRequestOutput = ({ draft, url }: { draft: boolean; url: string | undefined }): string[] => {
    const what = draft ? "draft pull request" : "pull request"
    return [url === undefined ? `${what} opened` : `${what}: ${url}`]
}
