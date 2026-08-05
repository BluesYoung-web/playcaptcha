import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAHJONG_TILE_IDS,
  compactMahjongChallenge,
  createMahjongChallenge,
  winningTilesForCompactHand,
} from '@bluesyoung/playcaptcha'
import sharp from 'sharp'

import { createChallenge, randomizedTile, variantPool, warmVariantPool } from './server.mjs'

function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x1_0000_0000
  }
}

void test('reduces every generated hand to seven tiles while preserving its answer', () => {
  for (let seed = 0; seed < 2_000; seed += 1) {
    const challenge = compactMahjongChallenge(
      createMahjongChallenge(seeded(seed)),
      seeded(seed + 1),
    )
    assert.equal(challenge.hand.length, 7, `seed ${seed}`)
    assert.ok(
      winningTilesForCompactHand(challenge.hand).includes(challenge.winningTile),
      `seed ${seed}`,
    )
    assert.equal(challenge.candidates.length, 12, `seed ${seed}`)
    assert.equal(new Set(challenge.candidates).size, 12, `seed ${seed}`)
    assert.deepEqual(
      challenge.candidates.filter((tile) =>
        winningTilesForCompactHand(challenge.hand).includes(tile),
      ),
      [challenge.winningTile],
      `seed ${seed}`,
    )
  }
})

void test('prewarms eight full-resolution WebP variants for every mahjong tile', async () => {
  await warmVariantPool()
  assert.equal(variantPool.size, MAHJONG_TILE_IDS.length)
  for (const tile of MAHJONG_TILE_IDS) assert.equal(variantPool.get(tile)?.length, 8)
  const variant = randomizedTile('wan-1')
  const metadata = await sharp(variant.bytes).metadata()
  assert.equal(metadata.format, 'webp')
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
      winningTilesForCompactHand(stored.visibleHand).includes(tile),
    )
    assert.deepEqual(winners, [stored.winningTile], `iteration ${iteration}`)
    assert.ok(MAHJONG_TILE_IDS.includes(stored.winningTile), `iteration ${iteration}`)
    assert.equal('winningTile' in challenge, false)
    assert.equal('__test' in JSON.parse(JSON.stringify(challenge)), false)
  }
})
