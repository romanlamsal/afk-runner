#!/usr/bin/env node
import { readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { setTimeout as wait } from "node:timers/promises"
import { z } from "zod"
import { createLineBoard, createTerminalBoard } from "../cli/board-writer.ts"
import type { Board } from "../domain/board.ts"
import { type LifecycleEvent, readEvent } from "../domain/events.ts"
import { type Manifest, type ManifestRead, readStoredManifest } from "../domain/manifest.ts"
import { eventLogPath, manifestPath } from "../domain/paths.ts"
import { parseReplayArgs, type ReplayArgs, USAGE } from "./args.ts"
import { type Pacing, type ReplayFrame, replayFrames, waitBefore } from "./frames.ts"

/**
 * Replaying a run's board off its event log: the impure half — the files, the clock and the
 * terminal — and afk's one developer tool.
 *
 * It is not part of afk and nothing of afk's calls it. It exists because the board is a pure
 * function of the log (ADR-0029), which makes a finished run replayable exactly as it was drawn:
 * the same domain function, the same frame, the same writer. A bug you can watch again is a
 * different thing from one you have to read a JSONL file to imagine.
 *
 * It reads and it draws, and it writes nothing anywhere.
 */

const print = (line: string): void => {
    process.stdout.write(`${line}\n`)
}

const printError = (line: string): void => {
    process.stderr.write(`${line}\n`)
}

/**
 * The log, line by line, read as defensively as the run's own adapter reads it: a line that does
 * not parse is dropped rather than failing everything before it (ADR-0011). The splitting is here
 * rather than borrowed from `repository/event-log.ts` because that adapter is keyed by a repository
 * root and a spec number — a replay is handed a path, which is the whole point of it.
 */
const readEvents = async (path: string): Promise<readonly LifecycleEvent[] | undefined> => {
    const contents = await readFile(path, "utf8").catch(() => undefined)
    if (contents === undefined) {
        return undefined
    }

    return contents.split("\n").flatMap((line): LifecycleEvent[] => {
        if (line.trim() === "") {
            return []
        }
        try {
            const event = readEvent(JSON.parse(line))
            return event === undefined ? [] : [event]
        } catch {
            return []
        }
    })
}

/**
 * Which spec a manifest claims to be for, asked of the file before it is read as one. The manifest
 * rules check the answer against the question — a manifest for another spec is a refusal — and a
 * replay has no question of its own to ask, so it takes the file's own answer and lets the rest of
 * the rules judge everything else.
 */
const claimedSpec = z.object({ spec: z.int().positive() })

/** The manifest beside a log, or nothing where there is no file there to read. */
const readManifestFile = async (path: string): Promise<ManifestRead | undefined> => {
    const contents = await readFile(path, "utf8").catch(() => undefined)
    if (contents === undefined) {
        return undefined
    }

    const raw: unknown = (() => {
        try {
            return JSON.parse(contents)
        } catch {
            return undefined
        }
    })()

    const claim = claimedSpec.safeParse(raw)
    return claim.success ? readStoredManifest(raw, claim.data.spec) : { ok: false, reason: `${path} is not a manifest` }
}

/**
 * The manifest a log implies when there is no manifest to read: every ticket the log ever mentions,
 * in the order it first mentions them.
 *
 * It is what makes a log somebody pasted replayable at all. What it cannot invent is the titles,
 * and it does not try: a row says so in the column the title would have been in, rather than
 * showing a plausible sentence nothing wrote.
 */
const impliedManifest = (spec: number, events: readonly LifecycleEvent[]): Manifest => ({
    spec,
    setup: "unknown",
    verify: "unknown",
    tickets: [...new Set(events.flatMap(event => (event.ticket === undefined ? [] : [event.ticket])))].map(number => ({
        number,
        title: "(no manifest: title unknown)",
        blockedBy: [],
    })),
})

/** Where the log is: the path as given, or the one this repository keeps a spec's log at. */
const eventsPathOf = (args: ReplayArgs): string | undefined => {
    if (args.events !== undefined) {
        return resolve(args.events)
    }
    return args.spec === undefined ? undefined : join(process.cwd(), eventLogPath(args.spec))
}

/**
 * Where the manifest is: as given, or this repository's own for a spec, or simply beside the log —
 * which is where a run directory has it, whoever copied it out.
 */
const manifestPathOf = (args: ReplayArgs, events: string): string => {
    if (args.manifest !== undefined) {
        return resolve(args.manifest)
    }
    return args.spec === undefined
        ? join(dirname(events), "manifest.json")
        : join(process.cwd(), manifestPath(args.spec))
}

/**
 * The board to replay onto. The same choice the run makes — a terminal gets the redrawn block and
 * anything else gets a line per change — except that a replay may be told to show the other one,
 * because reproducing what a CI log looked like is half of what this is for (ADR-0029).
 */
const boardFor = (args: ReplayArgs): Board => {
    if (args.lines || process.stdout.isTTY !== true) {
        return createLineBoard({ print })
    }
    return createTerminalBoard({
        write: chunk => process.stdout.write(chunk),
        columns: () => args.width ?? process.stdout.columns ?? 80,
    })
}

const REFUSED = 2

const replay = async (argv: string[]): Promise<number> => {
    const args = parseReplayArgs(argv)

    const path = eventsPathOf(args)
    if (path === undefined) {
        printError(`afk-replay: name a log to replay, or a spec of this repository\n${USAGE}`)
        return REFUSED
    }

    const events = await readEvents(path)
    if (events === undefined) {
        printError(`afk-replay: there is no readable log at ${path}`)
        return REFUSED
    }

    // A manifest is what the rows are: which tickets the run had, and what they were called. A run
    // that never planned has none, and a log carried off a machine tends to arrive without one, so
    // a missing manifest is a note rather than a refusal.
    const beside = manifestPathOf(args, path)
    const read = await readManifestFile(beside)
    if (read === undefined) {
        printError(`afk-replay: there is no manifest at ${beside}, so the rows carry numbers and no titles`)
    } else if (!read.ok) {
        printError(`afk-replay: ${read.reason}`)
    }
    const manifest = read?.ok === true ? read.manifest : impliedManifest(args.spec ?? 0, events)

    const pacing: Pacing =
        args.speed === undefined ? { kind: "fixed", ms: args.interval } : { kind: "real", factor: args.speed }

    const board = boardFor(args)
    let previous: ReplayFrame | undefined
    for (const frame of replayFrames(manifest, events)) {
        const held = waitBefore(pacing, previous, frame)
        if (held > 0) {
            await wait(held)
        }
        board.show(frame.view)
        previous = frame
    }

    return 0
}

process.exitCode = await replay(process.argv.slice(2))
