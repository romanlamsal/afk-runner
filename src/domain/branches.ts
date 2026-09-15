/**
 * The branches a run owns. They are derived from the spec and the ticket numbers rather than stored,
 * so that nothing can hold a name that disagrees with the one git has.
 */

/** The single branch every ticket lands on, and the only branch a run writes to (ADR-0006). */
export const specBranch = (spec: number): string => `afk/${spec}/spec`
