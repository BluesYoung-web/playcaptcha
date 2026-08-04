import { describe, expect, test } from 'vitest'

import {
  CLAW_MAX,
  CLAW_MIN,
  GRAB_RADIUS,
  GW,
  logicalDelta,
  logicalToRendered,
  nearestCandidateAt,
  pileItemCenter,
  rectToLogicalOverlay,
  rectToLogicalTray,
  rotatedSquareBounds,
  scatterMahjongPile,
} from './simulation.ts'

function seeded(seed: number): () => number {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 0x1_0000_0000
  }
}

function cornerMatrixBounds(width: number, rotation: number): { minX: number; maxX: number } {
  const radians = (rotation * Math.PI) / 180
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const half = width / 2
  const xs = [
    { x: -half, y: -half },
    { x: half, y: -half },
    { x: half, y: half },
    { x: -half, y: half },
  ].map(({ x, y }) => x * cosine - y * sine)
  return { minX: Math.min(...xs), maxX: Math.max(...xs) }
}

describe('scatterMahjongPile', () => {
  test.each(Array.from({ length: 12 }, (_, identity) => identity))(
    'places twelve unique identities with %i at either front edge',
    (targetIdentity) => {
      const failures: string[] = []
      const seenEdges = new Set<number>()
      for (let seed = 0; seed < 1000; seed += 1) {
        const pile = scatterMahjongPile(targetIdentity, 12, seeded(seed))
        const targetIndex = pile.findIndex(({ identity }) => identity === targetIdentity)
        if (pile.length !== 12) failures.push(`seed ${seed}: length`)
        if (new Set(pile.map(({ identity }) => identity)).size !== 12)
          failures.push(`seed ${seed}: duplicate`)
        if (targetIndex !== 0 && targetIndex !== 4)
          failures.push(`seed ${seed}: target index ${targetIndex}`)
        else seenEdges.add(targetIndex)
        const target = pile[targetIndex]
        if (target?.z !== 5) failures.push(`seed ${seed}: target z`)
        if (target && (target.x < CLAW_MIN || target.x > CLAW_MAX))
          failures.push(`seed ${seed}: unreachable`)
        if (target && Math.abs(target.x - GW / 2) < GRAB_RADIUS)
          failures.push(`seed ${seed}: at home`)
        if (target && target.x >= 150 && target.x <= 320) failures.push(`seed ${seed}: over tray`)
        const rows = [pile.slice(0, 5), pile.slice(5, 9), pile.slice(9)]
        if (rows.map((row) => row.length).join(',') !== '5,4,3') failures.push(`seed ${seed}: rows`)
        for (const slot of pile) {
          const bounds = cornerMatrixBounds(slot.w, slot.rot)
          if (slot.x + bounds.minX < 0 || slot.x + bounds.maxX > GW)
            failures.push(`seed ${seed}: bounds`)
          if (nearestCandidateAt(pile, slot.x) !== pile.indexOf(slot))
            failures.push(`seed ${seed}: unreachable slot`)
        }
        if (failures.length > 10) break
      }
      expect({ failures, seenEdges: [...seenEdges].sort((left, right) => left - right) }).toEqual({
        failures: [],
        seenEdges: [0, 4],
      })
    },
  )

  test('rejects non-twelve counts and invalid target identities', () => {
    expect(() => scatterMahjongPile(0, 11)).toThrow(/twelve/i)
    expect(() => scatterMahjongPile(12, 12)).toThrow(/target slot identity/i)
    expect(() => scatterMahjongPile(-1, 12)).toThrow(/target slot identity/i)
  })

  test('is reproducible with an injected random source', () => {
    expect(scatterMahjongPile(3, 12, seeded(42))).toEqual(scatterMahjongPile(3, 12, seeded(42)))
    expect(scatterMahjongPile(3, 12, seeded(42))).not.toEqual(scatterMahjongPile(3, 12, seeded(43)))
  })
})

describe('nearestCandidateAt', () => {
  const pile = [{ x: 100 }, { x: 120 }, { x: 200 }]
  test('rejects candidates outside the grab radius', () => {
    expect(nearestCandidateAt(pile, 100 - GRAB_RADIUS)).toBe(-1)
  })
  test('selects the nearest current visual centre', () => {
    const soft = [{ dx: 35 }, { dx: 0 }]
    expect(
      nearestCandidateAt(pile.slice(0, 2), 116, (slot, index) => slot.x + soft[index]!.dx),
    ).toBe(1)
    expect(
      nearestCandidateAt(pile.slice(0, 2), 134, (slot, index) => slot.x + soft[index]!.dx),
    ).toBe(0)
  })
})

describe('shared geometry', () => {
  test('production rotation bounds agree with an independent matrix', () => {
    for (const [width, rotation] of [
      [80, 0],
      [80, 17],
      [92, -43],
      [76, 90],
    ] as const) {
      const production = rotatedSquareBounds(width, rotation)
      const independent = cornerMatrixBounds(width, rotation)
      expect(production.minX).toBeCloseTo(independent.minX, 8)
      expect(production.maxX).toBeCloseTo(independent.maxX, 8)
    }
  })
  test('computes a displaced pile item center', () => {
    expect(pileItemCenter({ x: 100, b: 10, w: 60 }, { dx: 4, dy: 3, ey: -2 })).toEqual({
      x: 104,
      y: 281,
    })
  })
  test.each([
    [
      { left: 40, top: 80 },
      { left: 48, top: 88, width: 380 },
      { left: 8, top: 8, scale: 1 },
    ],
    [
      { left: 10, top: 30 },
      { left: 18, top: 38, width: 174 },
      { left: 8, top: 8, scale: 174 / GW },
    ],
  ])('maps the glass logical origin into the machine overlay', (machine, glass, expected) => {
    expect(rectToLogicalOverlay(machine, glass)).toEqual(expected)
  })
  test.each([
    [190, 190, 95],
    [190, 380, 190],
  ])('maps logical %i into a %i-wide machine', (logical, actual, rendered) => {
    expect(logicalToRendered(logical, actual)).toBe(rendered)
  })
  test.each([
    [190, 95, 190],
    [380, 95, 95],
  ])('maps pointer delta at %i width', (actual, rendered, logical) => {
    expect(logicalDelta(rendered, actual)).toBe(logical)
  })
  test('maps the rendered tray into logical geometry', () => {
    expect(
      rectToLogicalTray(
        { left: 0, top: 0, width: 380 },
        { left: 150, right: 320, top: 350, height: 52 },
      ),
    ).toEqual({ cx: 235, cy: 376, min: 150, max: 320, mouthY: 352, scale: 1 })
  })
})
