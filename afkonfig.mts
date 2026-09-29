export default {
  setup: "pnpm install --frozen-lockfile",
  verify: "pnpm run check",
} satisfies { setup?: string; verify?: string }

