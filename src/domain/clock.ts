/** Reading the time reaches outside the process, so it arrives as a port like anything else. */
export type Clock = () => Date

/**
 * A beat every `everyMs` milliseconds, until `signal` aborts — at which point the iterable ends
 * rather than throws. Waiting on a timer is reaching outside the process as much as reading one is,
 * so it arrives as a port too.
 */
export type Ticker = (everyMs: number, signal: AbortSignal) => AsyncIterable<void>
