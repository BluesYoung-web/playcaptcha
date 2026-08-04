import assert from 'node:assert/strict'
import test from 'node:test'

import { MAHJONG_TILE_IDS, createMahjongChallenge } from 'playcaptcha'

import sharp from 'sharp'

import {
  compactWinningTiles,
  createChallenge,
  randomizedTile,
  sevenTileHand,
  variantPool,
  warmVariantPool,
} from './server.mjs'

function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x1_0000_0000
  }
}

await warmVariantPool()

void test('reduces every generated hand to seven tiles while preserving its server answer', () => {
  for (let seed = 0; seed < 2_000; seed += 1) {
    const challenge = createMahjongChallenge(seeded(seed))
    const hand = sevenTileHand(challenge.hand, challenge.winningTile)
    assert.equal(hand.length, 7, `seed ${seed}`)
    assert.ok(compactWinningTiles(hand).includes(challenge.winningTile), `seed ${seed}`)
  }
})

void test('prewarms eight full-resolution WebP variants for every mahjong tile', async () => {
  assert.equal(variantPool.size, MAHJONG_TILE_IDS.length)
  for (const variants of variantPool.values()) assert.equal(variants.length, 8)
  const variant = randomizedTile('wan-1')
  assert.equal(variant.bytes.subarray(0, 4).toString('ascii'), 'RIFF')
  assert.equal(variant.bytes.subarray(8, 12).toString('ascii'), 'WEBP')
  const metadata = await sharp(variant.bytes).metadata()
  assert.ok(metadata.width >= 130)
  assert.ok(metadata.height >= 147)
})

void test('issues twelve unique candidates with only the server answer completing seven tiles', async () => {
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const challenge = await createChallenge(`session-${iteration}`)
    const stored = challenge.__test
    assert.equal(stored.visibleHand.length, 7, `iteration ${iteration}`)
    assert.equal(stored.candidates.length, 12, `iteration ${iteration}`)
    assert.equal(new Set(stored.candidates).size, 12, `iteration ${iteration}`)
    const winners = stored.candidates.filter((tile) =>
      compactWinningTiles(stored.visibleHand).includes(tile),
    )
    assert.deepEqual(winners, [stored.winningTile], `iteration ${iteration}`)
    assert.ok(MAHJONG_TILE_IDS.includes(stored.winningTile), `iteration ${iteration}`)
    assert.equal('winningTile' in challenge, false)
    assert.equal('__test' in JSON.parse(JSON.stringify(challenge)), false)
  }
})
