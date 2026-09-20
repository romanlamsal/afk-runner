import { appendFile, mkdir, mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createFileActivity } from "../../src/repository/activity.ts"
import { describeActivityContract, type Writer } from "../contract/activity.ts"

/**
 * The real half of the activity port's contract — the same suite the fake runs, against files in a
 * throwaway directory written the way the agent runner and the command runner write them.
 */
const LINE: Record<Writer, (at: Date) => string> = {
    transcript: at => JSON.stringify({ type: "assistant", message: {}, timestamp: at.toISOString() }),
    command: at => `${at.toISOString()} PASS test/domain/board.test.ts`,
}

describeActivityContract("the run directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "afk-activity-contract-"))
    const append = async (path: string, line: string): Promise<void> => {
        await mkdir(dirname(join(root, path)), { recursive: true })
        await appendFile(join(root, path), `${line}\n`, "utf8")
    }
    return {
        activity: createFileActivity(),
        root,
        write: (path, writer, at) => append(path, LINE[writer](at)),
        unstamped: path => append(path, JSON.stringify({ type: "system", subtype: "thinking_tokens" })),
    }
})
