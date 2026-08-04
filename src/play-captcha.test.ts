import { afterEach, expect, test, vi } from 'vitest'

import {
  PLAY_CAPTCHA_LOCALES,
  PlayCaptcha,
  normalizeLocale,
  type MahjongTileId,
  type PlayCaptchaVerificationTransportInput,
} from './index.ts'

interface TestCaptcha extends PlayCaptcha {
  settlePile(): void
  moveTo(x: number): void
  pressAction(): void
  advance(frames?: number): void
  completeRemote(selectedCandidate: string): void
  operationState(): Record<string, unknown>
}

let testTag = 0
function createTestCaptcha(): TestCaptcha {
  class CaptchaHarness extends PlayCaptcha {
    private clock = 0

    settlePile(): void {
      const state = this as unknown as {
        soft: Array<{ ey: number; evy: number; landed: boolean }>
        pileSettled: boolean
      }
      for (const body of state.soft) {
        body.ey = 0
        body.evy = 0
        body.landed = true
      }
      state.pileSettled = true
      this.requestUpdate()
    }

    moveTo(x: number): void {
      this.setClawPosition(x)
    }

    pressAction(): void {
      this.activate()
    }

    advance(frames = 160): void {
      for (let frame = 0; frame < frames; frame += 1) {
        this.clock += 40
        this.advanceSimulation(this.clock)
      }
    }

    completeRemote(selectedCandidate: string): void {
      const state = this as unknown as {
        pendingCompletion: { selectedCandidate: string }
        phase: string
        pileSettled: boolean
        sim: { stage: string; st: number }
      }
      state.pendingCompletion = { selectedCandidate }
      state.pileSettled = true
      state.phase = 'celebrate'
      state.sim.stage = 'beat'
      state.sim.st = 1
      this.advance(1)
    }

    operationState(): Record<string, unknown> {
      const state = this as unknown as {
        pileSettled: boolean
        verified: boolean
        verifying: boolean
        loadingChallenge: boolean
        remoteEnabled: boolean
        issuedChallenge: unknown
        infoOpen: boolean
        phase: string
        soft: Array<{ landed: boolean; delay: number; ey: number }>
      }
      return {
        pileSettled: state.pileSettled,
        landed: state.soft.filter(({ landed }) => landed).length,
        softCount: state.soft.length,
        firstSoft: state.soft[0],
        verified: state.verified,
        verifying: state.verifying,
        loadingChallenge: state.loadingChallenge,
        remoteEnabled: state.remoteEnabled,
        issuedChallenge: state.issuedChallenge,
        infoOpen: state.infoOpen,
        phase: state.phase,
      }
    }
  }
  const tag = `play-captcha-test-${testTag++}`
  customElements.define(tag, CaptchaHarness)
  return document.createElement(tag) as TestCaptcha
}

function opaqueCandidates() {
  return Array.from({ length: 12 }, (_, index) => ({
    id: `candidate-${index}`,
    image: `/api/captcha/assets/image-${index}`,
  }))
}

function opaqueChallenge(challengeId = 'challenge-1', expiresIn = 60_000) {
  return {
    version: 3,
    challengeId,
    mode: 'mahjong',
    challenge: { handImage: '/api/captcha/assets/hand', candidates: opaqueCandidates() },
    expiresAt: new Date(Date.now() + expiresIn).toISOString(),
  } as const
}

async function mountedLocal(): Promise<TestCaptcha> {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  const captcha = createTestCaptcha()
  document.body.append(captcha)
  await captcha.updateComplete
  captcha.settlePile()
  await captcha.updateComplete
  return captcha
}

afterEach(() => {
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('renders the same seven-tile hand shape as remote v3 with twelve reachable candidates', async () => {
  const captcha = await mountedLocal()
  const root = captcha.shadowRoot!
  const hand = [...captcha.mahjongHand]
  const candidates = [...root.querySelectorAll<HTMLImageElement>('.cc-prize.cc-mahjong')]

  expect(PLAY_CAPTCHA_LOCALES).toEqual(['zh-CN', 'en'])
  expect(normalizeLocale('en-US')).toBe('en')
  expect(hand).toHaveLength(7)
  expect(root.querySelectorAll('.clawcap-hand-tile')).toHaveLength(7)
  expect(candidates).toHaveLength(12)
  expect(new Set(candidates.map((image) => image.dataset.tile)).size).toBe(12)
  expect(root.querySelector('.cc-toy')).toBeNull()
  for (const image of candidates) {
    const x = Number.parseFloat(image.closest<HTMLElement>('.cc-toy-wrap')!.style.left)
    expect(x).toBeGreaterThanOrEqual(46)
    expect(x).toBeLessThanOrEqual(334)
  }
})

test('keeps the answer hidden by default and reveals it only for local show-answer', async () => {
  const captcha = await mountedLocal()
  expect(captcha.shadowRoot!.querySelector('.clawcap-sub-mahjong')).toBeNull()
  captcha.showAnswer = true
  await captcha.updateComplete
  expect(
    captcha.shadowRoot!.querySelector<HTMLImageElement>('.clawcap-sub-mahjong')?.dataset.tile,
  ).toBe(captcha.currentMahjongTarget)
})

test('refresh replaces the local hand and clears carried and success state', async () => {
  const captcha = await mountedLocal()
  const first = [...captcha.mahjongHand]
  Object.assign(captcha as unknown as Record<string, unknown>, {
    phase: 'done',
    verified: true,
    feedback: { kind: 'empty' },
    carriedMahjongTile: 'wan-1',
  })
  captcha.shadowRoot!.querySelector<HTMLButtonElement>('.clawcap-refresh')!.click()
  await captcha.updateComplete
  expect(captcha.mahjongHand).toHaveLength(7)
  expect(captcha.mahjongHand).not.toEqual(first)
  expect((captcha as unknown as { verified: boolean }).verified).toBe(false)
  expect((captcha as unknown as { phase: string }).phase).toBe('idle')
  expect(
    (captcha as unknown as { carriedMahjongTile: MahjongTileId | null }).carriedMahjongTile,
  ).toBeNull()
})

test('normalizes locale, preserves a custom title, and restores the Mahjong default', async () => {
  const captcha = await mountedLocal()
  captcha.setAttribute('title', 'Checkout verification')
  captcha.locale = 'en-US' as 'en'
  await captcha.updateComplete
  expect(captcha.locale).toBe('en')
  expect(captcha.shadowRoot!.querySelector('h3')?.textContent?.trim()).toBe('Checkout verification')
  captcha.removeAttribute('title')
  await captcha.updateComplete
  expect(captcha.title).toBe('Find the winning tile')
})

test('resolves custom Mahjong and sibling logo URLs from asset-base', async () => {
  const captcha = createTestCaptcha()
  captcha.assetBase = '/runtime/mahjong?old=1#hash'
  document.body.append(captcha)
  await captcha.updateComplete
  captcha.shadowRoot!.querySelector<HTMLButtonElement>('.clawcap-help')!.click()
  await captcha.updateComplete
  expect(captcha.assetBase).toBe(`${location.origin}/runtime/mahjong/`)
  expect(captcha.shadowRoot!.querySelector<HTMLImageElement>('.cc-mahjong')?.src).toMatch(
    /\/runtime\/mahjong\/(?:[1-7]|1[0-8]|2[1-9]|3[2-9]|40)\.webp$/u,
  )
  expect(captcha.shadowRoot!.querySelector<HTMLImageElement>('.clawcap-info-tile img')?.src).toBe(
    `${location.origin}/runtime/playcaptcha.svg`,
  )
})

test.each(['data:text/plain,no', 'file:///tmp/tiles', 'mailto:no@example.com', 'https://['])(
  'falls back safely from invalid asset-base %s',
  async (assetBase) => {
    const captcha = createTestCaptcha()
    const expected = new URL(`${captcha.assetBase}/`, document.baseURI).href
    captcha.assetBase = assetBase
    document.body.append(captcha)
    await captcha.updateComplete
    expect(captcha.assetBase).toBe(expected)
    expect(captcha.shadowRoot!.querySelector<HTMLImageElement>('.cc-mahjong')?.src).toContain(
      '/assets/majiang_ui/',
    )
  },
)

test('keyboard arrows move the slider after the entrance settles', async () => {
  const captcha = await mountedLocal()
  const slider = captcha.shadowRoot!.querySelector<HTMLElement>('.cc-joy')!
  const before = Number(slider.getAttribute('aria-valuenow'))
  slider.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, composed: true }),
  )
  captcha.advance(8)
  slider.dispatchEvent(
    new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true, composed: true }),
  )
  expect(Number(slider.getAttribute('aria-valuenow'))).toBeGreaterThan(before)
})

test('wrong local tile returns without verify; winning tile emits one local verify event', async () => {
  const captcha = await mountedLocal()
  const verify = vi.fn()
  captcha.addEventListener('verify', verify)
  const candidates = [
    ...captcha.shadowRoot!.querySelectorAll<HTMLImageElement>('.cc-prize.cc-mahjong'),
  ]
  const target = captcha.currentMahjongTarget!
  const wrong = candidates.find((image) => image.dataset.tile !== target)!
  const winning = candidates.find((image) => image.dataset.tile === target)!

  for (const [image, expectedCount] of [
    [wrong, 0],
    [winning, 1],
  ] as const) {
    const x = Number.parseFloat(image.closest<HTMLElement>('.cc-toy-wrap')!.style.left)
    captcha.moveTo(x)
    captcha.pressAction()
    captcha.advance()
    expect((captcha as unknown as { phase: string }).phase).toBe('carry')
    captcha.moveTo(232)
    captcha.pressAction()
    captcha.advance(220)
    expect(verify).toHaveBeenCalledTimes(expectedCount)
  }
  const event = verify.mock.calls[0]![0] as CustomEvent
  expect(event.detail).toEqual({ mode: 'mahjong', source: 'local' })
  expect(event.bubbles).toBe(true)
  expect(event.composed).toBe(true)
})

test('remote mode creates before enabling controls and renders only opaque raster data', async () => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  let resolveCreate!: (value: unknown) => void
  const promise = new Promise<unknown>((resolve) => {
    resolveCreate = resolve
  })
  const captcha = createTestCaptcha()
  captcha.verificationTransport = vi.fn(() => promise)
  document.body.append(captcha)
  await vi.waitFor(() => expect(captcha.verificationTransport).toHaveBeenCalledOnce())
  expect(captcha.shadowRoot!.querySelector<HTMLButtonElement>('.cc-action')!.disabled).toBe(true)
  resolveCreate(opaqueChallenge())
  await vi.waitFor(() =>
    expect(captcha.shadowRoot!.querySelectorAll('.cc-prize.cc-mahjong')).toHaveLength(12),
  )
  await vi.waitFor(() => {
    expect(captcha.operationState().loadingChallenge).toBe(false)
    expect(captcha.operationState().issuedChallenge).not.toBeNull()
  })
  captcha.settlePile()
  await captcha.updateComplete
  expect(captcha.operationState()).toMatchObject({ pileSettled: true, landed: 12, softCount: 12 })
  expect(captcha.shadowRoot!.querySelector<HTMLButtonElement>('.cc-action')!.disabled).toBe(false)
  expect(captcha.mahjongHand).toEqual([])
  expect(captcha.currentMahjongTarget).toBeNull()
  expect(captcha.shadowRoot!.querySelectorAll('[data-tile], [data-suit]')).toHaveLength(0)
  expect(captcha.shadowRoot!.querySelector('.clawcap-hand-image')?.getAttribute('src')).toBe(
    '/api/captcha/assets/hand',
  )
})

test('remote verification sends exact v3 payloads and succeeds only after verified true', async () => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  const requests: unknown[] = []
  const captcha = createTestCaptcha()
  captcha.verificationData = '{"scene":"login"}'
  captcha.verificationTransport = vi.fn(async ({ request }) => {
    requests.push(request)
    return request.action === 'create'
      ? opaqueChallenge()
      : { verified: true, token: 'result-token', expiresAt: '2026-08-04T12:00:00Z' }
  })
  const verify = vi.fn()
  captcha.addEventListener('verify', verify)
  document.body.append(captcha)
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  captcha.completeRemote('candidate-7')
  expect(verify).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(verify).toHaveBeenCalledOnce())
  expect(requests).toEqual([
    { version: 3, action: 'create', mode: 'mahjong', context: { scene: 'login' } },
    {
      version: 3,
      action: 'verify',
      challengeId: 'challenge-1',
      completion: { selected: 'candidate-7' },
      context: { scene: 'login' },
    },
  ])
  expect((verify.mock.calls[0]![0] as CustomEvent).detail).toEqual({
    mode: 'mahjong',
    source: 'remote',
    token: 'result-token',
    expiresAt: '2026-08-04T12:00:00Z',
  })
})

test('injected transport takes precedence over fetch and receives AbortSignal', async () => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const calls: PlayCaptchaVerificationTransportInput[] = []
  const captcha = createTestCaptcha()
  captcha.verifyEndpoint = '/ignored'
  captcha.verificationTransport = vi.fn(async (input) => {
    calls.push(input)
    return input.request.action === 'create' ? opaqueChallenge() : { verified: true }
  })
  document.body.append(captcha)
  await vi.waitFor(() => expect(calls).toHaveLength(1))
  captcha.completeRemote('candidate-2')
  await vi.waitFor(() => expect(calls).toHaveLength(2))
  expect(fetchMock).not.toHaveBeenCalled()
  expect(calls.every(({ signal }) => signal instanceof AbortSignal)).toBe(true)
})

test.each([
  ['schema', () => Promise.resolve({ version: 3 }), 'response'],
  ['network', () => Promise.reject(new TypeError('offline')), 'network'],
] as const)(
  'reports %s create failures and keeps controls disabled',
  async (_name, implementation, kind) => {
    const captcha = createTestCaptcha()
    captcha.verificationTransport = vi.fn(implementation)
    const error = vi.fn()
    captcha.addEventListener('verification-error', error)
    document.body.append(captcha)
    await vi.waitFor(() => expect(error).toHaveBeenCalledOnce())
    expect((error.mock.calls[0]![0] as CustomEvent).detail.kind).toBe(kind)
    expect(captcha.shadowRoot!.querySelector<HTMLButtonElement>('.cc-action')!.disabled).toBe(true)
  },
)

test('reports HTTP failures from fetch', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
  const captcha = createTestCaptcha()
  captcha.verifyEndpoint = '/api/captcha'
  const error = vi.fn()
  captcha.addEventListener('verification-error', error)
  document.body.append(captcha)
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce())
  expect((error.mock.calls[0]![0] as CustomEvent).detail).toMatchObject({
    kind: 'http',
    status: 503,
  })
})

test('a consumed rejection emits no success and loads a fresh challenge', async () => {
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1)
  const actions: string[] = []
  const captcha = createTestCaptcha()
  captcha.verificationTransport = vi.fn(async ({ request }) => {
    actions.push(request.action)
    if (request.action === 'create') return opaqueChallenge(`challenge-${actions.length}`)
    return { verified: false, message: 'wrong' }
  })
  const verify = vi.fn()
  const error = vi.fn()
  captcha.addEventListener('verify', verify)
  captcha.addEventListener('verification-error', error)
  document.body.append(captcha)
  await vi.waitFor(() => expect(actions).toEqual(['create']))
  captcha.completeRemote('candidate-3')
  await vi.waitFor(() => expect(actions).toEqual(['create', 'verify', 'create']))
  expect(verify).not.toHaveBeenCalled()
  expect((error.mock.calls[0]![0] as CustomEvent).detail.kind).toBe('rejected')
})

test('refresh aborts an in-flight create and issues a replacement', async () => {
  const signals: AbortSignal[] = []
  let count = 0
  const captcha = createTestCaptcha()
  captcha.verificationTransport = vi.fn(({ signal }) => {
    signals.push(signal)
    count += 1
    return count === 1 ? new Promise<unknown>(() => undefined) : Promise.resolve(opaqueChallenge())
  })
  document.body.append(captcha)
  await vi.waitFor(() => expect(signals).toHaveLength(1))
  captcha.shadowRoot!.querySelector<HTMLButtonElement>('.clawcap-refresh')!.click()
  await vi.waitFor(() => expect(signals).toHaveLength(2))
  expect(signals[0]!.aborted).toBe(true)
})

test('expired issued challenge refreshes automatically', async () => {
  const creates: string[] = []
  const captcha = createTestCaptcha()
  captcha.verificationTransport = vi.fn(async ({ request }) => {
    if (request.action !== 'create') return { verified: false }
    creates.push(request.action)
    return opaqueChallenge(`challenge-${creates.length}`, creates.length === 1 ? 100 : 60_000)
  })
  document.body.append(captcha)
  await vi.waitFor(() => expect(creates).toHaveLength(2), { timeout: 1_500 })
  expect(captcha.shadowRoot!.querySelector('.cc-countdown')).toBeNull()
})

test('invalid remote configuration emits config error without fetch', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const captcha = createTestCaptcha()
  captcha.verifyEndpoint = 'data:text/plain,no'
  const error = vi.fn()
  captcha.addEventListener('verification-error', error)
  document.body.append(captcha)
  await vi.waitFor(() => expect(error).toHaveBeenCalledOnce())
  expect((error.mock.calls[0]![0] as CustomEvent).detail.kind).toBe('config')
  expect(fetchMock).not.toHaveBeenCalled()
})
