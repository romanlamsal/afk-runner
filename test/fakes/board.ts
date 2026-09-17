import type { Board, BoardView } from "../../src/domain/board.ts"

export type FakeBoard = {
    board: Board
    /** Every view the board was shown, oldest first. The frames a test asserts on. */
    shown: BoardView[]
}

export const createFakeBoard = (): FakeBoard => {
    const shown: BoardView[] = []
    return {
        shown,
        board: {
            show: view => {
                shown.push(view)
            },
        },
    }
}
