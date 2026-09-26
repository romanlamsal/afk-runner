import { describe, expect, it } from "vitest"
import { BROKEN_STEPS } from "../../src/domain/events.ts"
import { plannerPrompt, preparerPrompt } from "../../src/domain/prompts.ts"

/**
 * Prompts are deliberately not asserted for shape: a test over wording pins the wording rather than
 * the behaviour. What is asserted here is the one thing that is not wording — that the prepare agent
 * is instructed by the step that broke, and so is never turned loose on a wrecked ticket with the
 * same paragraph whatever happened to it (ADR-0012). And that the planner is handed what the afkonfig
 * pins, so that what it does derive can fit it (ADR-0039).
 */

const prompt = (brokenStep: (typeof BROKEN_STEPS)[number]): string =>
    preparerPrompt({
        spec: 4,
        ticket: 10,
        title: "ticket 10",
        branch: "afk/4/t10",
        worktree: ".afk/4/t10",
        brokenStep,
    })

describe("preparerPrompt", () => {
    it("should say something different for every step that can break", () => {
        // given
        const steps = BROKEN_STEPS

        // when
        const prompts = new Set(steps.map(prompt))

        // then
        expect(prompts.size).toBe(steps.length)
    })
})

describe("plannerPrompt", () => {
    it.each([
        [{ setup: "pnpm install --frozen-lockfile" }, "pnpm install --frozen-lockfile"],
        [{ verify: "pnpm run check" }, "pnpm run check"],
    ] as const)("should hand the planner the command %o pins", (pinned, command) => {
        // given — a repository whose afkonfig pins one command

        // when
        const prompt = plannerPrompt(4, pinned)

        // then
        expect(prompt).toContain(command)
    })
})
