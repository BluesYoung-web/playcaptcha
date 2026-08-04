import { randomInt, randomUUID } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve } from 'node:path'

import sharp from 'sharp'
import {
  MAHJONG_TILE_IDS,
  MAHJONG_TILE_META,
  createMahjongChallenge,
  sortMahjongTiles,
} from 'playcaptcha'

const options = new Set(process.argv.slice(2))
const readOption = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : fallback
}
const development = options.has('--dev')
const host = readOption('--host', '127.0.0.1')
const port = Number(readOption('--port', '4186'))
const root = import.meta.dirname
const project = resolve(root, '../..')
const challengeTtl = 5 * 60_000
const variantsPerTile = 8
const challenges = new Map()
const assets = new Map()
const variantPool = new Map()

function json(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

function cookies(request) {
  return Object.fromEntries(
    (request.headers.cookie ?? '')
      .split(';')
      .map((part) => part.trim().split('='))
      .filter(([key, value]) => key && value)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  )
}

function session(request) {
  const existing = cookies(request).playcaptcha_session
  if (existing && /^[0-9a-f-]{36}$/u.test(existing)) return { id: existing, header: undefined }
  const id = randomUUID()
  return {
    id,
    header: `playcaptcha_session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=1800`,
  }
}

function shuffle(values) {
  const result = [...values]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1)
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}

async function body(request) {
  let source = ''
  for await (const chunk of request) {
    source += chunk
    if (source.length > 16_384) throw new RangeError('Request body too large')
  }
  return JSON.parse(source)
}

async function createVariant(tile) {
  const value = MAHJONG_TILE_META[tile].assetValue
  const paddingX = randomInt(5, 12)
  const paddingY = randomInt(4, 10)
  const offsetX = randomInt(-2, 3)
  const offsetY = randomInt(-2, 3)
  const tint = [randomInt(-3, 4), randomInt(-3, 4), randomInt(-3, 4), 0]
  const pipeline = sharp(join(project, 'assets', 'majiang_ui', `${value}.webp`))
    .ensureAlpha()
    .linear([1, 1, 1, 1], tint)
    .extend({
      left: paddingX + offsetX,
      right: paddingX - offsetX,
      top: paddingY + offsetY,
      bottom: paddingY - offsetY,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
  const [encoded, raw] = await Promise.all([
    pipeline.clone().webp({ lossless: true, effort: 2 }).toBuffer(),
    pipeline.clone().raw().toBuffer({ resolveWithObject: true }),
  ])
  return {
    bytes: encoded,
    pixels: raw.data,
    width: raw.info.width,
    height: raw.info.height,
  }
}

async function warmVariantPool() {
  if (variantPool.size === MAHJONG_TILE_IDS.length) return
  for (const tile of MAHJONG_TILE_IDS) {
    variantPool.set(
      tile,
      await Promise.all(Array.from({ length: variantsPerTile }, () => createVariant(tile))),
    )
  }
}

function randomizedTile(tile) {
  const variants = variantPool.get(tile)
  if (!variants?.length) throw new Error(`Variant pool is not ready for ${tile}`)
  return variants[randomInt(variants.length)]
}

function tileCounts(tiles) {
  const counts = Array(MAHJONG_TILE_IDS.length).fill(0)
  for (const tile of tiles) {
    const index = MAHJONG_TILE_IDS.indexOf(tile)
    if (index < 0 || ++counts[index] > 4) return null
  }
  return counts
}

function meldDecomposition(counts, remaining) {
  if (remaining === 0) return []
  const first = counts.findIndex((count) => count > 0)
  if (first < 0) return null
  const tile = MAHJONG_TILE_IDS[first]
  if (counts[first] >= 3) {
    counts[first] -= 3
    const rest = meldDecomposition(counts, remaining - 3)
    counts[first] += 3
    if (rest) return [[tile, tile, tile], ...rest]
  }
  const meta = MAHJONG_TILE_META[tile]
  const next = MAHJONG_TILE_IDS[first + 1]
  const after = MAHJONG_TILE_IDS[first + 2]
  if (
    meta.suit !== 'honors' &&
    meta.rank !== null &&
    meta.rank <= 7 &&
    MAHJONG_TILE_META[next]?.suit === meta.suit &&
    MAHJONG_TILE_META[after]?.suit === meta.suit &&
    counts[first + 1] > 0 &&
    counts[first + 2] > 0
  ) {
    counts[first]--
    counts[first + 1]--
    counts[first + 2]--
    const rest = meldDecomposition(counts, remaining - 3)
    counts[first]++
    counts[first + 1]++
    counts[first + 2]++
    if (rest) return [[tile, next, after], ...rest]
  }
  return null
}

function standardDecomposition(tiles, meldCount) {
  if (tiles.length !== meldCount * 3 + 2) return null
  const counts = tileCounts(tiles)
  if (!counts) return null
  for (let pair = 0; pair < counts.length; pair += 1) {
    if (counts[pair] < 2) continue
    counts[pair] -= 2
    const melds = meldDecomposition(counts, meldCount * 3)
    counts[pair] += 2
    if (melds) return { pair: [MAHJONG_TILE_IDS[pair], MAHJONG_TILE_IDS[pair]], melds }
  }
  return null
}

function sevenTileHand(hand, winningTile) {
  const decomposition = standardDecomposition([...hand, winningTile], 4)
  if (!decomposition) throw new Error('Mahjong challenge requires a standard winning hand')
  for (let left = 0; left < decomposition.melds.length - 1; left += 1) {
    for (let right = left + 1; right < decomposition.melds.length; right += 1) {
      const complete = [
        ...decomposition.pair,
        ...decomposition.melds[left],
        ...decomposition.melds[right],
      ]
      const winningIndex = complete.indexOf(winningTile)
      if (winningIndex < 0) continue
      complete.splice(winningIndex, 1)
      return sortMahjongTiles(complete)
    }
  }
  throw new Error('Mahjong challenge could not preserve its winning tile in seven tiles')
}

function compactWinningTiles(hand) {
  return MAHJONG_TILE_IDS.filter((tile) => standardDecomposition([...hand, tile], 2))
}

async function composeHand(hand) {
  const tiles = sortMahjongTiles(hand).map((tile) => randomizedTile(tile))
  const gap = randomInt(4, 8)
  const margin = randomInt(6, 12)
  const height = Math.max(...tiles.map(({ height }) => height)) + margin * 2
  const width =
    tiles.reduce((sum, image) => sum + image.width, 0) + gap * (tiles.length - 1) + margin * 2
  let x = margin
  const composites = tiles.map((image) => {
    const top = margin + randomInt(-2, 3) + Math.floor((height - margin * 2 - image.height) / 2)
    const input = image.pixels
    const overlay = {
      input,
      raw: { width: image.width, height: image.height, channels: 4 },
      left: x,
      top,
    }
    x += image.width + gap
    return overlay
  })
  return sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(composites)
    .webp({ quality: 92, alphaQuality: 100, effort: 0, smartSubsample: true })
    .toBuffer()
}

function registerAsset(challengeId, sessionId, expiresAt, bytes, contentType = 'image/webp') {
  const token = randomUUID()
  assets.set(token, { bytes, challengeId, contentType, expiresAt, sessionId })
  return `/api/captcha/assets/${token}`
}

function revokeAssets(challengeId) {
  for (const [token, asset] of assets) {
    if (asset.challengeId === challengeId) assets.delete(token)
  }
}

function expire(now) {
  for (const [id, challenge] of challenges) {
    if (challenge.expiresAt <= now) {
      challenges.delete(id)
      revokeAssets(id)
    }
  }
  for (const [token, asset] of assets) {
    if (asset.expiresAt <= now) assets.delete(token)
  }
}

async function createChallenge(sessionId) {
  const generated = createMahjongChallenge()
  const visibleHand = sevenTileHand(generated.hand, generated.winningTile)
  const visibleWinners = compactWinningTiles(visibleHand)
  if (!visibleWinners.includes(generated.winningTile)) {
    throw new Error('Seven-tile hand must preserve the server answer')
  }
  const visibleCounts = tileCounts(visibleHand)
  const distractors = shuffle(
    MAHJONG_TILE_IDS.filter(
      (tile, index) =>
        tile !== generated.winningTile &&
        !visibleWinners.includes(tile) &&
        visibleCounts[index] < 4,
    ),
  ).slice(0, 11)
  if (distractors.length !== 11) throw new Error('Mahjong challenge needs eleven non-winning tiles')
  const challengeId = randomUUID()
  const expiresAt = Date.now() + challengeTtl
  const candidates = shuffle([generated.winningTile, ...distractors]).map((tile) => ({
    id: randomUUID(),
    tile,
    image: '',
  }))
  for (const candidate of candidates) {
    candidate.image = registerAsset(
      challengeId,
      sessionId,
      expiresAt,
      randomizedTile(candidate.tile).bytes,
    )
  }
  const answerCandidateId = candidates.find(({ tile }) => tile === generated.winningTile).id
  const handImage = registerAsset(challengeId, sessionId, expiresAt, await composeHand(visibleHand))
  challenges.set(challengeId, { answerCandidateId, expiresAt, sessionId })
  const response = {
    version: 3,
    challengeId,
    mode: 'mahjong',
    challenge: {
      handImage,
      candidates: candidates.map(({ id, image }) => ({ id, image })),
    },
    expiresAt: new Date(expiresAt).toISOString(),
  }
  Object.defineProperty(response, '__test', {
    value: {
      visibleHand,
      winningTile: generated.winningTile,
      candidates: candidates.map(({ tile }) => tile),
    },
  })
  return response
}

export {
  compactWinningTiles,
  createChallenge,
  randomizedTile,
  sevenTileHand,
  variantPool,
  warmVariantPool,
}

async function api(request, response) {
  const activeSession = session(request)
  const headers = activeSession.header ? { 'Set-Cookie': activeSession.header } : {}
  let payload
  try {
    payload = await body(request)
  } catch {
    json(response, 400, { verified: false, message: 'Invalid JSON request' }, headers)
    return
  }
  if (payload?.version !== 3 || !['create', 'verify'].includes(payload.action)) {
    json(response, 400, { verified: false, message: 'Unsupported protocol request' }, headers)
    return
  }
  const now = Date.now()
  expire(now)
  if (payload.action === 'create') {
    if (payload.mode !== 'mahjong') {
      json(response, 400, { verified: false, message: 'Only mahjong is server-issued' }, headers)
      return
    }
    json(response, 200, await createChallenge(activeSession.id), headers)
    return
  }
  const challenge = challenges.get(payload.challengeId)
  if (challenge) {
    challenges.delete(payload.challengeId)
    revokeAssets(payload.challengeId)
  }
  const selected = payload.completion?.selected
  if (
    !challenge ||
    challenge.expiresAt <= now ||
    challenge.sessionId !== activeSession.id ||
    typeof selected !== 'string'
  ) {
    json(response, 200, { verified: false, message: 'Challenge expired or unavailable' }, headers)
    return
  }
  if (selected !== challenge.answerCandidateId) {
    json(response, 200, { verified: false, message: 'Incorrect selection' }, headers)
    return
  }
  json(
    response,
    200,
    {
      verified: true,
      token: randomUUID(),
      expiresAt: new Date(now + 2 * 60_000).toISOString(),
    },
    headers,
  )
}

function serveAsset(request, response, token) {
  const activeSession = session(request)
  const asset = assets.get(token)
  const challenge = asset ? challenges.get(asset.challengeId) : undefined
  if (
    !asset ||
    !challenge ||
    asset.expiresAt <= Date.now() ||
    asset.sessionId !== activeSession.id ||
    challenge.sessionId !== activeSession.id
  ) {
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end('Not found')
    return
  }
  response.writeHead(200, {
    'Cache-Control': 'private, no-store',
    'Content-Length': asset.bytes.length,
    'Content-Type': asset.contentType,
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(asset.bytes)
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
}

function serveBuilt(request, response) {
  const dist = resolve(root, 'dist')
  const pathname = new URL(request.url, 'http://localhost').pathname
  const requested = pathname === '/' ? 'index.html' : pathname.slice(1)
  const path = resolve(dist, normalize(requested))
  if (!path.startsWith(`${dist}/`) || !existsSync(path) || !statSync(path).isFile()) {
    response.writeHead(404).end('Not found')
    return
  }
  response.writeHead(200, {
    'Content-Type': contentTypes[extname(path)] ?? 'application/octet-stream',
  })
  createReadStream(path).pipe(response)
}

let vite
if (development) {
  const { createServer: createViteServer } = await import('@voidzero-dev/vite-plus-core')
  vite = await createViteServer({ root, server: { middlewareMode: true }, appType: 'spa' })
} else if (!existsSync(join(root, 'dist', 'index.html'))) {
  throw new Error('Missing dist/index.html. Run pnpm build before pnpm serve.')
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname
  if (request.method === 'POST' && pathname === '/api/captcha') {
    await api(request, response)
    return
  }
  const assetMatch = /^\/api\/captcha\/assets\/([0-9a-f-]{36})$/u.exec(pathname)
  if (request.method === 'GET' && assetMatch) {
    serveAsset(request, response, assetMatch[1])
    return
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405).end('Method not allowed')
    return
  }
  if (vite) vite.middlewares(request, response, () => response.writeHead(404).end('Not found'))
  else serveBuilt(request, response)
})

if (import.meta.main) {
  await warmVariantPool()
  server.listen(port, host, () => {
    console.log(`PlayCaptcha server playground: http://${host}:${port}`)
  })
}
