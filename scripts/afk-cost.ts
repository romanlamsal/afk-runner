#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { z } from "zod"

/**
 * What a run cost: the tokens a run's transcripts account for, summed per issue, priced in USD.
 *
 * It is not part of afk and nothing of afk's calls it — a second developer tool beside
 * `replay/`. A run's transcripts are the only record of what the agents spent, and the number
 * that matters is per issue: which ticket was expensive, and whether a resolve pass doubled it.
 *
 * It reads and it prints, and it writes nothing anywhere.
 *
 * **Where the tokens come from.** The `result` event's `modelUsage` — the session's final
 * per-model accounting — and not the `usage` on each `assistant` event. That one is the
 * `message_start` snapshot: `output_tokens` is 1-3 there, and streaming repeats the identical
 * block once per content block, so summing it under-reports output by two orders of magnitude.
 *
 * The assistant events are still read, for one field `modelUsage` drops: cache writes split by
 * TTL. A 1h write is priced at twice the input rate and a 5m write at 1.25x, so the split has to
 * come from somewhere, and the per-message cache fields are final even when the output count is
 * not.
 */

/** $ per 1M tokens, first-party list pricing. */
type ModelPrice = { readonly input: number; readonly output: number }

const PRICES: Readonly<Record<string, ModelPrice>> = {
    "claude-opus-5-5": { input: 4, output: 20 },
    "claude-opus-5": { input: 5, output: 25 },
    "claude-sonnet-5": { input: 2, output: 10 },
    "claude-haiku-4-5": { input: 1, output: 5 },
}

/** Cache multipliers, applied to the model's input rate. */
const CACHE_WRITE_5M = 1.25
const CACHE_WRITE_1H = 2
const CACHE_READ = 0.1

/** `claude-haiku-4-5-20251001` → `claude-haiku-4-5`, which is how the table above is keyed. */
/** `claude-haiku-4-5-20251001` → `claude-haiku-4-5`, which is how the table above is keyed. */
const canonicalModel = (model: string): string => model.replace(/-\d{8}$/, "")

const assistantEvent = z.object({
    type: z.literal("assistant"),
    request_id: z.string(),
    message: z.object({
        model: z.string(),
        usage: z.object({
            cache_creation: z
                .object({
                    ephemeral_5m_input_tokens: z.number().default(0),
                    ephemeral_1h_input_tokens: z.number().default(0),
                })
                .optional(),
        }),
    }),
})

const resultEvent = z.object({
    type: z.literal("result"),
    total_cost_usd: z.number(),
    modelUsage: z.record(
        z.string(),
        z.object({
            inputTokens: z.number(),
            outputTokens: z.number(),
            cacheReadInputTokens: z.number(),
            cacheCreationInputTokens: z.number(),
        }),
    ),
})

const pricedEvent = z.discriminatedUnion("type", [assistantEvent, resultEvent])

type Usage = {
    readonly input: number
    readonly output: number
    readonly cacheRead: number
    readonly cacheWrite5m: number
    readonly cacheWrite1h: number
}

const NOTHING: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }

const add = (a: Usage, b: Usage): Usage => ({
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
})

const totalTokens = (usage: Usage): number =>
    usage.input + usage.output + usage.cacheRead + usage.cacheWrite5m + usage.cacheWrite1h

/** Unknown models are named rather than guessed at: a wrong price is worse than no total. */
const costOf = (model: string, usage: Usage): number => {
    const price = PRICES[canonicalModel(model)]
    if (price === undefined) {
        throw new Error(`no price known for model ${model}`)
    }

    const perInputToken = price.input / 1_000_000
    return (
        usage.input * perInputToken +
        usage.cacheWrite5m * perInputToken * CACHE_WRITE_5M +
        usage.cacheWrite1h * perInputToken * CACHE_WRITE_1H +
        usage.cacheRead * perInputToken * CACHE_READ +
        (usage.output * price.output) / 1_000_000
    )
}

/**
 * The transcripts of one session, named by what it was working on: `#44` for a ticket,
 * `planner` or `pull-request` for the phases that stand outside the tickets.
 *
 * `reportedCostUsd` is the runner's own figure, kept only to check the price table against —
 * it is the one number here that is not derived from tokens.
 */
type Transcript = {
    readonly label: string
    readonly byModel: ReadonlyMap<string, Usage>
    readonly reportedCostUsd: number
}

/** `20260918T075017158Z-t44-implement-1.jsonl` → `#44`; the other phases keep their name. */
const labelOf = (path: string): string => {
    const name = basename(path, ".jsonl").replace(/^\d{8}T\d{9}Z-/, "")
    const ticket = name.match(/^t(\d+)-/)?.[1]
    return ticket === undefined ? name : `#${ticket}`
}

/** Cache-write tokens of one model, split by the TTL they were written under. */
type TtlSplit = { ephemeral5m: number; ephemeral1h: number }

/**
 * A line that does not parse is dropped rather than failing everything before it, as the run's
 * own log reader does (ADR-0011): a transcript is a stream of many event shapes and only two of
 * them carry tokens.
 */
const parseTranscript = async (path: string): Promise<Transcript> => {
    const contents = await readFile(path, "utf8")

    const ttlByModel = new Map<string, TtlSplit>()
    const countedRequests = new Set<string>()
    const byModel = new Map<string, Usage>()
    let reportedCostUsd = 0

    for (const line of contents.split("\n")) {
        if (line.trim() === "") {
            continue
        }

        let event: z.infer<typeof pricedEvent>
        try {
            const parsed = pricedEvent.safeParse(JSON.parse(line))
            if (!parsed.success) {
                continue
            }
            event = parsed.data
        } catch {
            continue
        }

        if (event.type === "assistant") {
            // Streaming repeats one event per content block, all carrying the same cumulative
            // usage. Each API request counts once.
            if (countedRequests.has(event.request_id)) {
                continue
            }
            countedRequests.add(event.request_id)

            const creation = event.message.usage.cache_creation
            if (creation === undefined) {
                continue
            }
            const split = ttlByModel.get(event.message.model) ?? { ephemeral5m: 0, ephemeral1h: 0 }
            split.ephemeral5m += creation.ephemeral_5m_input_tokens
            split.ephemeral1h += creation.ephemeral_1h_input_tokens
            ttlByModel.set(event.message.model, split)
            continue
        }

        reportedCostUsd += event.total_cost_usd
        for (const [model, usage] of Object.entries(event.modelUsage)) {
            const split = ttlByModel.get(model)
            const observed = (split?.ephemeral5m ?? 0) + (split?.ephemeral1h ?? 0)
            // Nothing observed means nothing to apportion; charging the higher rate keeps the
            // total honest rather than flattering.
            const share1h = observed === 0 ? 1 : (split?.ephemeral1h ?? 0) / observed

            byModel.set(
                model,
                add(byModel.get(model) ?? NOTHING, {
                    input: usage.inputTokens,
                    output: usage.outputTokens,
                    cacheRead: usage.cacheReadInputTokens,
                    cacheWrite1h: usage.cacheCreationInputTokens * share1h,
                    cacheWrite5m: usage.cacheCreationInputTokens * (1 - share1h),
                }),
            )
        }
    }

    return { label: labelOf(path), byModel, reportedCostUsd }
}

const print = (line: string): void => {
    process.stdout.write(`${line}\n`)
}

const printError = (line: string): void => {
    process.stderr.write(`${line}\n`)
}

const usd = (amount: number): string => `$${amount.toFixed(4)}`
const tokens = (count: number): string => Math.round(count).toLocaleString("en-US")

const LABEL_WIDTH = 14
const CELL_WIDTH = 12
const HEADINGS = ["tokens", "input", "cache w", "cache r", "output", "cost"] as const

const row = (label: string, cells: readonly string[]): string =>
    label.padEnd(LABEL_WIDTH) + cells.map(cell => cell.padStart(CELL_WIDTH)).join("")

const cellsFor = (usage: Usage, cost: number): readonly string[] => [
    tokens(totalTokens(usage)),
    tokens(usage.input),
    tokens(usage.cacheWrite5m + usage.cacheWrite1h),
    tokens(usage.cacheRead),
    tokens(usage.output),
    usd(cost),
]

const RULE = "-".repeat(LABEL_WIDTH + HEADINGS.length * CELL_WIDTH)

const USAGE = "usage: node scripts/afk-cost.ts <run-dir>    e.g. node scripts/afk-cost.ts .afk/43"

const main = async (runDir: string | undefined): Promise<number> => {
    if (runDir === undefined) {
        printError(USAGE)
        return 1
    }

    const transcriptDir = join(runDir, "transcripts")
    const names = await readdir(transcriptDir).catch(() => undefined)
    if (names === undefined) {
        printError(`no transcripts at ${transcriptDir}`)
        return 1
    }

    const transcripts = await Promise.all(
        names
            .filter(name => name.endsWith(".jsonl"))
            .sort()
            .map(name => parseTranscript(join(transcriptDir, name))),
    )
    if (transcripts.length === 0) {
        printError(`no transcripts at ${transcriptDir}`)
        return 1
    }

    // One issue can span several sessions — an implement pass and the resolve pass after it.
    const byLabel = new Map<string, Transcript[]>()
    for (const transcript of transcripts) {
        byLabel.set(transcript.label, [...(byLabel.get(transcript.label) ?? []), transcript])
    }

    print(`run: ${runDir}\n`)
    print(row("issue", HEADINGS))
    print(RULE)

    let runUsage = NOTHING
    let runCost = 0
    let runReported = 0

    for (const [label, sessions] of byLabel) {
        let usage = NOTHING
        let cost = 0
        for (const session of sessions) {
            for (const [model, modelUsage] of session.byModel) {
                usage = add(usage, modelUsage)
                cost += costOf(model, modelUsage)
            }
            runReported += session.reportedCostUsd
        }
        runUsage = add(runUsage, usage)
        runCost += cost
        print(row(label, cellsFor(usage, cost)))
    }

    print(RULE)
    print(row("TOTAL", cellsFor(runUsage, runCost)))

    const byModel = new Map<string, Usage>()
    for (const transcript of transcripts) {
        for (const [model, usage] of transcript.byModel) {
            byModel.set(model, add(byModel.get(model) ?? NOTHING, usage))
        }
    }

    print("\nper model:")
    const dearestFirst = [...byModel].sort(([aModel, a], [bModel, b]) => costOf(bModel, b) - costOf(aModel, a))
    for (const [model, usage] of dearestFirst) {
        print(
            `  ${model.padEnd(30)}${tokens(totalTokens(usage)).padStart(CELL_WIDTH)} tok${usd(costOf(model, usage)).padStart(CELL_WIDTH)}`,
        )
    }

    // The price table is a copy of someone else's published numbers, so it is checked against the
    // runner's own figure on every run. Drift means the table has gone stale.
    const drift = runCost - runReported
    const percent = runReported === 0 ? 0 : (drift / runReported) * 100
    print(`\nrunner-reported: ${usd(runReported)} (drift ${usd(drift)}, ${percent.toFixed(3)}%)`)

    return 0
}

process.exitCode = await main(process.argv[2])
