import type { Board, BoardNotice, BoardView } from "../../src/domain/board.ts"

export type FakeBoard = {
    board: Board
    /** Every view the board was shown, oldest first. The frames a test asserts on. */
    shown: BoardView[]
    /** Every notice the board was given, oldest first. */
    noticed: BoardNotice[]
}

export const createFakeBoard = (): FakeBoard => {
    const shown: BoardView[] = []
    const noticed: BoardNotice[] = []
    return {
        shown,
        noticed,
        board: {
            show: view => {
                shown.push(view)
            },
            notice: notice => {
                noticed.push(notice)
            },
        },
    }
}
