---
status: accepted
---

# Agents are scoped by model and effort, not by `--bare`

afk's cost is not measured in money. On a Team seat, usage draws from a per-seat allowance on a
rolling five-hour window and a weekly one; the `total_cost_usd` an invocation reports is computed
locally at list price and is not a bill. The scarce resource is the allowance, and a spec's tickets
were consuming 2–4% of it each.

`--bare` was the obvious answer and is the wrong one. It strips the harness preamble, hooks, plugin
sync and `CLAUDE.md` auto-discovery — and a measurement said the preamble was never the cost.
`/usage` attributed **70% of consumption to the `mattpocock-skills` plugin** (34% `implement`, 15%
`code-review`, 10% more in `code-review`'s own sub-agents), **97% to subagent-heavy sessions**, and
reported **95% of input tokens served from cache** with no misses. The bytes `--bare` removes were
already being read at a tenth of rate. The fan-out inside the skills was everything.

**Decision: every agent invocation carries its own model and effort, passed as arguments, and the
model of the subagents it spawns is set on that same invocation.**

```
--model <tier> --effort <level>
--settings '{"env":{"CLAUDE_CODE_SUBAGENT_MODEL":"<tier>","CLAUDE_CODE_SUBAGENT_MODEL_FORCE":"1"}}'
```

Two knobs, not one, and the second is the one that matters. `--model` sets only the agent afk
started; its subagents fall back to the session's model and undo the choice. `--settings` takes a
JSON string, so the environment block is argv — decided in the script, visible in a diff, and not
inherited from whatever shell launched the run.

`_FORCE` is not optional. Without it `CLAUDE_CODE_SUBAGENT_MODEL` is only a default that a
subagent definition's own `model` field outranks. That it works today is a fact about
`mattpocock-skills` v1.2.3, whose `implement` and `code-review` declare no model — not a property of
the arrangement. With `_FORCE` set, Claude Code ignores the `model` field of every subagent
definition, and the tier afk asked for is the tier that runs whatever upstream ships next.

## Considered options

- **`--bare`, with a rescoped tool and context surface.** Rejected three times over. It targets ~0%
  of measured usage. Its auth is strictly `ANTHROPIC_API_KEY` or `apiKeyHelper` — OAuth and the
  keychain are never read — and a Team seat offers no API-key path at all; the documented overflow is
  usage credits. And it would trade the subscription's one-hour prompt cache for the five minutes an
  API key gets, against a run that is a long sequence of separate invocations. It is on the record as
  the future default for `-p`, so this will return as a migration; it returns as a migration and not
  as an economy.
- **Telling the agent which model to use for its subagents, in the prompt.** Rejected, despite being
  the *highest*-precedence mechanism there is — a per-invocation model parameter outranks both
  frontmatter and the environment. It is a request to a language model rather than a guarantee, so it
  is right nearly always and silently wrong sometimes, overnight. It is also mutually exclusive with
  `_FORCE`, which withdraws the parameter entirely. Determinism relocated into prose is not
  determinism.
- **Vendoring the skills into the target repository, or pinning their version with `--plugin-dir`.**
  Rejected. Either one forks the suite from upstream and stops the updates that make it worth
  depending on, and `--settings` reaches the fan-out without touching the skills at all. Which
  version a repository carries is that repository's business.
- **Moving the implementer's prompt out of the skill and into afk.** Rejected. It is 34% of
  consumption and it does re-derive things afk already knows — the ticket's scope, its `baseSha`, its
  branch, the verify command — but the skills are the point, and a prompt copied into afk is a prompt
  that rots while the skill improves.
- **A spend ceiling per invocation (`--max-budget-usd`).** Rejected. No API reports remaining
  allowance, so a ceiling denominated in dollars would bound a quantity afk cannot see, and
  **Budget** already means *how many attempts a step gets*. ADR-0021's one-hour timeout already
  bounds the runaway case in a unit afk can actually observe.
- **Scheduling against the allowance — throttling or pausing near the cap.** Rejected. All sessions
  share one allowance and there is no endpoint for what is left of it, so any such logic would be
  guesswork with a control surface.

## Consequences

- **The single shared flag list is gone.** Flags common to every invocation and flags belonging to
  one role are no longer the same thing, and a role's tier is a fact recorded next to that role.
- **Reviewers are the case where cheap is wrong.** ADR-0015 has the implementer self-verify against
  what the review found, so a tier chosen for `code-review`'s two sub-agents is a tier chosen for the
  quality of that signal.
- **Token usage is recorded on the end-of-step lifecycle event**, absent rather than zero for the
  steps that run commands and hold no session. Without it "which step burns the allowance" is an
  argument; ADR-0011's log is where it becomes a reading.
- **Context size stays a ticket-granularity problem.** Half of measured usage sat above 150k context,
  which is a long implementer transcript, which is a large ticket. ADR-0002 bars afk from
  second-guessing that, so afk records what the attempt consumed and the planner's output is where
  it gets fixed. Not the context's peak size, which the stream does not report — the token counts
  are the proxy, and a large one is the signal to look at the ticket.
- **This record exists because `--bare` will look obvious again.** When it becomes the default for
  `-p`, the work is to keep afk's context and plugins explicit under it — not to adopt it for the
  saving, which was measured and was not there.
