/**
 * What the invocation asked afk to do. `plan-and-implement` is the bare invocation: plan, confirm,
 * implement.
 *
 * The mode decides what starting a run does — whether anything is planned, whether the operator is
 * asked — so it is a rule of the run rather than a detail of the flag surface (ADR-0014).
 */
export type Mode = "plan-and-implement" | "plan-only" | "implement-only"
