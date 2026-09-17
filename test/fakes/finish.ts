import type { FinishRun } from "../../src/service/finish.ts"

/**
 * A finish that opens nothing, for tests about everything that happens before a run ends. The
 * driving port is stubbed rather than faked: there is no port contract to keep honest here, only a
 * use case a test does not want to invoke.
 */
export const createStubFinish = (): FinishRun => async () => ({
    outcome: "failed",
    reason: "this run was not taken as far as a pull request",
})
