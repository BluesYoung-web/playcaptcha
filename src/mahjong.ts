export const MAHJONG_TILE_IDS = [
  'wan-1',
  'wan-2',
  'wan-3',
  'wan-4',
  'wan-5',
  'wan-6',
  'wan-7',
  'wan-8',
  'wan-9',
  'bamboo-1',
  'bamboo-2',
  'bamboo-3',
  'bamboo-4',
  'bamboo-5',
  'bamboo-6',
  'bamboo-7',
  'bamboo-8',
  'bamboo-9',
  'circle-1',
  'circle-2',
  'circle-3',
  'circle-4',
  'circle-5',
  'circle-6',
  'circle-7',
  'circle-8',
  'circle-9',
  'east',
  'south',
  'west',
  'north',
  'red',
  'green',
  'white',
] as const

export type MahjongTileId = (typeof MAHJONG_TILE_IDS)[number]

export interface MahjongTileMeta {
  assetValue: number
  symbol: string
  suit: 'characters' | 'bamboo' | 'circles' | 'honors'
  rank: number | null
  color: 'red' | 'green' | 'ink'
  label: { 'zh-CN': string; en: string }
}

export const MAHJONG_TILE_META: Record<MahjongTileId, MahjongTileMeta> = {
  'wan-1': {
    assetValue: 21,
    symbol: '一',
    suit: 'characters',
    rank: 1,
    color: 'red',
    label: { 'zh-CN': '一万', en: '1 Characters' },
  },
  'wan-2': {
    assetValue: 22,
    symbol: '二',
    suit: 'characters',
    rank: 2,
    color: 'ink',
    label: { 'zh-CN': '二万', en: '2 Characters' },
  },
  'wan-3': {
    assetValue: 23,
    symbol: '三',
    suit: 'characters',
    rank: 3,
    color: 'ink',
    label: { 'zh-CN': '三万', en: '3 Characters' },
  },
  'wan-4': {
    assetValue: 24,
    symbol: '四',
    suit: 'characters',
    rank: 4,
    color: 'ink',
    label: { 'zh-CN': '四万', en: '4 Characters' },
  },
  'wan-5': {
    assetValue: 25,
    symbol: '五',
    suit: 'characters',
    rank: 5,
    color: 'red',
    label: { 'zh-CN': '五万', en: '5 Characters' },
  },
  'wan-6': {
    assetValue: 26,
    symbol: '六',
    suit: 'characters',
    rank: 6,
    color: 'ink',
    label: { 'zh-CN': '六万', en: '6 Characters' },
  },
  'wan-7': {
    assetValue: 27,
    symbol: '七',
    suit: 'characters',
    rank: 7,
    color: 'ink',
    label: { 'zh-CN': '七万', en: '7 Characters' },
  },
  'wan-8': {
    assetValue: 28,
    symbol: '八',
    suit: 'characters',
    rank: 8,
    color: 'ink',
    label: { 'zh-CN': '八万', en: '8 Characters' },
  },
  'wan-9': {
    assetValue: 29,
    symbol: '九',
    suit: 'characters',
    rank: 9,
    color: 'red',
    label: { 'zh-CN': '九万', en: '9 Characters' },
  },
  'bamboo-1': {
    assetValue: 10,
    symbol: '一条',
    suit: 'bamboo',
    rank: 1,
    color: 'green',
    label: { 'zh-CN': '一条', en: '1 Bamboo' },
  },
  'bamboo-2': {
    assetValue: 11,
    symbol: '二条',
    suit: 'bamboo',
    rank: 2,
    color: 'green',
    label: { 'zh-CN': '二条', en: '2 Bamboo' },
  },
  'bamboo-3': {
    assetValue: 12,
    symbol: '三条',
    suit: 'bamboo',
    rank: 3,
    color: 'green',
    label: { 'zh-CN': '三条', en: '3 Bamboo' },
  },
  'bamboo-4': {
    assetValue: 13,
    symbol: '四条',
    suit: 'bamboo',
    rank: 4,
    color: 'green',
    label: { 'zh-CN': '四条', en: '4 Bamboo' },
  },
  'bamboo-5': {
    assetValue: 14,
    symbol: '五条',
    suit: 'bamboo',
    rank: 5,
    color: 'green',
    label: { 'zh-CN': '五条', en: '5 Bamboo' },
  },
  'bamboo-6': {
    assetValue: 15,
    symbol: '六条',
    suit: 'bamboo',
    rank: 6,
    color: 'green',
    label: { 'zh-CN': '六条', en: '6 Bamboo' },
  },
  'bamboo-7': {
    assetValue: 16,
    symbol: '七条',
    suit: 'bamboo',
    rank: 7,
    color: 'green',
    label: { 'zh-CN': '七条', en: '7 Bamboo' },
  },
  'bamboo-8': {
    assetValue: 17,
    symbol: '八条',
    suit: 'bamboo',
    rank: 8,
    color: 'green',
    label: { 'zh-CN': '八条', en: '8 Bamboo' },
  },
  'bamboo-9': {
    assetValue: 18,
    symbol: '九条',
    suit: 'bamboo',
    rank: 9,
    color: 'green',
    label: { 'zh-CN': '九条', en: '9 Bamboo' },
  },
  'circle-1': {
    assetValue: 32,
    symbol: '一筒',
    suit: 'circles',
    rank: 1,
    color: 'red',
    label: { 'zh-CN': '一筒', en: '1 Circle' },
  },
  'circle-2': {
    assetValue: 33,
    symbol: '二筒',
    suit: 'circles',
    rank: 2,
    color: 'ink',
    label: { 'zh-CN': '二筒', en: '2 Circles' },
  },
  'circle-3': {
    assetValue: 34,
    symbol: '三筒',
    suit: 'circles',
    rank: 3,
    color: 'ink',
    label: { 'zh-CN': '三筒', en: '3 Circles' },
  },
  'circle-4': {
    assetValue: 35,
    symbol: '四筒',
    suit: 'circles',
    rank: 4,
    color: 'ink',
    label: { 'zh-CN': '四筒', en: '4 Circles' },
  },
  'circle-5': {
    assetValue: 36,
    symbol: '五筒',
    suit: 'circles',
    rank: 5,
    color: 'red',
    label: { 'zh-CN': '五筒', en: '5 Circles' },
  },
  'circle-6': {
    assetValue: 37,
    symbol: '六筒',
    suit: 'circles',
    rank: 6,
    color: 'ink',
    label: { 'zh-CN': '六筒', en: '6 Circles' },
  },
  'circle-7': {
    assetValue: 38,
    symbol: '七筒',
    suit: 'circles',
    rank: 7,
    color: 'ink',
    label: { 'zh-CN': '七筒', en: '7 Circles' },
  },
  'circle-8': {
    assetValue: 39,
    symbol: '八筒',
    suit: 'circles',
    rank: 8,
    color: 'ink',
    label: { 'zh-CN': '八筒', en: '8 Circles' },
  },
  'circle-9': {
    assetValue: 40,
    symbol: '九筒',
    suit: 'circles',
    rank: 9,
    color: 'red',
    label: { 'zh-CN': '九筒', en: '9 Circles' },
  },
  east: {
    assetValue: 1,
    symbol: '東',
    suit: 'honors',
    rank: null,
    color: 'ink',
    label: { 'zh-CN': '东风', en: 'East Wind' },
  },
  south: {
    assetValue: 2,
    symbol: '南',
    suit: 'honors',
    rank: null,
    color: 'ink',
    label: { 'zh-CN': '南风', en: 'South Wind' },
  },
  west: {
    assetValue: 3,
    symbol: '西',
    suit: 'honors',
    rank: null,
    color: 'ink',
    label: { 'zh-CN': '西风', en: 'West Wind' },
  },
  north: {
    assetValue: 4,
    symbol: '北',
    suit: 'honors',
    rank: null,
    color: 'ink',
    label: { 'zh-CN': '北风', en: 'North Wind' },
  },
  red: {
    assetValue: 5,
    symbol: '中',
    suit: 'honors',
    rank: null,
    color: 'red',
    label: { 'zh-CN': '红中', en: 'Red Dragon' },
  },
  green: {
    assetValue: 6,
    symbol: '發',
    suit: 'honors',
    rank: null,
    color: 'green',
    label: { 'zh-CN': '发财', en: 'Green Dragon' },
  },
  white: {
    assetValue: 7,
    symbol: '□',
    suit: 'honors',
    rank: null,
    color: 'ink',
    label: { 'zh-CN': '白板', en: 'White Dragon' },
  },
}

export function isMahjongTileId(value: unknown): value is MahjongTileId {
  return typeof value === 'string' && (MAHJONG_TILE_IDS as readonly string[]).includes(value)
}

export function sortMahjongTiles(tiles: readonly MahjongTileId[]): MahjongTileId[] {
  return [...tiles].sort(
    (left, right) => MAHJONG_TILE_IDS.indexOf(left) - MAHJONG_TILE_IDS.indexOf(right),
  )
}

function tileCounts(tiles: readonly MahjongTileId[]): number[] | null {
  const counts = Array<number>(MAHJONG_TILE_IDS.length).fill(0)
  for (const tile of tiles) {
    const index = MAHJONG_TILE_IDS.indexOf(tile)
    if (index < 0 || ++counts[index]! > 4) return null
  }
  return counts
}

function canFormMelds(counts: number[], remaining: number): boolean {
  if (remaining === 0) return true
  const first = counts.findIndex((count) => count > 0)
  if (first < 0) return false

  if (counts[first]! >= 3) {
    counts[first]! -= 3
    if (canFormMelds(counts, remaining - 3)) {
      counts[first]! += 3
      return true
    }
    counts[first]! += 3
  }

  const meta = MAHJONG_TILE_META[MAHJONG_TILE_IDS[first]!]
  const canSequence =
    meta.suit !== 'honors' &&
    meta.rank !== null &&
    meta.rank <= 7 &&
    MAHJONG_TILE_META[MAHJONG_TILE_IDS[first + 1]!].suit === meta.suit &&
    MAHJONG_TILE_META[MAHJONG_TILE_IDS[first + 2]!].suit === meta.suit
  if (canSequence && counts[first + 1]! > 0 && counts[first + 2]! > 0) {
    counts[first]!--
    counts[first + 1]!--
    counts[first + 2]!--
    if (canFormMelds(counts, remaining - 3)) {
      counts[first]!++
      counts[first + 1]!++
      counts[first + 2]!++
      return true
    }
    counts[first]!++
    counts[first + 1]!++
    counts[first + 2]!++
  }

  return false
}

export function isStandardMahjongWin(tiles: readonly MahjongTileId[]): boolean {
  if (tiles.length !== 14) return false
  const counts = tileCounts(tiles)
  if (!counts) return false

  for (let pair = 0; pair < counts.length; pair += 1) {
    if (counts[pair]! < 2) continue
    counts[pair]! -= 2
    const winning = canFormMelds(counts, 12)
    counts[pair]! += 2
    if (winning) return true
  }
  return false
}

export function winningTilesForHand(hand: readonly MahjongTileId[]): MahjongTileId[] {
  if (hand.length !== 13 || !tileCounts(hand)) return []
  return MAHJONG_TILE_IDS.filter((tile) => isStandardMahjongWin([...hand, tile]))
}

export type MahjongWaitType = 'pair' | 'edge' | 'closed'

export interface MahjongChallenge {
  hand: readonly MahjongTileId[]
  candidates: readonly MahjongTileId[]
  winningTile: MahjongTileId
  waitType: MahjongWaitType
}

interface MahjongChallengeTemplate {
  hand: readonly MahjongTileId[]
  waitType: MahjongWaitType
}

const SINGLE_WAIT_HANDS: readonly MahjongChallengeTemplate[] = [
  {
    waitType: 'pair',
    hand: [
      'wan-1',
      'wan-2',
      'wan-3',
      'bamboo-2',
      'bamboo-3',
      'bamboo-4',
      'circle-5',
      'circle-6',
      'circle-7',
      'east',
      'east',
      'east',
      'red',
    ],
  },
  {
    waitType: 'pair',
    hand: [
      'bamboo-1',
      'bamboo-2',
      'bamboo-3',
      'bamboo-4',
      'bamboo-5',
      'bamboo-6',
      'circle-7',
      'circle-8',
      'circle-9',
      'south',
      'south',
      'south',
      'white',
    ],
  },
  {
    waitType: 'pair',
    hand: [
      'wan-4',
      'wan-5',
      'wan-6',
      'bamboo-6',
      'bamboo-7',
      'bamboo-8',
      'circle-1',
      'circle-2',
      'circle-3',
      'west',
      'west',
      'west',
      'green',
    ],
  },
  {
    waitType: 'edge',
    hand: [
      'wan-1',
      'wan-2',
      'bamboo-4',
      'bamboo-5',
      'bamboo-6',
      'circle-6',
      'circle-7',
      'circle-8',
      'east',
      'east',
      'east',
      'red',
      'red',
    ],
  },
  {
    waitType: 'edge',
    hand: [
      'bamboo-8',
      'bamboo-9',
      'wan-2',
      'wan-3',
      'wan-4',
      'circle-1',
      'circle-2',
      'circle-3',
      'south',
      'south',
      'south',
      'white',
      'white',
    ],
  },
  {
    waitType: 'edge',
    hand: [
      'circle-1',
      'circle-2',
      'wan-5',
      'wan-6',
      'wan-7',
      'bamboo-2',
      'bamboo-3',
      'bamboo-4',
      'west',
      'west',
      'west',
      'green',
      'green',
    ],
  },
  {
    waitType: 'edge',
    hand: [
      'circle-8',
      'circle-9',
      'wan-1',
      'wan-2',
      'wan-3',
      'bamboo-6',
      'bamboo-7',
      'bamboo-8',
      'north',
      'north',
      'north',
      'red',
      'red',
    ],
  },
  {
    waitType: 'closed',
    hand: [
      'wan-1',
      'wan-3',
      'bamboo-4',
      'bamboo-5',
      'bamboo-6',
      'circle-7',
      'circle-8',
      'circle-9',
      'east',
      'east',
      'east',
      'white',
      'white',
    ],
  },
  {
    waitType: 'closed',
    hand: [
      'bamboo-4',
      'bamboo-6',
      'wan-1',
      'wan-2',
      'wan-3',
      'circle-2',
      'circle-3',
      'circle-4',
      'south',
      'south',
      'south',
      'red',
      'red',
    ],
  },
  {
    waitType: 'closed',
    hand: [
      'circle-6',
      'circle-8',
      'wan-4',
      'wan-5',
      'wan-6',
      'bamboo-1',
      'bamboo-2',
      'bamboo-3',
      'west',
      'west',
      'west',
      'green',
      'green',
    ],
  },
  {
    waitType: 'closed',
    hand: [
      'wan-6',
      'wan-8',
      'bamboo-7',
      'bamboo-8',
      'bamboo-9',
      'circle-1',
      'circle-2',
      'circle-3',
      'north',
      'north',
      'north',
      'white',
      'white',
    ],
  },
]

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1))
    ;[result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!]
  }
  return result
}

export function createMahjongChallenge(random: () => number = Math.random): MahjongChallenge {
  const template = SINGLE_WAIT_HANDS[Math.floor(random() * SINGLE_WAIT_HANDS.length)]!
  const winningTiles = winningTilesForHand(template.hand)
  if (winningTiles.length !== 1)
    throw new Error('Mahjong challenge template must have one winning tile')
  const winningTile = winningTiles[0]!
  const distractors = shuffle(
    MAHJONG_TILE_IDS.filter((tile) => tile !== winningTile),
    random,
  ).slice(0, 11)
  return {
    hand: shuffle(template.hand, random),
    candidates: shuffle([winningTile, ...distractors], random),
    winningTile,
    waitType: template.waitType,
  }
}
