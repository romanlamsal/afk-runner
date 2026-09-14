# afk

Runs a whole spec's tickets unattended.

## Requirements

- Node >= 23.6 — native TypeScript type stripping, so `node main.ts` runs with no build step
- `gh`, authenticated for the repo
- A spec is a GitHub issue; its tickets are its sub-issues

No `package.json`, no dependencies, `node:` builtins only.

## Usage

```
node main.ts <spec-issue> [--max-parallel 3] [--dry-run] [--resume | --force-fresh]
```

| flag | |
| --- | --- |
| `--max-parallel` | how many tickets are implemented at once (default 3) |
| `--dry-run` | print what would happen |
| `--resume` | continue a run that was interrupted |
| `--force-fresh` | delete the run's branches and `.afk/<spec>/` and start over. No confirmation prompt — the flag is the consent |

## Files

| file | |
| --- | --- |
| `main.ts` | the orchestrator |
| `schema.ts` | zod schema for the manifest — source of truth |
| `schema.json` | generated from `schema.ts`, committed, passed to the planner |

Regenerate `schema.json` by running `schema.ts` from a directory where `zod` resolves.
