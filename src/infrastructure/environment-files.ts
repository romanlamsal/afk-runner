import { copyFile, mkdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { type CopyEnvironmentFiles, isEnvironmentFile } from "../domain/environment.ts"
import { AFK_DIR } from "../domain/paths.ts"
import { run } from "./process.ts"

/**
 * The operator's ignored environment files, copied into a worktree.
 *
 * git is what finds them: an environment file is one the repository ignores, and asking git which
 * files it ignores is the only way to learn that which does not involve afk inventing its own idea
 * of an ignore rule. Nothing under afk's own run directory is ever a source — copies made into an
 * earlier worktree are ignored files too, and copying a copy would put them at the wrong path
 * (ADR-0013, ADR-0020).
 */

export const createEnvironmentFiles = (): CopyEnvironmentFiles => async (root, worktree) => {
    const listed = await run("git", ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], { cwd: root })
    if (!listed.ok) {
        return
    }

    const files = listed.stdout
        .split("\0")
        .filter(path => path !== "" && !path.startsWith(`${AFK_DIR}/`) && isEnvironmentFile(path))

    for (const file of files) {
        // Copied, never symlinked, and at the same relative path, so that a monorepo's layout lands
        // as it stands. Contents are never read here: they go from one file to another.
        const destination = join(root, worktree, file)
        await mkdir(dirname(destination), { recursive: true })
        await copyFile(join(root, file), destination)
    }
}
