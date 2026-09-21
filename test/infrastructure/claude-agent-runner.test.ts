import { describe, expect, it } from "vitest"
import type { AgentInvocation } from "../../src/domain/agent.ts"
import { PROFILES } from "../../src/domain/profiles.ts"
import { commandLine } from "../../src/infrastructure/claude-agent-runner.ts"

/**
 * The profile, as the flags it becomes. What is asserted is that both models reach the command line
 * — the role's own and its subagents' — because only one of them is the agent afk starts, and the
 * other is where a run's consumption actually goes (ADR-0027).
 */

const invocation = (profile: AgentInvocation["profile"]): AgentInvocation => ({
    prompt: "do the work",
    root: "/repo",
    cwd: ".afk/4/t7",
    transcriptPath: ".afk/4/transcripts/t7.jsonl",
    resumeSessionId: undefined,
    onSessionId: undefined,
    outputSchema: undefined,
    profile,
})

/**
 * The value the CLI would read for a flag, which is the argument after it — and undefined for a
 * flag that is not there at all, rather than whatever happens to sit at the front of the line.
 */
const argumentFor = (line: readonly string[], flag: string): string | undefined => {
    const at = line.indexOf(flag)
    return at === -1 ? undefined : line[at + 1]
}

describe("commandLine", () => {
    it.each([
        ["implementer", PROFILES.implementer, "opus"],
        ["planner", PROFILES.planner, "sonnet"],
        ["preparer", PROFILES.preparer, "sonnet"],
        ["pullRequestWriter", PROFILES.pullRequestWriter, "sonnet"],
    ] as const)("should invoke the %s at its profile's model", (_role, profile, model) => {
        // given
        const invoked = invocation(profile)

        // when
        const line = commandLine(invoked)

        // then
        expect(argumentFor(line, "--model")).toBe(model)
    })

    it.each([
        ["fixer", PROFILES.fixer, "high"],
        ["resolver", PROFILES.resolver, "medium"],
        ["pullRequestWriter", PROFILES.pullRequestWriter, "medium"],
    ] as const)("should invoke the %s at its profile's effort", (_role, profile, effort) => {
        // given
        const invoked = invocation(profile)

        // when
        const line = commandLine(invoked)

        // then
        expect(argumentFor(line, "--effort")).toBe(effort)
    })

    it("should force the profile's subagent model, so a skill's own frontmatter cannot outrank it", () => {
        // given
        const invoked = invocation({ model: "opus", effort: "medium", subagentModel: "sonnet" })

        // when
        const line = commandLine(invoked)

        // then
        expect(JSON.parse(argumentFor(line, "--settings") ?? "{}")).toEqual({
            env: { CLAUDE_CODE_SUBAGENT_MODEL: "sonnet", CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" },
        })
    })

    it("should still refuse to push, whatever the profile says", () => {
        // given
        const invoked = invocation(PROFILES.implementer)

        // when
        const line = commandLine(invoked)

        // then
        expect(argumentFor(line, "--disallowedTools")).toBe("Bash(git push:*)")
    })
})
