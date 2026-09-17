import type { Board, BoardView } from "../../src/domain/board.ts"

export type FakeBoard = {
    board: Board
    /** Every view the board was shown, oldest first. The frames a test asserts on. */
    shown: BoardView[]
    /** Every run status line the board was given, oldest first. */
    noticed: string[]
}

export const createFakeBoard = (): FakeBoard => {
    const shown: BoardView[] = []
    const noticed: string[] = []
    return {
        shown,
        noticed,
        board: {
            show: view => {
                shown.push(view)
            },
            notice: line => {
                noticed.push(line)
            },
        },
    }
}
