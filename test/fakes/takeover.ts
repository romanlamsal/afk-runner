import { refusalToShare } from "../../src/domain/lock.ts"
import type { TakeOver } from "../../src/service/takeover.ts"
import type { FakeRunLock } from "./run-lock.ts"

/**
 * The takeover service's driving port. An operator who accepts sees the holder go, as the real
 * service's interrupts make it go; one who declines, or who was never asked, gets the refusal.
 */
export const createFakeTakeOver =
    (lock: FakeRunLock, accepts = false): TakeOver =>
    async (_root, spec, holder) => {
        if (!accepts) {
            return { outcome: "refused", reason: refusalToShare(spec, holder) }
        }
        lock.die(holder.pid)
        return { outcome: "freed" }
    }
