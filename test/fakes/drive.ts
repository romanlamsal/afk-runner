import type { DriveRun } from "../../src/service/drive.ts"

/**
 * A driver that works no slate, for tests about everything that happens before one is worked. The
 * driving port is stubbed rather than faked: there is no port contract to keep honest here, only a
 * use case a test does not want to invoke.
 */
export const createStubDrive = (): DriveRun => async () => ({
    outcome: "done",
    reason: undefined,
    progress: { verified: [], unverified: [], failed: [], skipped: [] },
})
