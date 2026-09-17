import type { Manifest, Ticket } from "../../src/domain/manifest.ts"

/**
 * The manifest a test builds its graph out of. It is here rather than in each suite because the
 * shape is the same everywhere a DAG is asserted, and three copies of it drift.
 */
export const ticket = (number: number, blockedBy: readonly number[] = []): Ticket => ({
    number,
    title: `ticket ${number}`,
    blockedBy: [...blockedBy],
})

export const manifestOf = (tickets: readonly Ticket[]): Manifest => ({
    spec: 4,
    setup: "npm ci",
    verify: "npm run check",
    tickets: [...tickets],
})
