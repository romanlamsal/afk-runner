import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath, pathToFileURL } from "node:url"
import { parseArgs } from "node:util"
import type { Layer, Manifest, Ticket } from "./schema.ts"

/**
 * Runs a whole spec's tickets unattended. See README.md for the design, and for why each of the
 * less obvious rules exists — most of them are here because the first real run broke on them.
 *
 * The split this file is built around: anything semantic — which ticket, what a label means, what
 * verifies this project, how a commit is titled — is read by an agent from the repo's own docs.
 * This script holds only mechanics.
 */

const AFK_DIR = dirname(fileURLToPath(import.meta.url))

/** Auto mode approves what is safe and denies the rest outright rather than hanging on a prompt. */
const CLAUDE_FLAGS = [
    "--permission-mode",
    "auto",
    "--permission-prompts",
    "none",
    "--disallowedTools",
    "Bash(git push:*)",
]

type RunResult = { code: number; stdout: string; stderr: string }

type Status = "pending" | "implementing" | "implemented" | "merged" | "failed" | "skipped"

type TicketState = {
    number: number
    status: Status
    branch: string
    prNumber: number | null
    sessionId: string
    worktree: string
}

type LayerState = { branch: string; status: "pending" | "running" | "verified" | "failed" }

type State = { spec: number; trunk: string; layers: LayerState[]; tickets: TicketState[] }

type Context = {
    repo: string
    slug: string
    spec: number
    trunk: string
    runDir: string
    maxParallel: number
    dryRun: boolean
    state: State
}

const log = (message: string): void => {
    console.log(`${new Date().toISOString().slice(11, 19)}  ${message}`)
}

// --- interruption -------------------------------------------------------------------------------

/**
 * Children are spawned detached so a terminal's Ctrl+C does not reach them: an implementer six
 * minutes in is expensive to throw away. The first interrupt stops new work and drains; the second
 * kills what is still running.
 */
let stopping = false
const children = new Set<number>()

process.on("SIGINT", () => {
    if (stopping) {
        for (const pid of children) {
            try {
                process.kill(-pid, "SIGKILL")
            } catch {
                // already gone
            }
        }
        process.exit(130)
    }
    stopping = true
    log("interrupt: no new work will start; draining. Ctrl+C again to kill.")
})

// --- processes ----------------------------------------------------------------------------------

const run = (
    command: string,
    args: string[],
    opts: { cwd?: string; logFile?: string; detached?: boolean } = {},
): Promise<RunResult> =>
    new Promise(resolve => {
        const child = spawn(command, args, {
            cwd: opts.cwd,
            stdio: ["ignore", "pipe", "pipe"],
            detached: opts.detached === true,
        })
        if (child.pid !== undefined && opts.detached === true) {
            children.add(child.pid)
        }
        const sink = opts.logFile ? createWriteStream(opts.logFile, { flags: "a" }) : null
        let stdout = ""
        let stderr = ""
        child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk
            sink?.write(chunk)
        })
        child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk
            sink?.write(chunk)
        })
        const finish = (code: number) => {
            if (child.pid !== undefined) {
                children.delete(child.pid)
            }
            sink?.end()
            resolve({ code, stdout, stderr })
        }
        child.on("close", code => finish(code ?? 1))
        child.on("error", error => {
            stderr += String(error)
            finish(1)
        })
    })

/** A command that changes the world. In a dry run it is printed and not executed. */
const mutate = async (
    ctx: Context,
    command: string,
    args: string[],
    opts: { cwd?: string; logFile?: string } = {},
): Promise<RunResult> => {
    if (ctx.dryRun) {
        console.log(`  + ${command} ${args.map(a => (a.includes(" ") ? JSON.stringify(a) : a)).join(" ")}`)
        return { code: 0, stdout: "", stderr: "" }
    }
    return run(command, args, opts)
}

const git = (repo: string, ...args: string[]): Promise<RunResult> => run("git", ["-C", repo, ...args])

/**
 * Adds one of the throwaway worktrees — verify, PR — replacing whatever a previous run left
 * behind.
 *
 * These are scratch checkouts the script creates and removes within one step, so a leftover means
 * the run before this one died mid-step. `git worktree add` refuses an existing path, which on a
 * resumed run fails the step for a reason that has nothing to do with the work; and reusing the
 * directory is worse, since it may sit on a commit the branch has since moved past. Only the
 * per-ticket worktrees are deliberately long-lived, and they do not go through here.
 *
 * @param ctx - Run context, for dry-run handling.
 * @param worktree - Path to create.
 * @param branch - Branch to check out.
 * @returns Whether the worktree is ready to use.
 */
const freshWorktree = async (ctx: Context, worktree: string, branch: string): Promise<boolean> => {
    if (existsSync(worktree)) {
        await git(ctx.repo, "worktree", "remove", "--force", worktree)
    }
    const added = await mutate(ctx, "git", ["-C", ctx.repo, "worktree", "add", worktree, branch])
    if (added.code !== 0) {
        log(`could not create ${worktree}: ${added.stderr.trim()}`)
        return false
    }
    return true
}

/**
 * Removes every throwaway worktree a previous run left behind, before anything else runs.
 *
 * `freshWorktree` clears one as it is next needed, which is too late: a leftover verify worktree
 * holds the layer branch checked out, and git will neither check that branch out again nor
 * fast-forward it, so a merge that succeeds on GitHub leaves the local branch silently stale. The
 * per-ticket `t<n>` worktrees are deliberately long-lived and are never swept.
 *
 * @param ctx - Run context.
 */
const sweepScratchWorktrees = async (ctx: Context): Promise<void> => {
    const wt = join(ctx.runDir, "wt")
    if (!existsSync(wt)) {
        return
    }
    for (const name of readdirSync(wt)) {
        if (!name.startsWith("verify-") && !name.startsWith("pr-") && !name.startsWith("resolve-")) {
            continue
        }
        await git(ctx.repo, "worktree", "remove", "--force", join(wt, name))
        log(`swept a leftover worktree: ${name}`)
    }
    await git(ctx.repo, "worktree", "prune")
}

/** `gh-stack` cannot resolve a repo behind an `insteadOf` rewrite, so every gh call names it. */
const gh = (ctx: Context, args: string[]): Promise<RunResult> =>
    run("gh", [...args, "--repo", ctx.slug], { cwd: ctx.repo })

const ghMutate = (ctx: Context, args: string[]): Promise<RunResult> =>
    mutate(ctx, "gh", [...args, "--repo", ctx.slug], { cwd: ctx.repo })

const must = (result: RunResult, what: string): string => {
    if (result.code !== 0) {
        throw new Error(`${what} failed (${result.code}): ${(result.stderr || result.stdout).trim()}`)
    }
    return result.stdout.trim()
}

/** Lets the merge track sleep until the implement track has something for it. */
class Signal {
    private waiters: (() => void)[] = []

    wait(): Promise<void> {
        return new Promise(resolve => this.waiters.push(resolve))
    }

    notify(): void {
        const waiting = this.waiters
        this.waiters = []
        for (const resolve of waiting) {
            resolve()
        }
    }
}

// --- agents -------------------------------------------------------------------------------------

type AgentOptions = {
    cwd: string
    logFile: string
    sessionId?: string
    resume?: boolean
    jsonSchema?: string
}

/**
 * `--output-format stream-json` requires `--verbose` under `--print`, and writes the transcript as
 * it arrives — which is the difference between being able to say what an agent did and guessing.
 */
const runAgent = async (prompt: string, opts: AgentOptions): Promise<RunResult> => {
    const args = ["-p", prompt, ...CLAUDE_FLAGS]
    if (opts.jsonSchema !== undefined) {
        args.push("--output-format", "json", "--json-schema", opts.jsonSchema)
    } else {
        args.push("--output-format", "stream-json", "--verbose")
    }
    if (opts.sessionId !== undefined) {
        args.push(opts.resume === true ? "--resume" : "--session-id", opts.sessionId)
    }
    return run("claude", args, { cwd: opts.cwd, logFile: opts.logFile, detached: true })
}

// --- naming -------------------------------------------------------------------------------------

const slugify = (title: string): string =>
    title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48)

/**
 * Layers are `afk<spec>/layers/<n>` rather than `afk<spec>/layer<n>` because git cannot hold both
 * `refs/heads/…/layer1` and `refs/heads/…/layer1/53-x` — one would be a file, the other a directory.
 */
const layerBranch = (spec: number, index: number): string => `afk${spec}/layers/${index + 1}`

const ticketBranch = (spec: number, index: number, ticket: { number: number; title: string }): string =>
    `afk${spec}/layer${index + 1}/${ticket.number}-${slugify(ticket.title)}`

// --- manifest -----------------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const asTicket = (value: unknown, where: string): Ticket => {
    if (!isRecord(value)) {
        throw new Error(`${where}: expected an object`)
    }
    const { number, title, branch, blockedBy } = value
    if (typeof number !== "number") {
        throw new Error(`${where}: number must be a number`)
    }
    if (typeof title !== "string") {
        throw new Error(`${where}: title must be a string`)
    }
    if (typeof branch !== "string") {
        throw new Error(`${where}: branch must be a string`)
    }
    if (!Array.isArray(blockedBy) || blockedBy.some(entry => typeof entry !== "number")) {
        throw new Error(`${where}: blockedBy must be an array of numbers`)
    }
    return { number, title, branch, blockedBy: blockedBy.filter(entry => typeof entry === "number") }
}

const asManifest = (value: unknown): Manifest => {
    if (!isRecord(value)) {
        throw new Error("manifest: expected an object")
    }
    const { spec, trunk, layers } = value
    if (typeof spec !== "number") {
        throw new Error("manifest: spec must be a number")
    }
    if (typeof trunk !== "string") {
        throw new Error("manifest: trunk must be a string")
    }
    if (!Array.isArray(layers) || layers.length === 0) {
        throw new Error("manifest: layers must be non-empty")
    }
    return {
        spec,
        trunk,
        layers: layers.map((layer, index): Layer => {
            if (!isRecord(layer)) {
                throw new Error(`layer ${index}: expected an object`)
            }
            const { branch, tickets } = layer
            if (typeof branch !== "string") {
                throw new Error(`layer ${index}: branch must be a string`)
            }
            if (!Array.isArray(tickets) || tickets.length === 0) {
                throw new Error(`layer ${index}: tickets must be non-empty`)
            }
            return {
                branch,
                tickets: tickets.map((ticket, at) => asTicket(ticket, `layer ${index} ticket ${at}`)),
            }
        }),
    }
}

/** Branch names are the script's business. The fields stay in the schema so the manifest reads as a
 * complete description, but the canonical names always win. */
const normaliseBranches = (manifest: Manifest): Manifest => ({
    ...manifest,
    layers: manifest.layers.map((layer, index) => ({
        branch: layerBranch(manifest.spec, index),
        tickets: layer.tickets.map(ticket => ({
            ...ticket,
            branch: ticketBranch(manifest.spec, index, ticket),
        })),
    })),
})

const unwrapResult = (raw: string): unknown => {
    const envelope: unknown = JSON.parse(raw)
    const inner = isRecord(envelope) && "result" in envelope ? envelope.result : envelope
    return typeof inner === "string" ? JSON.parse(inner) : inner
}

// --- schema -------------------------------------------------------------------------------------

const readCommittedSchema = (): string => readFileSync(join(AFK_DIR, "schema.json"), "utf8")

/** Key-order and whitespace insensitive, so reformatting `schema.json` does not read as drift. */
const canonical = (value: unknown): string =>
    JSON.stringify(value, (_key, inner: unknown) =>
        isRecord(inner) ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => a.localeCompare(b))) : inner,
    )

const warnOnSchemaDrift = async (committed: string): Promise<void> => {
    try {
        const module: unknown = await import(pathToFileURL(join(AFK_DIR, "schema.ts")).href)
        if (!isRecord(module)) {
            return
        }
        const generate = module.manifestJsonSchema
        if (typeof generate !== "function") {
            return
        }
        if (canonical(generate()) !== canonical(JSON.parse(committed))) {
            log("WARNING: schema.json has drifted from schema.ts — regenerate it")
        }
    } catch {
        // zod not resolvable from here; the committed schema stands on its own.
    }
}

// --- state --------------------------------------------------------------------------------------

const statePath = (runDir: string): string => join(runDir, "state.json")

const saveState = (ctx: Context): void => {
    if (ctx.dryRun) {
        return
    }
    writeFileSync(statePath(ctx.runDir), `${JSON.stringify(ctx.state, null, 4)}\n`)
}

const ticketState = (ctx: Context, number: number): TicketState => {
    const found = ctx.state.tickets.find(entry => entry.number === number)
    if (!found) {
        throw new Error(`no state for ticket #${number}`)
    }
    return found
}

const setStatus = (ctx: Context, number: number, status: Status): void => {
    ticketState(ctx, number).status = status
    saveState(ctx)
}

const seedState = (ctx: Context, manifest: Manifest): void => {
    ctx.state.layers = manifest.layers.map(layer => ({ branch: layer.branch, status: "pending" }))
    ctx.state.tickets = manifest.layers.flatMap(layer =>
        layer.tickets.map(
            (ticket): TicketState => ({
                number: ticket.number,
                status: "pending",
                branch: ticket.branch,
                prNumber: null,
                sessionId: randomUUID(),
                worktree: join(ctx.runDir, "wt", `t${ticket.number}`),
            }),
        ),
    )
    saveState(ctx)
}

// --- preflight ----------------------------------------------------------------------------------

const preflight = async (ctx: Context): Promise<void> => {
    const extensions = await run("gh", ["extension", "list"], { cwd: ctx.repo })
    if (!extensions.stdout.includes("gh-stack")) {
        throw new Error("gh-stack is not installed — run: gh extension install github/gh-stack")
    }

    must(await git(ctx.repo, "fetch", "origin", ctx.trunk), "git fetch")
    const local = must(await git(ctx.repo, "rev-parse", ctx.trunk), "rev-parse")
    const remote = must(await git(ctx.repo, "rev-parse", `origin/${ctx.trunk}`), "rev-parse")
    if (local !== remote) {
        const ahead = must(await git(ctx.repo, "rev-list", "--count", `origin/${ctx.trunk}..${ctx.trunk}`), "rev-list")
        throw new Error(
            ahead === "0"
                ? `${ctx.trunk} is behind origin/${ctx.trunk} — pull before starting`
                : `${ctx.trunk} is ${ahead} commit(s) ahead of origin/${ctx.trunk} — push before starting.\n` +
                      "The remote trunk must contain the base or the root PR's diff is meaningless.",
        )
    }
}

/** Deletes every remote branch of this spec, closes any PR still open on them, and clears the run
 * directory. No prompt: the flag name is the consent. */
const forceFresh = async (ctx: Context): Promise<void> => {
    log(`--force-fresh: removing every afk${ctx.spec}/* remote branch and its open PRs`)
    const prs = await gh(ctx, [
        "pr",
        "list",
        "--state",
        "open",
        "--json",
        "number,headRefName",
        "--jq",
        `.[] | select(.headRefName | startswith("afk${ctx.spec}/")) | .number`,
    ])
    for (const number of prs.stdout.split("\n").filter(Boolean)) {
        await ghMutate(ctx, ["pr", "close", number, "--comment", "Superseded by a fresh afk run."])
    }
    const remote = await git(ctx.repo, "ls-remote", "--heads", "origin", `afk${ctx.spec}/*`)
    const branches = remote.stdout
        .split("\n")
        .filter(Boolean)
        .map(line => line.split("refs/heads/")[1])
        .filter((branch): branch is string => branch !== undefined)
    for (const branch of branches) {
        await mutate(ctx, "git", ["-C", ctx.repo, "push", "origin", "--delete", branch])
    }
    if (!ctx.dryRun) {
        rmSync(ctx.runDir, { recursive: true, force: true })
    }
    mkdirSync(join(ctx.runDir, "wt"), { recursive: true })
}

// --- planner ------------------------------------------------------------------------------------

const plannerPrompt = (spec: number, trunk: string): string =>
    [
        `Produce the implementation manifest for spec issue #${spec} in this repository.`,
        "",
        "Read, do not plan. Scope, granularity and dependency edges were already decided by the",
        "spec and its tickets. Your job is to recover the edges that GitHub's native issue",
        "dependencies do not carry, and to order what is already there.",
        "",
        "Steps:",
        "1. Read this repo's docs on its issue tracker and triage labels before anything else.",
        `2. List the sub-issues of #${spec}. Consider only the ones that are still open.`,
        "3. Skip any ticket whose labels mark it as needing a human rather than an agent.",
        "4. For each remaining ticket, read its body's `## Blocked by` section and resolve the",
        "   references to issue numbers. A ticket stating none is blocked by nothing.",
        "5. Sort the tickets into topological layers: layer 1 is every ticket with no open blocker,",
        "   layer 2 is everything unblocked once layer 1 is done, and so on. A ticket must never",
        "   share a layer with something it is blocked by.",
        "",
        `Use "${trunk}" as the trunk. Branch names are rewritten by the caller, so any placeholder`,
        "is fine. Return only the manifest.",
    ].join("\n")

const planManifest = async (ctx: Context, schema: string): Promise<Manifest> => {
    log(`planning spec #${ctx.spec}`)
    const result = await runAgent(plannerPrompt(ctx.spec, ctx.trunk), {
        cwd: ctx.repo,
        logFile: join(ctx.runDir, "planner.log"),
        jsonSchema: schema,
    })
    if (result.code !== 0) {
        throw new Error(`planner failed (${result.code}): ${result.stderr.trim()}`)
    }
    return normaliseBranches(asManifest(unwrapResult(result.stdout)))
}

// --- implement track ----------------------------------------------------------------------------

const implementPrompt = (ticket: Ticket): string =>
    [
        `/implement #${ticket.number}`,
        "",
        "Commit your work to the branch you are on. Do not push, do not open a pull request, and do",
        "not create merge commits — that is handled for you.",
        "",
        "The branch you are on is the base you were given. Never rebase, merge, pull or reset onto",
        "anything else, however stale the tree looks.",
    ].join("\n")

/**
 * Resuming is preferred for every failure: an agent that crashed mid-turn still holds its
 * reasoning, and one that finished without committing usually needs a nudge rather than a restart.
 * Which of the two an attempt *can* use is not a choice, though — see {@link implement}.
 */
type Failure = "crashed" | "no-commit" | "changed-base"

const implementOnce = async (ctx: Context, layer: Layer, ticket: Ticket, resume: boolean): Promise<Failure | null> => {
    const entry = ticketState(ctx, ticket.number)
    const logFile = join(ctx.runDir, `t${ticket.number}.log`)

    if (!existsSync(entry.worktree)) {
        const added = await mutate(ctx, "git", [
            "-C",
            ctx.repo,
            "worktree",
            "add",
            "-b",
            ticket.branch,
            entry.worktree,
            layer.branch,
        ])
        if (added.code !== 0) {
            log(`#${ticket.number} could not create a worktree: ${added.stderr.trim()}`)
            return "crashed"
        }
    }
    if (ctx.dryRun) {
        console.log(`  + claude -p "/implement #${ticket.number}" (in ${entry.worktree})`)
        return null
    }

    const session = await runAgent(implementPrompt(ticket), {
        cwd: entry.worktree,
        logFile,
        sessionId: entry.sessionId,
        resume,
    })

    if (session.code !== 0) {
        return "crashed"
    }
    // The commit is the only proof of work this script can read in an arbitrary repo — but it is
    // the branch's position against the layer, not HEAD moving during this invocation. A resumed
    // run finds the work already committed and the agent rightly refusing to invent a second
    // commit for content that has not changed; judging by HEAD movement calls that a failure and
    // fails a ticket that is in fact finished.
    const extra = must(await git(entry.worktree, "rev-list", "--count", `${layer.branch}..HEAD`), "rev-list")
    const behind = must(await git(entry.worktree, "rev-list", "--count", `HEAD..${layer.branch}`), "rev-list")
    if (Number(extra) === 0) {
        return "no-commit"
    }
    if (behind !== "0") {
        return "changed-base"
    }
    return null
}

const implement = async (ctx: Context, layer: Layer, ticket: Ticket): Promise<boolean> => {
    // `--session-id` refuses an id that already exists exactly as `--resume` refuses one that does
    // not, so the first attempt has to know which it is looking at. A ticket past `pending` has
    // been attempted before and its session exists; the retry flips the guess, so being wrong
    // costs one attempt instead of the ticket. Without this every resumed run burns an agent call
    // per ticket on `Session ID … is already in use.` before retrying into the answer.
    const attempted = ticketState(ctx, ticket.number).status !== "pending"
    log(`#${ticket.number} implementing`)
    setStatus(ctx, ticket.number, "implementing")

    const first = await implementOnce(ctx, layer, ticket, attempted)
    if (first === null) {
        setStatus(ctx, ticket.number, "implemented")
        log(`#${ticket.number} implemented`)
        return true
    }

    log(`#${ticket.number} ${first} — retrying (${attempted ? "fresh" : "resume"})`)
    const second = await implementOnce(ctx, layer, ticket, !attempted)
    if (second === null) {
        setStatus(ctx, ticket.number, "implemented")
        log(`#${ticket.number} implemented on retry`)
        return true
    }

    setStatus(ctx, ticket.number, "failed")
    log(`#${ticket.number} FAILED (${second}) — worktree kept at ${ticketState(ctx, ticket.number).worktree}`)
    return false
}

// --- merge track --------------------------------------------------------------------------------

/** Merging is eventually consistent: GitHub recomputes mergeability after every push, and a merge
 * attempted against a stale answer fails for reasons that are not conflicts. */
const settledMergeable = async (ctx: Context, branch: string): Promise<string> => {
    for (let attempt = 0; attempt < 30; attempt++) {
        const view = await gh(ctx, ["pr", "view", branch, "--json", "mergeable", "--jq", ".mergeable"])
        const state = view.stdout.trim()
        if (state !== "" && state !== "UNKNOWN") {
            return state
        }
        await sleep(3000)
    }
    return "UNKNOWN"
}

/**
 * Merges the layer branch into a conflicting ticket and has an agent resolve it.
 *
 * Runs in the **ticket's own worktree**, not a scratch one. Git refuses to check a branch out
 * twice, and the ticket's worktree is holding this branch for the life of the run, so a second
 * checkout of it cannot exist. That constraint turns out to be the better arrangement anyway: the
 * worktree the implementer used is already installed and warm, so the resolver can run the repo's
 * checks on what it just merged rather than resolving blind in a bare checkout.
 *
 * @param ctx - Run context.
 * @param layer - Layer whose branch is being merged in.
 * @param ticket - Ticket to resolve.
 * @returns The agent's notes on what it chose (possibly empty), or null when the conflict is
 *   unresolved and the merge has been rolled back.
 */
const resolveConflict = async (ctx: Context, layer: Layer, ticket: Ticket): Promise<string | null> => {
    const worktree = ticketState(ctx, ticket.number).worktree
    const notes = join(ctx.runDir, `t${ticket.number}.resolution.md`)
    log(`#${ticket.number} conflicted — resolving`)

    if (ctx.dryRun) {
        console.log(`  + claude -p "/mattpocock-skills:resolving-merge-conflicts" (in ${worktree})`)
        return ""
    }

    // Merging into a dirty tree buries the agent's conflict in whatever was already uncommitted,
    // and the abort below would throw that away with it.
    const dirty = must(await git(worktree, "status", "--porcelain"), "status")
    if (dirty !== "") {
        log(`#${ticket.number} cannot resolve — ${worktree} has uncommitted changes`)
        return null
    }

    await git(worktree, "fetch", "origin", layer.branch)
    await git(worktree, "merge", "FETCH_HEAD")

    const session = await runAgent(
        [
            "/mattpocock-skills:resolving-merge-conflicts",
            "",
            `When the merge is complete, write a short summary of the trade-offs you picked to ${notes}.`,
            "One line per hunk you had to choose between. Do not push.",
        ].join("\n"),
        { cwd: worktree, logFile: join(ctx.runDir, `t${ticket.number}.log`) },
    )
    const unmerged = must(await git(worktree, "diff", "--name-only", "--diff-filter=U"), "diff")

    if (session.code !== 0 || unmerged !== "") {
        log(`#${ticket.number} resolution FAILED — aborting the merge`)
        await git(worktree, "merge", "--abort")
        return null
    }

    await git(ctx.repo, "push", "--force-with-lease", "origin", ticket.branch)
    return existsSync(notes) ? readFileSync(notes, "utf8").trim() : ""
}

const mergeTicket = async (ctx: Context, layer: Layer, ticket: Ticket): Promise<boolean> => {
    const entry = ticketState(ctx, ticket.number)
    const pushed = await mutate(ctx, "git", ["-C", ctx.repo, "push", "-u", "origin", ticket.branch])
    if (pushed.code !== 0) {
        log(`#${ticket.number} could not push: ${pushed.stderr.trim()}`)
        setStatus(ctx, ticket.number, "failed")
        return false
    }
    const created = await ghMutate(ctx, [
        "pr",
        "create",
        "--base",
        layer.branch,
        "--head",
        ticket.branch,
        "--title",
        ticket.title,
        "--body",
        `Part of #${ctx.spec}.`,
    ])
    // `gh pr create` prints the PR's URL; its trailing number is what a resumed run asks about.
    const opened = /\/pull\/(\d+)/.exec(created.stdout)?.[1]
    if (opened !== undefined) {
        entry.prNumber = Number(opened)
        saveState(ctx)
    }

    if (!ctx.dryRun && (await settledMergeable(ctx, ticket.branch)) === "CONFLICTING") {
        const resolution = await resolveConflict(ctx, layer, ticket)
        if (resolution === null) {
            log(`#${ticket.number} left open — conflict unresolved`)
            setStatus(ctx, ticket.number, "failed")
            return false
        }
        if (resolution !== "") {
            await ghMutate(ctx, ["pr", "comment", ticket.branch, "--body", resolution])
        }
        await settledMergeable(ctx, ticket.branch)
    }

    // The ticket PR squashes with GitHub's default body: the implementer's own commit messages.
    // No `Closes` line here — only the layer PR reaches the trunk, so a ticket-level one never fires.
    if (ctx.dryRun) {
        await ghMutate(ctx, ["pr", "merge", ticket.branch, "--squash"])
        await mutate(ctx, "git", ["-C", ctx.repo, "push", "origin", "--delete", ticket.branch])
        return true
    }
    for (let attempt = 1; attempt <= 4; attempt++) {
        const merged = await ghMutate(ctx, ["pr", "merge", ticket.branch, "--squash"])
        if (merged.code === 0) {
            // Git refuses to fast-forward a branch that some worktree has checked out, so this can
            // fail while the merge itself succeeded. Saying nothing leaves the local layer branch
            // behind its remote, and every later `behind` count computed against it is wrong.
            const synced = await mutate(ctx, "git", [
                "-C",
                ctx.repo,
                "fetch",
                "origin",
                `${layer.branch}:${layer.branch}`,
            ])
            if (synced.code !== 0) {
                log(`${layer.branch} is behind its remote — ${synced.stderr.trim()}`)
            }
            await mutate(ctx, "git", ["-C", ctx.repo, "push", "origin", "--delete", ticket.branch])
            setStatus(ctx, ticket.number, "merged")
            log(`#${ticket.number} merged`)
            return true
        }
        if (attempt === 4) {
            log(`#${ticket.number} left open — squash-merge failed: ${merged.stderr.trim()}`)
            break
        }
        await sleep(attempt * 4000)
        await settledMergeable(ctx, ticket.branch)
    }
    setStatus(ctx, ticket.number, "failed")
    return false
}

// --- verification -------------------------------------------------------------------------------

const verifyPrompt = (verdict: string): string =>
    [
        "Every ticket of this layer is now merged into the branch you are on. Verify the assembled",
        "result — not any one ticket, but what they add up to.",
        "",
        "1. Read this repository's own documentation to find what verifies it: CLAUDE.md, AGENTS.md,",
        "   CONTRIBUTING.md, the package manifest's scripts.",
        "2. Run every check it names.",
        "3. Fix anything this layer broke. Tickets that never touched the same file can still break",
        "   each other — one moving what another imported, for instance.",
        "",
        "Fix the cause, never the signal. Do not delete or skip a failing test, do not loosen a type,",
        "do not disable a lint rule, do not comment anything out. Give it your all: a real fix is",
        "worth considerable effort, and a workaround is worth none.",
        "",
        "Commit your fix as a single commit. Do not push.",
        "",
        `Then write ${verdict} as JSON: {"ok": true|false, "summary": "one paragraph"}.`,
        `"ok" is true only if every check passes. If you could not fix the cause, say so in the`,
        "summary and set ok to false rather than committing a workaround.",
    ].join("\n")

const verifyLayer = async (ctx: Context, layer: Layer, index: number): Promise<boolean> => {
    const worktree = join(ctx.runDir, "wt", `verify-layer-${index + 1}`)
    const verdict = join(ctx.runDir, `layer-${index + 1}.verify.json`)
    log(`layer ${index + 1}: verifying the assembled result`)

    if (!(await freshWorktree(ctx, worktree, layer.branch))) {
        return false
    }
    if (ctx.dryRun) {
        console.log(`  + claude -p "<verify layer ${index + 1}>" (in ${worktree})`)
        return true
    }

    const before = must(await git(worktree, "rev-parse", "HEAD"), "rev-parse")
    const session = await runAgent(verifyPrompt(verdict), {
        cwd: worktree,
        logFile: join(ctx.runDir, `layer-${index + 1}.log`),
    })
    const after = must(await git(worktree, "rev-parse", "HEAD"), "rev-parse")
    if (after !== before) {
        await git(ctx.repo, "push", "origin", `${layer.branch}`)
    }

    let ok = false
    let summary = "the verification agent left no verdict"
    if (existsSync(verdict)) {
        const parsed: unknown = JSON.parse(readFileSync(verdict, "utf8"))
        if (isRecord(parsed)) {
            ok = parsed.ok === true
            if (typeof parsed.summary === "string") {
                summary = parsed.summary
            }
        }
    }
    await git(ctx.repo, "worktree", "remove", "--force", worktree)
    if (session.code !== 0) {
        ok = false
    }
    log(`layer ${index + 1} verification: ${ok ? "clean" : `FAILED — ${summary}`}`)
    return ok
}

// --- layer pull request -------------------------------------------------------------------------

const layerPrPrompt = (spec: number, index: number, file: string): string =>
    [
        `The branch you are on holds layer ${index + 1} of spec #${spec}, already merged and verified.`,
        "",
        "Write the pull request's title and an opening summary for it.",
        "",
        "The title must follow whatever commit convention this repository documents — read it first —",
        "because this PR is squash-merged, so its title becomes a commit on the trunk. One type must",
        "cover every ticket in the layer; pick the one that describes the whole honestly.",
        "",
        "The summary is prose for a colleague who was not here: what changed and why, a few short",
        "paragraphs. Do not list the commits — that is appended for you. Do not invent motivation.",
        "",
        `Write ${file} as JSON: {"title": "...", "summary": "..."}.`,
    ].join("\n")

const openLayerPr = async (ctx: Context, layer: Layer, index: number, base: string, from: string): Promise<void> => {
    const file = join(ctx.runDir, `layer-${index + 1}.pr.json`)
    const merged = layer.tickets.filter(ticket => ticketState(ctx, ticket.number).status === "merged")

    let title = `chore: spec #${ctx.spec}, layer ${index + 1}`
    let summary = ""
    if (!ctx.dryRun) {
        const worktree = join(ctx.runDir, "wt", `pr-layer-${index + 1}`)
        await freshWorktree(ctx, worktree, layer.branch)
        await runAgent(layerPrPrompt(ctx.spec, index, file), {
            cwd: worktree,
            logFile: join(ctx.runDir, `layer-${index + 1}.log`),
        })
        await git(ctx.repo, "worktree", "remove", "--force", worktree)
        if (existsSync(file)) {
            const parsed: unknown = JSON.parse(readFileSync(file, "utf8"))
            if (isRecord(parsed)) {
                if (typeof parsed.title === "string") {
                    title = parsed.title
                }
                if (typeof parsed.summary === "string") {
                    summary = parsed.summary
                }
            }
        }
    }

    // `--body` replaces GitHub's concatenation rather than appending to it, so compose the whole
    // body here: the prose, then each squashed ticket commit, then the closes the script owns.
    const commits = ctx.dryRun ? "" : must(await git(ctx.repo, "log", "--format=%B", `${from}..${layer.branch}`), "log")
    const body = [summary, commits, merged.map(ticket => `Closes #${ticket.number}`).join("\n")]
        .filter(part => part.trim() !== "")
        .join("\n\n---\n\n")

    await ghMutate(ctx, ["pr", "create", "--base", base, "--head", layer.branch, "--title", title, "--body", body])
    log(`layer ${index + 1} PR opened: ${title}`)
}

// --- layer --------------------------------------------------------------------------------------

const runLayer = async (ctx: Context, layer: Layer, index: number, from: string): Promise<boolean> => {
    const skip = new Set(
        layer.tickets
            .filter(ticket => ticket.blockedBy.some(blocker => ticketState(ctx, blocker).status !== "merged"))
            .map(ticket => ticket.number),
    )
    for (const number of skip) {
        setStatus(ctx, number, "skipped")
        log(`#${number} skipped — a ticket it is blocked by did not land`)
    }

    const pending = layer.tickets.filter(
        ticket => !skip.has(ticket.number) && ticketState(ctx, ticket.number).status !== "merged",
    )
    log(`layer ${index + 1}: ${pending.length} ticket(s), branch ${layer.branch} off ${from}`)
    if (pending.length === 0) {
        return true
    }

    await mutate(ctx, "git", ["-C", ctx.repo, "branch", layer.branch, from])
    await mutate(ctx, "git", ["-C", ctx.repo, "push", "-u", "origin", layer.branch])

    const queue = [...pending]
    const ready: Ticket[] = []
    const signal = new Signal()
    let implementing = true

    const implementTrack = async (): Promise<void> => {
        await Promise.all(
            Array.from({ length: Math.min(ctx.maxParallel, queue.length) }, async () => {
                for (;;) {
                    if (stopping) {
                        return
                    }
                    const ticket = queue.shift()
                    if (!ticket) {
                        return
                    }
                    if (await implement(ctx, layer, ticket)) {
                        ready.push(ticket)
                    }
                    signal.notify()
                }
            }),
        )
        implementing = false
        signal.notify()
    }

    const mergeTrack = async (): Promise<void> => {
        for (;;) {
            const ticket = ready.shift()
            if (!ticket) {
                if (!implementing) {
                    return
                }
                await signal.wait()
                continue
            }
            await mergeTicket(ctx, layer, ticket)
        }
    }

    await Promise.all([implementTrack(), mergeTrack()])
    if (stopping) {
        return false
    }

    if (!(await verifyLayer(ctx, layer, index))) {
        ctx.state.layers[index] = { branch: layer.branch, status: "failed" }
        saveState(ctx)
        return false
    }
    ctx.state.layers[index] = { branch: layer.branch, status: "verified" }
    saveState(ctx)
    await openLayerPr(ctx, layer, index, from.startsWith("origin/") ? ctx.trunk : from, from)
    log(`layer ${index + 1} done`)
    return true
}

// --- entry --------------------------------------------------------------------------------------

const main = async (): Promise<void> => {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            "max-parallel": { type: "string", default: "3" },
            "dry-run": { type: "boolean", default: false },
            resume: { type: "boolean", default: false },
            "force-fresh": { type: "boolean", default: false },
        },
    })
    const spec = Number(positionals[0])
    if (!Number.isInteger(spec) || spec <= 0) {
        console.error("usage: node afk/main.ts <spec-issue> [--max-parallel 3] [--dry-run] [--resume | --force-fresh]")
        process.exit(2)
    }

    const repo = must(await run("git", ["rev-parse", "--show-toplevel"]), "git rev-parse")
    const slug = must(
        await run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], { cwd: repo }),
        "gh repo view",
    )
    const trunk = must(
        await run("gh", ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"], {
            cwd: repo,
        }),
        "gh repo view",
    )
    const runDir = join(repo, ".afk", String(spec))
    const ctx: Context = {
        repo,
        slug,
        spec,
        trunk,
        runDir,
        maxParallel: Math.max(1, Number(values["max-parallel"]) || 3),
        dryRun: values["dry-run"] === true,
        state: { spec, trunk, layers: [], tickets: [] },
    }
    mkdirSync(join(runDir, "wt"), { recursive: true })

    const resuming = values.resume === true
    const hasState = existsSync(statePath(runDir))
    if (values["force-fresh"] === true) {
        await forceFresh(ctx)
    } else if (hasState && !resuming) {
        throw new Error(
            `.afk/${spec}/state.json exists from an earlier run.\n` +
                "Pass --resume to continue it, or --force-fresh to delete this spec's branches and PRs and start over.",
        )
    } else if (!hasState && resuming) {
        throw new Error(`--resume was passed but .afk/${spec}/state.json does not exist`)
    }

    await sweepScratchWorktrees(ctx)
    await preflight(ctx)
    const schema = readCommittedSchema()
    await warnOnSchemaDrift(schema)

    // A resumed run reuses the manifest and never re-plans: re-planning would produce different
    // layers as tickets close underneath it.
    const manifestFile = join(runDir, "manifest.json")
    const manifest =
        resuming && existsSync(manifestFile)
            ? normaliseBranches(asManifest(JSON.parse(readFileSync(manifestFile, "utf8"))))
            : await planManifest(ctx, schema)
    if (!resuming) {
        writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 4)}\n`)
    }

    if (resuming && hasState) {
        ctx.state = JSON.parse(readFileSync(statePath(runDir), "utf8")) as State
        log(`resuming: ${ctx.state.tickets.filter(t => t.status === "merged").length} ticket(s) already merged`)
    } else {
        seedState(ctx, manifest)
    }

    log(`manifest: ${manifest.layers.length} layer(s), ${manifest.layers.flatMap(l => l.tickets).length} ticket(s)`)
    for (const [index, layer] of manifest.layers.entries()) {
        log(`  layer ${index + 1}: ${layer.tickets.map(t => `#${t.number}`).join(" ")}`)
    }

    let from = `origin/${ctx.trunk}`
    for (const [index, layer] of manifest.layers.entries()) {
        if (stopping) {
            break
        }
        if (!(await runLayer(ctx, layer, index, from))) {
            throw new Error(
                `layer ${index + 1} did not complete. Every layer above it would build on a broken base.\n` +
                    `Fix it, then re-run with --resume.`,
            )
        }
        from = layer.branch
    }

    if (stopping) {
        log("stopped after the interrupt. Re-run with --resume to continue.")
        return
    }

    const linked = await ghMutate(ctx, ["stack", "link", ...manifest.layers.map(layer => layer.branch)])
    if (linked.code !== 0) {
        throw new Error(`gh stack link failed (${linked.code}): ${linked.stderr.trim()}`)
    }
    log(`done — stack rooted at ${manifest.layers[0]?.branch}`)
}

main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
})
