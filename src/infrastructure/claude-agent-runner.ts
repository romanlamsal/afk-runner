import { spawn } from "node:child_process"
import { createWriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { AGENT_TIMEOUT_MS, type AgentInvocation, type AgentResult, type AgentRunner } from "../domain/agent.ts"
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

/** Enough of the tail to name a failure, without holding a wedged agent's whole error output. */
const STDERR_TAIL = 2000

/** What a timed-out agent gets to shut down in before it is killed outright. */
const GRACE_MS = 10_000

const commandLine = (invocation: AgentInvocation): string[] => [
    "-p",
    invocation.prompt,
    ...CLAUDE_FLAGS,
    "--output-format",
    "stream-json",
    "--verbose",
    ...(invocation.outputSchema === undefined ? [] : ["--json-schema", JSON.stringify(invocation.outputSchema)]),
    ...(invocation.resumeSessionId === undefined ? [] : ["--resume", invocation.resumeSessionId]),
]

const minutes = (elapsedMs: number): string => `${Math.round(elapsedMs / 60_000)}m`

export const createClaudeAgentRunner = ({ timeoutMs = AGENT_TIMEOUT_MS }: { timeoutMs?: number } = {}): AgentRunner => {
    return async invocation => {
        const transcript = join(invocation.root, invocation.transcriptPath)
        await mkdir(dirname(transcript), { recursive: true })
        const sink = createWriteStream(transcript, { flags: "a" })
        const reader = createStreamReader()
        const startedAt = Date.now()

        const result = await new Promise<AgentResult>(resolve => {
            const child = spawn("claude", commandLine(invocation), { cwd: join(invocation.root, invocation.cwd) })

            const settle = (outcome: AgentResult["outcome"], detail: string): void => {
                const { sessionId, structuredOutput } = reader.reading()
                resolve({ outcome, sessionId, structuredOutput, detail })
            }

            let pending = ""
            let stderr = ""

            // The timeout is owned here rather than inferred from how long the process ran: an
            // agent killed from outside is not a timeout, and an agent that ignores the first
            // signal must not keep the slot anyway.
            let timedOut = false
            const kill = setTimeout(() => {
                timedOut = true
                child.kill("SIGTERM")
                setTimeout(() => child.kill("SIGKILL"), GRACE_MS).unref()
            }, timeoutMs)

            child.stdout.setEncoding("utf8")
            child.stdout.on("data", (chunk: string) => {
                sink.write(chunk)
                const lines = (pending + chunk).split("\n")
                pending = lines.pop() ?? ""
                for (const line of lines) {
                    reader.read(line)
                }
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
