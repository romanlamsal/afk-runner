import { describe, expect, it } from "vitest"
import type { BaseState } from "../../src/domain/git.ts"
import { baseNotices } from "../../src/domain/preflight.ts"

const base = (overrides: Partial<BaseState> = {}): BaseState => ({
    branch: "main",
    ahead: 0,
    behind: 0,
    compared: true,
    dirty: false,
    ...overrides,
})

describe("baseNotices", () => {
    it("should say nothing about a base that matches its remote in a clean tree", () => {
        // given
        const clean = base()

        // when
        const notices = baseNotices(clean)

        // then
        expect(notices).toEqual([])
    })

    it("should warn that being behind is not pulled away", () => {
        // given
        const behind = base({ behind: 2 })

        // when
        const notices = baseNotices(behind)

        // then
        expect(notices).toEqual([{ kind: "warning", message: expect.stringContaining("2 commits behind origin/main") }])
    })

    it("should warn that uncommitted changes are not part of the run", () => {
        // given
        const dirty = base({ dirty: true })

        // when
        const notices = baseNotices(dirty)

        // then
        expect(notices).toEqual([
            { kind: "warning", message: expect.stringContaining("uncommitted changes are not part of this run") },
        ])
    })

    it("should note being ahead rather than warn about it, the commits being part of the run", () => {
        // given
        const ahead = base({ ahead: 1 })

        // when
        const notices = baseNotices(ahead)

        // then
        expect(notices).toEqual([{ kind: "note", message: expect.stringContaining("1 commit ahead of origin/main") }])
    })

    it("should note that a repository with no remote was not compared", () => {
        // given
        const alone = base({ compared: false })

        // when
        const notices = baseNotices(alone)

        // then
        expect(notices).toEqual([{ kind: "note", message: expect.stringContaining("no remote to compare main with") }])
    })

    it("should put the warnings before the notes, so the screen reads top to bottom", () => {
        // given
        const everything = base({ ahead: 1, behind: 2, dirty: true })

        // when
        const notices = baseNotices(everything)

        // then
        expect(notices.map(notice => notice.kind)).toEqual(["warning", "warning", "note"])
    })
})
