import type { WatchBoard, WatchTarget } from "../../src/service/watch.ts"

export type FakeWatch = {
    watch: WatchBoard
    /** Every run a watch was started on, oldest first. */
    watched: WatchTarget[]
    /** Every run whose watch was stopped from outside, oldest first. */
    stopped: WatchTarget[]
}

/**
 * A watch that draws nothing and runs until it is stopped, which is all a test of whoever drives it
 * needs: what the watch draws is the watch's own suite.
 */
export const createFakeWatch = (): FakeWatch => {
    const watched: WatchTarget[] = []
    const stopped: WatchTarget[] = []
    return {
        watched,
        stopped,
        watch: async (target, { signal } = {}) => {
            watched.push(target)
            if (signal !== undefined && !signal.aborted) {
                await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }))
            }
            stopped.push(target)
            return []
        },
    }
}
