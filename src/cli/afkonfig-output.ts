/**
 * What an invalid afkonfig needs corrected, one line each. The same lines whether `afk config`
 * checked it or a run that plans refused over it, since both are answering the same question.
 */
export const invalidAfkonfigOutput = (problems: readonly string[]): string[] => [
    "afk: afkonfig.mts is invalid. Correct:",
    ...problems.map(problem => `  - ${problem}`),
]
