import { spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { AgentInvocation, AgentResult, AgentRunner } from "../domain/agent.ts"
import type { Model } from "../domain/profiles.ts"
import { INVOCATION_TIMEOUT_MS } from "../domain/timeout.ts"
import { minutes, registerChild, terminateGroup } from "./process.ts"
import { createStreamReader } from "./stream-json.ts"

/**
 * The agent port, against the Claude Code CLI. One invocation shape serves every role: the stream
 * is written to the attempt's transcript as it arrives, the session id is read out of it rather
 * than asserted (ADR-0017), and the structured output is read out of its tool call.
 *
 * Sandboxing is inherited unexamined and tracked separately; these are the flags the superseded
 * runner used.
 */
const CLAUDE_FLAGS = [
    "--permission-mode",
    "auto",
    "--permission-prompts",
    "none",
    "--disallowedTools",
    "Bash(git push:*)",
]

/**
 * The profile's subagent model, as the one thing that reaches a subagent afk did not start: an
 * `env` block passed as argv rather than exported, so it is the invocation that says it and not
 * whatever shell launched the run.
 *
 * `_FORCE` is not optional. Without it the model is a default that a subagent definition's own
 * `model` field outranks, so the model that ran would be a property of whatever skills the target
 * repository happens to carry (ADR-0027).
 */
const subagentSettings = (model: Model): string =>
    JSON.stringify({ env: { CLAUDE_CODE_SUBAGENT_MODEL: model, CLAUDE_CODE_SUBAGENT_MODEL_FORCE: "1" } })

/** Enough of the tail to name a failure, without holding a wedged agent's whole error output. */
const STDERR_TAIL = 2000

export const commandLine = (invocation: AgentInvocation): string[] => [
    "-p",
    invocation.prompt,
    ...CLAUDE_FLAGS,
    "--model",
    invocation.profile.model,
    "--effort",
    invocation.profile.effort,
    "--settings",
    subagentSettings(invocation.profile.subagentModel),
    "--output-format",
    "stream-json",
    "--verbose",
    ...(invocation.outputSchema === undefined ? [] : ["--json-schema", JSON.stringify(invocation.outputSchema)]),
    ...(invocation.resumeSessionId === undefined ? [] : ["--resume", invocation.resumeSessionId]),
]

export const createClaudeAgentRunner = ({
    timeoutMs = INVOCATION_TIMEOUT_MS,
}: {
    timeoutMs?: number
} = {}): AgentRunner => {
    return async invocation => {
        const transcript = join(invocation.root, invocation.transcriptPath)
        await mkdir(dirname(transcript), { recursive: true })
        const sink = createWriteStream(transcript, { flags: "a" })
        const reader = createStreamReader()
        const startedAt = Date.now()

        const result = await new Promise<AgentResult>(resolve => {
            // Detached and registered like every other child afk starts, which matters most here:
            // the implementer is the work the operator's first interrupt exists to spare, so it
            // must not be in the process group their terminal signals (ADR-0016).
            const child = spawn("claude", commandLine(invocation), {
                cwd: join(invocation.root, invocation.cwd),
                detached: true,
            })
            registerChild(child)

            const settle = (outcome: AgentResult["outcome"], detail: string): void => {
                const { sessionId, structuredOutput, usage } = reader.reading()
                resolve({ outcome, sessionId, structuredOutput, detail, usage })
            }

            let pending = ""
            let stderr = ""
            let announced = false

            // The id is handed on the moment the stream carries one, which is before any model work:
            // what is recorded is then a session that exists rather than one afk meant to create.
            const announce = (): void => {
                const { sessionId } = reader.reading()
                if (sessionId !== undefined && !announced) {
                    announced = true
                    invocation.onSessionId?.(sessionId)
                }
            }

            // The timeout is owned here rather than inferred from how long the process ran: an
            // agent killed from outside is not a timeout, and an agent that ignores the first
            // signal must not keep the slot anyway.
            let timedOut = false
            const kill = setTimeout(() => {
                timedOut = true
                terminateGroup(child)
            }, timeoutMs)

            child.stdout.setEncoding("utf8")
            child.stdout.on("data", (chunk: string) => {
                sink.write(chunk)
                const lines = (pending + chunk).split("\n")
                pending = lines.pop() ?? ""
                for (const line of lines) {
                    reader.read(line)
                }
                announce()
            })

            child.stderr.setEncoding("utf8")
            child.stderr.on("data", (chunk: string) => {
                stderr = (stderr + chunk).slice(-STDERR_TAIL)
            })

            child.on("error", error => {
                clearTimeout(kill)
                settle("failed", `claude could not be run: ${error.message}`)
            })

            child.on("close", (code, signal) => {
                clearTimeout(kill)
                reader.read(pending)
                if (timedOut) {
                    settle("failed", `timed out after ${minutes(Date.now() - startedAt)}`)
                    return
                }
                if (signal !== null) {
                    settle("failed", `killed by ${signal}`)
                    return
                }
                settle(code === 0 ? "ok" : "failed", code === 0 ? "" : `exit ${code}: ${stderr.trim()}`)
            })
        })

        await new Promise<void>(closed => sink.end(closed))
        return result
    }
}
