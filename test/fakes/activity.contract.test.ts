import { describeActivityContract } from "../contract/activity.ts"
import { createFakeActivity } from "./activity.ts"

/**
 * The fake half of the activity port's contract. The other half runs the same suite against the run
 * directory on disk (`test/repository/activity.contract.integration.test.ts`).
 */
describeActivityContract("the activity fake", async () => {
    const fake = createFakeActivity()
    return {
        activity: fake.activity,
        root: "/repo",
        write: async (path, _writer, at) => {
            fake.write(path, at)
        },
        // A record with no instant is one the fake never hears of.
        unstamped: async () => undefined,
    }
})
