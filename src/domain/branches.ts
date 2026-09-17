/**
 * The branches a run owns. They are derived from the spec and the ticket numbers rather than stored,
 * so that nothing can hold a name that disagrees with the one git has.
 */

/**
 * What every branch of one spec's run is named under. Deriving both names from it is what makes
 * "everything this spec owns" a question about a prefix — which is how starting over finds branches
 * whose tickets it never read.
 */
export const specBranchPrefix = (spec: number): string => `afk/${spec}/`

/** The single branch every ticket lands on, and the only branch a run writes to (ADR-0006). */
export const specBranch = (spec: number): string => `${specBranchPrefix(spec)}spec`

/** The branch one implementer commits on, and the only thing it is allowed to write to. */
export const ticketBranch = (spec: number, ticket: number): string => `${specBranchPrefix(spec)}t${ticket}`
