import { describe, expect, test } from 'vitest'

import {
  MAHJONG_TILE_IDS,
  MAHJONG_TILE_META,
  createMahjongChallenge,
  isMahjongTileId,
  isStandardMahjongWin,
  sortMahjongTiles,
  winningTilesForHand,
  type MahjongTileId,
} from './mahjong.ts'

function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x1_0000_0000
  }
}

describe('standard mahjong win evaluation', () => {
  test.each([
    [
      'four sequences, an honor triplet, and a dragon pair',
      [
        'wan-1',
        'wan-2',
        'wan-3',
        'wan-4',
        'wan-5',
        'wan-6',
        'wan-7',
        'wan-8',
        'wan-9',
        'east',
        'east',
        'east',
        'red',
        'red',
      ],
    ],
    [
      'mixed sequence and triplet decomposition',
      [
        'wan-1',
        'wan-1',
        'wan-1',
        'wan-2',
        'wan-3',
        'wan-4',
        'wan-4',
        'wan-5',
        'wan-6',
        'wan-7',
        'wan-8',
        'wan-9',
        'green',
        'green',
      ],
    ],
  ] as const)('accepts %s', (_name, tiles) => {
    expect(isStandardMahjongWin(tiles)).toBe(true)
  })

  test.each([
    [
      'thirteen tiles',
      [
        'wan-1',
        'wan-2',
        'wan-3',
        'wan-4',
        'wan-5',
        'wan-6',
        'wan-7',
        'wan-8',
        'wan-9',
        'east',
        'east',
        'east',
        'red',
      ],
    ],
    [
      'an incomplete structure',
      [
        'wan-1',
        'wan-2',
        'wan-4',
        'wan-4',
        'wan-5',
        'wan-6',
        'wan-7',
        'wan-8',
        'wan-9',
        'east',
        'east',
        'east',
        'red',
        'red',
      ],
    ],
    [
      'five copies of one tile',
      [
        'wan-1',
        'wan-1',
        'wan-1',
        'wan-1',
        'wan-1',
        'wan-2',
        'wan-3',
        'wan-4',
        'wan-5',
        'wan-6',
        'east',
        'east',
        'east',
        'red',
      ],
    ],
    [
      'seven pairs, which is outside the first release rules',
      [
        'wan-1',
        'wan-1',
        'wan-2',
        'wan-2',
        'wan-4',
        'wan-4',
        'wan-5',
        'wan-5',
        'wan-7',
        'wan-7',
        'east',
        'east',
        'red',
        'red',
      ],
    ],
  ] as const)('rejects %s', (_name, tiles) => {
    expect(isStandardMahjongWin(tiles)).toBe(false)
  })

  test('enumerates the one tile that completes a standard hand', () => {
    const hand: MahjongTileId[] = [
      'wan-1',
      'wan-2',
      'wan-3',
      'wan-4',
      'wan-5',
      'wan-6',
      'wan-7',
      'wan-8',
      'wan-9',
      'east',
      'east',
      'east',
      'red',
    ]
    expect(winningTilesForHand(hand)).toEqual(['red'])
    expect(winningTilesForHand([...hand, 'red'])).toEqual([])
  })

  test('exposes a stable, guarded thirty-four-tile catalogue', () => {
    expect(MAHJONG_TILE_IDS).toHaveLength(34)
    expect(new Set(MAHJONG_TILE_IDS).size).toBe(34)
    expect(isMahjongTileId('wan-5')).toBe(true)
    expect(isMahjongTileId('bamboo-5')).toBe(true)
    expect(isMahjongTileId('circle-1')).toBe(true)
  })

  test('maps every rules tile to the exact supplied image value', () => {
    expect(
      Object.fromEntries(
        MAHJONG_TILE_IDS.map((tile) => [tile, MAHJONG_TILE_META[tile].assetValue]),
      ),
    ).toEqual({
      'wan-1': 21,
      'wan-2': 22,
      'wan-3': 23,
      'wan-4': 24,
      'wan-5': 25,
      'wan-6': 26,
      'wan-7': 27,
      'wan-8': 28,
      'wan-9': 29,
      'bamboo-1': 10,
      'bamboo-2': 11,
      'bamboo-3': 12,
      'bamboo-4': 13,
      'bamboo-5': 14,
      'bamboo-6': 15,
      'bamboo-7': 16,
      'bamboo-8': 17,
      'bamboo-9': 18,
      'circle-1': 32,
      'circle-2': 33,
      'circle-3': 34,
      'circle-4': 35,
      'circle-5': 36,
      'circle-6': 37,
      'circle-7': 38,
      'circle-8': 39,
      'circle-9': 40,
      east: 1,
      south: 2,
      west: 3,
      north: 4,
      red: 5,
      green: 6,
      white: 7,
    })
  })

  test('sorts characters, bamboo, circles, then honors without mutating input', () => {
    const input: MahjongTileId[] = [
      'white',
      'circle-2',
      'wan-9',
      'bamboo-3',
      'south',
      'wan-1',
      'circle-1',
      'bamboo-1',
      'red',
      'wan-1',
      'east',
    ]
    const snapshot = [...input]

    expect(sortMahjongTiles(input)).toEqual([
      'wan-1',
      'wan-1',
      'wan-9',
      'bamboo-1',
      'bamboo-3',
      'circle-1',
      'circle-2',
      'east',
      'south',
      'red',
      'white',
    ])
    expect(input).toEqual(snapshot)
  })
})

describe('mahjong challenge generation', () => {
  test('is reproducible with an injected random source', () => {
    expect(createMahjongChallenge(seeded(42))).toEqual(createMahjongChallenge(seeded(42)))
    expect(createMahjongChallenge(seeded(42))).not.toEqual(createMahjongChallenge(seeded(43)))
  })

  test('produces twelve unique choices and every supported wait type across deterministic seeds', () => {
    const failures: string[] = []
    const winningTiles = new Set<MahjongTileId>()
    const waitTypes = new Set<string>()
    for (let seed = 0; seed < 2000; seed += 1) {
      const challenge = createMahjongChallenge(seeded(seed))
      const actualWinners = challenge.candidates.filter((candidate) =>
        isStandardMahjongWin([...challenge.hand, candidate]),
      )
      if (challenge.hand.length !== 13 && failures.length < 10) {
        failures.push(`seed ${seed}: hand length ${challenge.hand.length}`)
      }
      if (challenge.candidates.length !== 12 && failures.length < 10) {
        failures.push(`seed ${seed}: candidate length ${challenge.candidates.length}`)
      }
      if (new Set(challenge.candidates).size !== 12 && failures.length < 10) {
        failures.push(`seed ${seed}: duplicate candidate`)
      }
      if (actualWinners.length !== 1 || actualWinners[0] !== challenge.winningTile) {
        if (failures.length < 10) failures.push(`seed ${seed}: winners ${actualWinners.join(',')}`)
      }
      if (winningTilesForHand(challenge.hand).length !== 1 && failures.length < 10) {
        failures.push(`seed ${seed}: hand is not a single wait`)
      }
      winningTiles.add(challenge.winningTile)
      waitTypes.add(challenge.waitType)
    }
    expect(failures).toEqual([])
    expect(waitTypes).toEqual(new Set(['pair', 'edge', 'closed']))
    expect(winningTiles.size).toBeGreaterThanOrEqual(8)
  })
})
