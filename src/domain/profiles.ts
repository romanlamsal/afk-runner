/**
 * What each role is invoked with. A profile is a rule about the run, so it lives here beside
 * `INVOCATION_TIMEOUT_MS` rather than in the adapter that spells it as flags (ADR-0027).
 *
 * Two knobs, because one is not enough. `model` and `effort` reach only the agent afk started;
 * `subagentModel` reaches the agents *it* spawns, which is where afk's consumption actually goes —
 * the skills a role invokes fan out, and a fan-out left on the session default undoes the choice.
 */

/**
 * The models afk picks between. Aliases rather than pinned ids: afk wants the current one. Not
 * *tier*, which the glossary reserves against **Layer**.
 */
export type Model = "opus" | "sonnet" | "haiku"

/** The agent CLI's own levels, all of them, because the flag's domain is not afk's to narrow. */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max"

export type AgentProfile = {
    /** The agent afk starts. */
    model: Model
    effort: Effort
    /** Every agent that one spawns, its skills' own included. */
    subagentModel: Model
}

/**
 * One profile per role, and the roles are the prompts: there is no seventh thing an agent is
 * invoked for. Deliberately generous — a role that is cheap and wrong costs an attempt, and an
 * attempt is worth more than the tokens it saved. Dial down from here against what the log records.
 *
 * The keys are the prompt names — `resolverPrompt`, `fixerPrompt`, `preparerPrompt` — rather than
 * the glossary's prose, so that a role's profile sits next to the role's prompt under one name.
 */
export const PROFILES = {
    /**
     * Reads the repository's documentation and returns a manifest. Bounded, schema-shaped work, so
     * the middle model; what it spawns is reading, so the cheapest.
     */
    planner: { model: "sonnet", effort: "medium", subagentModel: "haiku" },

    /**
     * The work of a run, and the largest share of its consumption. Its skills fan out to review the
     * diff, and the implementer self-verifies against what that review found (ADR-0015) — so the
     * fan-out's model is a choice about the quality of that signal, not only about its price.
     */
    implementer: { model: "opus", effort: "medium", subagentModel: "opus" },

    /** Resolves by intent across two sides of a rebase. Wrong here lands wrong work (ADR-0005). */
    resolver: { model: "opus", effort: "medium", subagentModel: "sonnet" },

    /**
     * The gate's single attempt before the merge is reverted (ADR-0009). It gets the most afk has:
     * there is no second one, and the alternative to it succeeding is a ticket that does not land.
     */
    fixer: { model: "opus", effort: "high", subagentModel: "opus" },

    /** Makes a wrecked ticket fit for the normal track. It lands no work, so the cheapest model. */
    preparer: { model: "haiku", effort: "low", subagentModel: "haiku" },

    /** Prose from commits afk already has. Nothing downstream depends on it being clever. */
    pullRequestWriter: { model: "haiku", effort: "medium", subagentModel: "haiku" },
} as const satisfies Record<string, AgentProfile>
