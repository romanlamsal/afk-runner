import { describeRunLockContract } from "../contract/run-lock.ts"
import { createFakeRunLock } from "./run-lock.ts"

/**
 * The fake half of the run lock's contract. The other half runs the same suite against the lock file
 * (`test/repository/run-lock.contract.integration.test.ts`).
 */
describeRunLockContract("the run lock fake", async () => {
    const fake = createFakeRunLock()
    fake.die(3)
    return { lock: fake.lock, root: "/repo", spec: 4, self: { pid: 1 }, live: { pid: 2 }, dead: { pid: 3 } }
})
