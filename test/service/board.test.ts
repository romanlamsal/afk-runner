import { describe, expect, it } from "vitest"
import type { LifecycleEvent } from "../../src/domain/events.ts"
import { createShowBoardService } from "../../src/service/board.ts"
import type { WatchBoard } from "../../src/service/watch.ts"
import { createFakeGit } from "../fakes/git.ts"
import { createFakeInterrupts } from "../fakes/interrupts.ts"
import { createFakeManifestStore } from "../fakes/manifest-store.ts"
import { manifestOf, ticket } from "../fixtures/manifest.ts"

/**
 * The viewer against its ports. What it draws is the `--board-only` flow's; what is asserted here is
 * how it answers the operator's Ctrl-C: it drains nothing, so the first one quits (ADR-0041).
 */
const MANIFEST = manifestOf([ticket(5)])

/** The spec the viewer is pointed at. */
const SPEC = 4

/**
 * A watch of a run that never concludes: it ends when it is stopped from outside, and not before —
 * even where it was stopped before it started, as the real one does.
 */
const endlessWatch: WatchBoard = (_target, { signal } = {}) =>
    new Promise<readonly LifecycleEvent[]>(resolve => {
        if (signal?.aborted === true) {
            resolve([])
        }
        signal?.addEventListener("abort", () => resolve([]), { once: true })
    })

const harness = () => {
    const interrupts = createFakeInterrupts()
    const showBoard = createShowBoardService({
        cwd: "/repo",
        git: createFakeGit().git,
        manifests: createFakeManifestStore({ ok: true, manifest: MANIFEST }).store,
        interrupts: interrupts.interrupts,
        watch: endlessWatch,
    })
    return { showBoard, interrupts }
}

describe("createShowBoardService", () => {
    it("should end the watch on the first interrupt", async () => {
        // given
        const { showBoard, interrupts } = harness()
        const shown = showBoard(SPEC)

        // when
        interrupts.interrupt()

        // then
        await expect(shown).resolves.toEqual({ outcome: "shown", whole: false })
    })

    it("should not drain on the first interrupt", () => {
        // given
        const { showBoard, interrupts } = harness()
        void showBoard(SPEC)

        // when
        interrupts.interrupt()

        // then
        expect(interrupts.interrupts.draining()).toBe(false)
    })
})
