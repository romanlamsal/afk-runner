/**
 * The port that puts the operator's ignored environment files into a worktree, so that an
 * implementer can run the repository's own checks instead of failing on a missing environment.
 *
 * They are **copied**, never symlinked, and their relative paths are preserved so that a monorepo's
 * layout lands correctly. Rotating a secret mid-run therefore does not update worktrees that already
 * exist. Contents never cross this port: nothing afk logs, and no prompt it composes, can carry one
 * (ADR-0020).
 */
export type CopyEnvironmentFiles = (root: string, worktree: string) => Promise<void>

/**
 * Which of the repository's ignored files are the operator's environment, and so worth copying.
 *
 * Every ignored file is the wrong answer: `node_modules` and a build directory are ignored too, and
 * `setup` is what puts those in a worktree. So this is a rule, and rules live here rather than in
 * the adapter that reads the file system.
 *
 * `.env`, `.env.local`, `.env.test.local`, `packages/api/.env.test` and `.envrc` — and never
 * `.environment` or `env.ts`.
 */
const ENVIRONMENT_FILE = /(^|\/)\.env(rc|\.[^/]+)?$/

/**
 * A dependency directory is never a source. It is ignored, so git lists it, and it holds files whose
 * names match — `@types/node/.env.d.ts` and the like. `setup` is what puts dependencies in a
 * worktree, so nothing under one is ever copied.
 */
const DEPENDENCIES = /(^|\/)node_modules\//

export const isEnvironmentFile = (path: string): boolean => ENVIRONMENT_FILE.test(path) && !DEPENDENCIES.test(path)
