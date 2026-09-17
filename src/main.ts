#!/usr/bin/env node
import { assembleCli } from "./assembly.ts"

/**
 * The entry point. TypeScript run directly by a runtime that strips types — there is no build
 * step and nothing to bundle.
 */
process.exitCode = await assembleCli()(process.argv.slice(2))
