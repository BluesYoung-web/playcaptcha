export const GW = 380
export const GH = 320
export const RAIL_Y = 14
export const HOME_Y = 64
export const DROP_Y = 198
export const CLAW_MIN = 46
export const CLAW_MAX = 334
export const COIL_LEN = 50
export const GRAB_RADIUS = 38
export const GRIP_OFFSET = 46
export interface RectLike {
  left: number
  top: number
  width?: number
  right?: number
  height?: number
}

export interface LogicalTray {
  cx: number
  cy: number
  min: number
  max: number
  mouthY: number
  scale: number
}

export interface LogicalOverlay {
  left: number
  top: number
  scale: number
}

export function rectToLogicalOverlay(machine: RectLike, glass: RectLike): LogicalOverlay {
  const scale = (glass.width ?? 0) / GW
  return {
    left: glass.left - machine.left,
    top: glass.top - machine.top,
    scale: scale > 0 ? scale : 1,
  }
}

export function rectToLogicalTray(glass: RectLike, tray: RectLike): LogicalTray {
  const scale = (glass.width ?? 0) / GW
  if (!(scale > 0)) throw new RangeError('Glass width must be positive')
  const trayRight = tray.right ?? tray.left + (tray.width ?? 0)
  const trayHeight = tray.height ?? 0
  const min = (tray.left - glass.left) / scale
  const max = (trayRight - glass.left) / scale
  const top = (tray.top - glass.top) / scale
  return {
    cx: (min + max) / 2,
    cy: top + trayHeight / scale / 2,
    min,
    max,
    mouthY: top + 2,
    scale,
  }
}

export interface Slot {
  identity: number
  w: number
  x: number
  b: number
  z: number
  rot: number
  dropFrom: number
  delay: number
}

export interface Soft {
  dx: number
  dy: number
  rot: number
  sq: number
  vdx: number
  vdy: number
  vrot: number
  vsq: number
  ey: number
  evy: number
  delay: number
  landed: boolean
}

export function pileItemCenter(
  slot: Pick<Slot, 'x' | 'b' | 'w'>,
  soft: Pick<Soft, 'dx' | 'dy' | 'ey'>,
): { x: number; y: number } {
  return {
    x: slot.x + soft.dx,
    y: GH - slot.b - slot.w / 2 + soft.dy + soft.ey,
  }
}

export type Phase = 'idle' | 'seq' | 'carry' | 'toTray' | 'celebrate' | 'deny' | 'return' | 'done'

export const CONFETTI = [
  { dx: -44, dy: -54, dr: -150, c: '#34c759', d: 0 },
  { dx: -30, dy: -66, dr: 120, c: '#ffd60a', d: 0.05 },
  { dx: -14, dy: -76, dr: -80, c: '#5cd679', d: 0.02 },
  { dx: 2, dy: -80, dr: 60, c: '#5a93c9', d: 0.07 },
  { dx: 16, dy: -74, dr: -130, c: '#ffb340', d: 0.03 },
  { dx: 30, dy: -64, dr: 100, c: '#a8e6b8', d: 0.06 },
  { dx: 44, dy: -52, dr: -110, c: '#34c759', d: 0.01 },
  { dx: -54, dy: -36, dr: 90, c: '#e58ab0', d: 0.09 },
  { dx: 54, dy: -34, dr: -70, c: '#5a93c9', d: 0.08 },
] as const

export const T = {
  antic: 0.16,
  down: 0.78,
  dwell1: 0.18,
  close: 0.45,
  dwell2: 0.26,
  load: 0.24,
  up: 0.95,
  open: 0.4,
} as const

export const easeInQuad = (p: number): number => p * p
export const easeOutCubic = (p: number): number => 1 - Math.pow(1 - p, 3)
export const easeInOutCubic = (p: number): number =>
  p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
export const clamp01 = (p: number): number => Math.min(1, Math.max(0, p))

export function rotatedSquareBounds(
  width: number,
  rotation: number,
): { minX: number; maxX: number } {
  const radians = (rotation * Math.PI) / 180
  const halfExtent =
    (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians))) * (width / 2) + 1e-9
  return { minX: -halfExtent, maxX: halfExtent }
}

function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[result[i], result[j]] = [result[j]!, result[i]!]
  }
  return result
}

export function scatterMahjongPile(
  targetIdentity: number,
  candidateCount: number,
  random: () => number = Math.random,
): Slot[] {
  if (!Number.isInteger(candidateCount) || candidateCount !== 12) {
    throw new RangeError('Mahjong pile requires exactly twelve slot identities')
  }
  if (!Number.isInteger(targetIdentity) || targetIdentity < 0 || targetIdentity >= candidateCount) {
    throw new RangeError('Mahjong pile requires the target slot identity')
  }

  const identities = Array.from({ length: candidateCount }, (_, identity) => identity)
  const others = shuffle(
    identities.filter((identity) => identity !== targetIdentity),
    random,
  )
  const frontTargetIndex = random() < 0.5 ? 0 : 4
  const rows: number[][] = [[], [], []]
  let next = 0
  for (let index = 0; index < 5; index += 1) {
    rows[0]!.push(index === frontTargetIndex ? targetIdentity : others[next++]!)
  }
  rows[1]!.push(...others.slice(next, next + 4))
  next += 4
  rows[2]!.push(...others.slice(next))
  const slots: Slot[] = []

  const rowConfig = [
    { centers: [49, 118, 190, 262, 331], b: 0, w: 68, z: 4 },
    { centers: [72, 142, 238, 308], b: 58, w: 63, z: 2 },
    { centers: [95, 166, 285], b: 116, w: 58, z: 1 },
  ] as const
  rows.forEach((row, rowIndex) => {
    const config = rowConfig[rowIndex]!
    row.forEach((identity, index) => {
      const isTarget = identity === targetIdentity
      const w = config.w * (0.96 + random() * 0.08)
      const rot = (random() - 0.5) * (rowIndex === 0 ? 7 : 10)
      const bounds = rotatedSquareBounds(w, rot)
      const desiredX = config.centers[index]! + (random() - 0.5)
      slots.push({
        identity,
        w,
        x: Math.min(GW - bounds.maxX, Math.max(-bounds.minX, desiredX)),
        b: config.b + random() * 3,
        z: isTarget ? 5 : config.z,
        rot,
        dropFrom: -(340 + random() * 130),
        delay: rowIndex * 0.28 + index * 0.045 + random() * 0.06,
      })
    })
  })
  return slots
}

export function nearestCandidateAt<T extends { x: number }>(
  pile: readonly T[],
  x: number,
  currentX: (slot: T, index: number) => number = (slot) => slot.x,
): number {
  let best = -1
  let bestDistance = Infinity
  pile.forEach((slot, index) => {
    const distance = Math.abs(currentX(slot, index) - x)
    if (distance < GRAB_RADIUS && distance < bestDistance) {
      best = index
      bestDistance = distance
    }
  })
  return best
}

export function logicalToRendered(value: number, actualWidth: number): number {
  return value * (actualWidth / GW)
}

export function logicalDelta(value: number, actualWidth: number): number {
  return value / (actualWidth / GW)
}
