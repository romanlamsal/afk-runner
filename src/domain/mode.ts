/**
 * What the invocation asked afk to do. `plan-and-implement` is the bare invocation: plan, confirm,
 * implement.
 *
 * The mode decides what starting a run does — whether anything is planned, whether the operator is
 * asked — so it is a rule of the run rather than a detail of the flag surface (ADR-0014).
 */
export type StartMode = "plan-and-implement" | "plan-only" | "implement-only"

/**
 * Every mode, which is the starting ones and the one that starts nothing: `board-only` draws a run
 * that already exists from its run directory and exits, reading and never writing (ADR-0030). It is
 * a mode rather than a command for the same reason `--plan-only` is: it does one narrow thing and
 * exits.
 */
export type Mode = StartMode | "board-only"
