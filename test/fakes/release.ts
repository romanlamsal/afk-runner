import type { ReleaseRun } from "../../src/service/release.ts"

/**
 * A release that lets go of nothing, for the tests whose invocation takes no lock worth asserting
 * about. The driving port is stubbed rather than faked: there is no port contract to keep honest
 * here, only a use case a test does not want to invoke.
 */
export const createStubRelease = (): ReleaseRun => async () => {
    // Nothing was taken, so nothing is given back.
}
