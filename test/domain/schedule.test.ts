import { describe, expect, it } from "vitest"
import type { Ticket } from "../../src/domain/manifest.ts"
import { deadlocked, executionOrder, slateOrder, transitiveDependentCounts } from "../../src/domain/schedule.ts"

const ticket = (number: number, blockedBy: readonly number[] = []): Ticket => ({
    number,
    title: `ticket ${number}`,
    blockedBy: [...blockedBy],
})

const numbers = (tickets: readonly Ticket[]): number[] => tickets.map(one => one.number)

describe("transitiveDependentCounts", () => {
    it.each([
        ["a chain", [ticket(1), ticket(2, [1]), ticket(3, [2])], { 1: 2, 2: 1, 3: 0 }],
        ["a fan-out", [ticket(1), ticket(2, [1]), ticket(3, [1])], { 1: 2, 2: 0, 3: 0 }],
        ["a diamond", [ticket(1), ticket(2, [1]), ticket(3, [1]), ticket(4, [2, 3])], { 1: 3, 2: 1, 3: 1, 4: 0 }],
        ["an unrelated pair", [ticket(1), ticket(2)], { 1: 0, 2: 0 }],
        ["a blocker outside the spec", [ticket(1, [99])], { 1: 0 }],
    ] as const)("should count every transitive dependent of %s", (_name, tickets, expected) => {
        // given — the tickets from the table

        // when
        const counts = transitiveDependentCounts(tickets)

        // then
        expect(Object.fromEntries(counts)).toEqual(expected)
    })
})

describe("slateOrder", () => {
    it("should put the most-blocking ticket first", () => {
        // given
        const tickets = [ticket(10), ticket(11), ticket(12, [11])]

        // when
        const ordered = slateOrder(tickets)

        // then
        expect(numbers(ordered)).toEqual([11, 10, 12])
    })

    it("should break a tie by manifest order", () => {
        // given
        const tickets = [ticket(30), ticket(10), ticket(20)]

        // when
        const ordered = slateOrder(tickets)

        // then
        expect(numbers(ordered)).toEqual([30, 10, 20])
    })

    it("should leave the tickets it was given unchanged", () => {
        // given
        const tickets = [ticket(10), ticket(11), ticket(12, [11])]

        // when
        slateOrder(tickets)

        // then
        expect(numbers(tickets)).toEqual([10, 11, 12])
    })
})

describe("executionOrder", () => {
    it.each([
        ["group what can run at once", [ticket(1), ticket(2), ticket(3, [1, 2])], 3, [[1, 2], [3]]],
        ["never fill a group past the slots", [ticket(1), ticket(2), ticket(3)], 2, [[1, 2], [3]]],
        ["fill a group in slate order", [ticket(1), ticket(2), ticket(3, [2])], 1, [[2], [1], [3]]],
        ["hold a ticket back until every blocker ran", [ticket(1), ticket(2, [1]), ticket(3, [2])], 3, [[1], [2], [3]]],
        ["schedule a ticket blocked by something outside the spec", [ticket(1, [99])], 3, [[1]]],
        ["leave out tickets that can never start", [ticket(1), ticket(2, [3]), ticket(3, [2])], 3, [[1]]],
    ] as const)("should %s", (_name, tickets, maxParallel, expected) => {
        // given — the tickets and the slots from the table

        // when
        const groups = executionOrder(tickets, maxParallel)

        // then
        expect(groups.map(numbers)).toEqual(expected)
    })
})

describe("deadlocked", () => {
    it.each([
        ["a pair blocking each other", [ticket(1), ticket(2, [3]), ticket(3, [2])], [2, 3]],
        ["a ticket blocking itself", [ticket(1, [1])], [1]],
        ["a schedule that can start", [ticket(1), ticket(2, [1])], []],
        ["a blocker outside the spec", [ticket(1, [99])], []],
    ] as const)("should name what can never start in %s", (_name, tickets, expected) => {
        // given — the tickets from the table

        // when
        const stuck = deadlocked(tickets)

        // then
        expect(numbers(stuck)).toEqual(expected)
    })
})
