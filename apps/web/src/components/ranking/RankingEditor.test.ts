import { moveItem } from './RankingEditor'

describe('moveItem', () => {
  it('moves an item before the one it is dropped on', () => {
    expect(moveItem([5, 3, 4, 1, 2], 4, 0)).toEqual([2, 5, 3, 4, 1])
    expect(moveItem([5, 3, 4, 1, 2], 0, 3)).toEqual([3, 4, 5, 1, 2])
    expect(moveItem([5, 3, 4, 1, 2], 1, 5)).toEqual([5, 4, 1, 2, 3])
  })
})
