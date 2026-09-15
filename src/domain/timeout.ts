/**
 * One hour, for every external invocation afk makes: agents, `setup` and `verify` alike. One wedged
 * invocation may hold a slot for an hour, never for a night, and a timeout is an ordinary failure
 * that goes through the same recovery path as any other.
 */
export const INVOCATION_TIMEOUT_MS = 60 * 60 * 1000
