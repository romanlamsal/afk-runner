import { defineConfig } from "vitest/config"

/**
 * Two projects, split by file name so that the test tree keeps mirroring the source tree. An
 * integration test is one that uses a real external dependency — real git in a temporary
 * repository, or afk's own entry point in a real process — and nothing else is one.
 */
export default defineConfig({
    test: {
        projects: [
            {
                test: {
                    name: "unit",
                    include: ["test/**/*.test.ts"],
                    exclude: ["**/node_modules/**", "test/**/*.integration.test.ts"],
                },
            },
            {
                test: {
                    name: "integration",
                    include: ["test/**/*.integration.test.ts"],
                    exclude: ["**/node_modules/**"],
                },
            },
        ],
    },
})
