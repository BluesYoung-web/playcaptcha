import { LitElement, html, nothing, svg, unsafeCSS, type PropertyValues } from 'lit'
import { keyed } from 'lit/directives/keyed.js'

import { CLAW_ARM_L, CLAW_ARM_R, CLAW_BODY, CLAW_PIVOT } from './clawArt.ts'
import clawCaptchaCss from './clawcaptcha.css?inline'
import { DEFAULT_LOGO_URL, DEFAULT_MAHJONG_URLS } from './defaultAssets.ts'
import {
  DEFAULT_PLAY_CAPTCHA_LOCALE,
  PLAY_CAPTCHA_MESSAGES,
  normalizeLocale,
  type PlayCaptchaLocale,
} from './i18n.ts'
import {
  MAHJONG_TILE_META,
  createMahjongChallenge,
  sortMahjongTiles,
  type MahjongTileId,
} from './mahjong.ts'
import {
  CLAW_MAX,
  CLAW_MIN,
  COIL_LEN,
  CONFETTI,
  GH,
  GW,
  HOME_Y,
  RAIL_Y,
  T,
  clamp01,
  easeInOutCubic,
  easeInQuad,
  easeOutCubic,
  logicalDelta,
  nearestCandidateAt,
  pileItemCenter,
  rectToLogicalOverlay,
  rectToLogicalTray,
  scatterMahjongPile,
  type LogicalTray,
  type Phase,
  type Slot,
  type Soft,
} from './simulation.ts'
import {
  DEFAULT_VERIFICATION_TIMEOUT,
  normalizeVerificationEndpoint,
  normalizeVerificationTimeout,
  parseIssuedChallenge,
  parseVerificationContext,
  parseVerificationResponse,
  type PlayCaptchaCreateChallengeRequest,
  type PlayCaptchaIssuedChallenge,
  type PlayCaptchaVerificationErrorDetail,
  type PlayCaptchaVerificationRequest,
  type PlayCaptchaVerificationResponse,
  type PlayCaptchaVerificationTransport,
  type PlayCaptchaVerifyEventDetail,
} from './verification.ts'

const DEFAULT_MAHJONG_BASE = new URL('../assets/majiang_ui/', import.meta.url).href
const DROP_Y = 198
const ANTIC_RISE = 8
const DROP_G = 1150
const ENTRANCE_G = 1500
// happy-dom has no layout; browser runtime replaces this from real rects before tray decisions.
const ZERO_LAYOUT_TRAY: LogicalTray = {
  cx: 232,
  cy: GH + 56,
  min: 150,
  max: 320,
  mouthY: 353,
  scale: 1,
}

class VerificationRequestFailure extends Error {
  constructor(
    readonly kind: 'http' | 'response',
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

type Stage =
  | ''
  | 'antic'
  | 'down'
  | 'dwell1'
  | 'close'
  | 'dwell2'
  | 'load'
  | 'up'
  | 'open'
  | 'beat'
  | 'shine'
type TrayMode = '' | 'open' | 'win' | 'no' | 'checking' | 'loading'
type Feedback =
  | { kind: 'empty' | 'move-to-tray' }
  | { kind: 'wrong'; caughtTile?: MahjongTileId }
  | { kind: 'verification'; error: PlayCaptchaVerificationErrorDetail }
  | null

interface MahjongState {
  hand: readonly MahjongTileId[]
  candidates: readonly MahjongTileId[]
  winningTile?: MahjongTileId
}

interface RemoteMahjongState {
  handImage: string
  candidateBySlot: ReadonlyArray<{ id: string; image: string }>
}

interface Sim {
  x: number
  y: number
  vx: number
  drive: number
  sway: number
  swayV: number
  breeze: number
  close: number
  carried: number
  carry: { x: number; y: number }
  stage: Stage
  st: number
  depthY: number
  fallV: number
  stretch: number
  carrySq: number
  xrot: number
  swallow: number
  released: boolean
  mouthY: number
}

function assetDirectory(value: string): URL {
  let directory: URL
  try {
    const input = value.trim()
    directory = new URL(input || DEFAULT_MAHJONG_BASE, document.baseURI)
    if (
      directory.href !== DEFAULT_MAHJONG_BASE &&
      !['http:', 'https:'].includes(directory.protocol)
    ) {
      throw new TypeError('Asset base must be an HTTP(S) hierarchy URL')
    }
  } catch {
    directory = new URL(DEFAULT_MAHJONG_BASE)
  }
  directory.search = ''
  directory.hash = ''
  if (!directory.pathname.endsWith('/')) directory.pathname += '/'
  return directory
}

function freshSim(): Sim {
  return {
    x: GW / 2,
    y: HOME_Y,
    vx: 0,
    drive: 0,
    sway: 0,
    swayV: 0,
    breeze: 0,
    close: 0,
    carried: -1,
    carry: { x: 0, y: 0 },
    stage: '',
    st: 0,
    depthY: DROP_Y,
    fallV: 0,
    stretch: 0,
    carrySq: 0,
    xrot: 0,
    swallow: 0,
    released: false,
    mouthY: 353,
  }
}

function freshSoft(pile: readonly Slot[]): Soft[] {
  return pile.map((slot) => ({
    dx: 0,
    dy: 0,
    rot: 0,
    sq: 0,
    vdx: 0,
    vdy: 0,
    vrot: 0,
    vsq: 0,
    ey: slot.dropFrom,
    evy: 0,
    delay: slot.delay,
    landed: false,
  }))
}

export class PlayCaptcha extends LitElement {
  private static readonly infoStacks = new WeakMap<
    Window,
    { instances: PlayCaptcha[]; listener: (event: KeyboardEvent) => void }
  >()

  private static closeTopInfo(infoWindow: Window, event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    const stack = PlayCaptcha.infoStacks.get(infoWindow)
    const instances = stack?.instances
    while (instances?.length) {
      const candidate = instances[instances.length - 1]!
      if (candidate.isConnected && candidate.runtimeActive && candidate.infoOpen) break
      candidate.infoWindow = null
      instances.pop()
    }
    const top = instances?.[instances.length - 1]
    if (!top) {
      if (stack) {
        infoWindow.removeEventListener('keydown', stack.listener)
        PlayCaptcha.infoStacks.delete(infoWindow)
      }
      return
    }
    event.preventDefault()
    top.closeInfo()
  }

  private static addOpenInfo(instance: PlayCaptcha): void {
    PlayCaptcha.removeOpenInfo(instance)
    const infoWindow = instance.ownerDocument.defaultView
    if (!infoWindow || !instance.runtimeActive) return
    let stack = PlayCaptcha.infoStacks.get(infoWindow)
    if (!stack) {
      stack = {
        instances: [],
        listener: (event) => PlayCaptcha.closeTopInfo(infoWindow, event),
      }
      PlayCaptcha.infoStacks.set(infoWindow, stack)
      infoWindow.addEventListener('keydown', stack.listener)
    }
    stack.instances.push(instance)
    instance.infoWindow = infoWindow
  }

  private static removeOpenInfo(instance: PlayCaptcha): void {
    const infoWindow = instance.infoWindow
    if (!infoWindow) return
    const stack = PlayCaptcha.infoStacks.get(infoWindow)
    if (stack) {
      const index = stack.instances.indexOf(instance)
      if (index !== -1) stack.instances.splice(index, 1)
      if (stack.instances.length === 0) {
        infoWindow.removeEventListener('keydown', stack.listener)
        PlayCaptcha.infoStacks.delete(infoWindow)
      }
    }
    instance.infoWindow = null
  }

  static properties = {
    locale: {
      reflect: true,
      converter: {
        fromAttribute: (value: string | null) => normalizeLocale(value),
        toAttribute: (value: PlayCaptchaLocale) => value,
      },
    },
    showAnswer: { type: Boolean, attribute: 'show-answer', reflect: true },
    title: { type: String },
    verifyEndpoint: { type: String, attribute: 'verify-endpoint' },
    verifyTimeout: { type: Number, attribute: 'verify-timeout' },
    verificationData: { type: String, attribute: 'verification-data' },
    assetBase: { type: String, attribute: 'asset-base' },
    infoOpen: { state: true },
    phase: { state: true },
    feedback: { state: true },
    verified: { state: true },
    overTray: { state: true },
    trayMode: { state: true },
    carriedMahjongTile: { state: true },
    challengeSecondsRemaining: { state: true },
  }
  static styles = unsafeCSS(clawCaptchaCss)

  declare locale: PlayCaptchaLocale
  declare showAnswer: boolean
  declare assetBase: string
  declare verifyEndpoint: string
  declare verifyTimeout: number
  declare verificationData: string
  verificationHeaders: Record<string, string> = {}
  verificationCredentials: RequestCredentials = 'same-origin'
  private _verificationTransport: PlayCaptchaVerificationTransport | undefined
  private infoOpen = false
  private phase: Phase = 'idle'
  private feedback: Feedback = null
  private verified = false
  private overTray = false
  private trayMode: TrayMode = ''
  private pile: Slot[]
  private mahjong: MahjongState | null = null
  private mahjongTileBySlot: readonly MahjongTileId[] = []
  private remoteMahjong: RemoteMahjongState | null = null
  private carriedMahjongTile: MahjongTileId | null = null
  private carriedRemoteImage: string | null = null
  private soft: Soft[]
  private sim = freshSim()
  private direction = 0
  private pressedKeys = new Set<string>()
  private drag: { id: number; startX: number; capture: HTMLElement } | null = null
  private legacyInputWindow: Window | null = null
  private raf = 0
  private prevNow = 0
  private scale = 1
  private reduce = false
  private pileSettled = false
  private media: MediaQueryList | null = null
  private resizeObserver: ResizeObserver | null = null
  private hostResizeObserver: ResizeObserver | null = null
  private resizeWindow: Window | null = null
  private infoWindow: Window | null = null
  private runtimeActive = false
  private compact = false
  private verifySent = false
  private tray: LogicalTray = { ...ZERO_LAYOUT_TRAY }
  private titleOverride: string | null = null
  private verificationController: AbortController | null = null
  private verificationRun = 0
  private verifying = false
  private pendingCompletion: {
    selectedTile?: MahjongTileId
    selectedCandidate?: string
  } | null = null
  private issuedChallenge: PlayCaptchaIssuedChallenge | null = null
  private loadingChallenge = false
  private challengeSecondsRemaining: number | null = null
  private challengeDeadline = 0
  private challengeTimer: number | null = null

  constructor() {
    super()
    this.showAnswer = false
    this.locale = DEFAULT_PLAY_CAPTCHA_LOCALE
    this.assetBase = DEFAULT_MAHJONG_BASE
    this.verifyEndpoint = ''
    this.verifyTimeout = DEFAULT_VERIFICATION_TIMEOUT
    this.verificationData = ''
    this.pile = []
    this.soft = []
    this.resetMahjongChallenge()
  }

  get currentMahjongTarget(): MahjongTileId | null {
    return this.mahjong?.winningTile ?? null
  }

  get mahjongHand(): readonly MahjongTileId[] {
    return this.mahjong?.hand ?? []
  }

  get title(): string {
    return this.titleOverride ?? PLAY_CAPTCHA_MESSAGES[this.locale].defaultTitle
  }

  set title(value: string) {
    const previous = this.title
    this.titleOverride = value
    this.requestUpdate('title', previous)
  }

  get verificationTransport(): PlayCaptchaVerificationTransport | undefined {
    return this._verificationTransport
  }

  set verificationTransport(value: PlayCaptchaVerificationTransport | undefined) {
    if (value === this._verificationTransport) return
    this._verificationTransport = value
    this.issuedChallenge = null
    this.cancelVerification()
    if (this.remoteEnabled && this.isConnected) void this.loadIssuedChallenge()
    else this.resetMahjongChallenge()
  }

  connectedCallback(): void {
    super.connectedCallback()
    void this.updateComplete.then(() => {
      if (!this.isConnected) return
      this.startRuntime()
      if (this.remoteEnabled && !this.loadingChallenge && !this.issuedChallenge) {
        void this.loadIssuedChallenge()
      }
    })
  }

  disconnectedCallback(): void {
    this.stopRuntime()
    super.disconnectedCallback()
  }

  attributeChangedCallback(name: string, oldValue: string | null, value: string | null): void {
    if (name === 'title') {
      const previous = this.title
      this.titleOverride = value
      this.requestUpdate('title', previous)
      return
    }
    super.attributeChangedCallback(name, oldValue, value)
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has('verifyEndpoint') && changed.get('verifyEndpoint') !== undefined) {
      this.issuedChallenge = null
      if (this.remoteEnabled) {
        void this.updateComplete.then(() => {
          if (this.isConnected && !this.loadingChallenge && !this.issuedChallenge) {
            void this.loadIssuedChallenge()
          }
        })
      } else {
        this.resetMahjongChallenge()
      }
    }
    if (changed.has('locale')) {
      const normalized = normalizeLocale(this.locale)
      if (normalized !== this.locale) this.locale = normalized
      if (this.getAttribute('locale') !== normalized) this.setAttribute('locale', normalized)
    }
    if (changed.has('verifyTimeout')) {
      const normalized = normalizeVerificationTimeout(this.verifyTimeout)
      if (normalized !== this.verifyTimeout) this.verifyTimeout = normalized
      if (
        this.hasAttribute('verify-timeout') &&
        this.getAttribute('verify-timeout') !== String(normalized)
      ) {
        this.setAttribute('verify-timeout', String(normalized))
      }
    }
    if (changed.has('assetBase')) {
      const normalized = assetDirectory(this.assetBase).href
      if (normalized !== this.assetBase) this.assetBase = normalized
      if (this.hasAttribute('asset-base') && this.getAttribute('asset-base') !== normalized) {
        this.setAttribute('asset-base', normalized)
      }
    }
  }

  private get remoteEnabled(): boolean {
    return this._verificationTransport !== undefined || this.verifyEndpoint.trim() !== ''
  }

  private acceptVerification(result: {
    source: 'local' | 'remote'
    response?: PlayCaptchaVerificationResponse
  }): void {
    if (this.verifySent) return
    this.verifying = false
    this.verified = true
    this.trayMode = 'win'
    this.verifySent = true
    this.clearChallengeClock()
    const detail: PlayCaptchaVerifyEventDetail = {
      mode: 'mahjong',
      source: result.source,
      ...(result.response?.token === undefined ? {} : { token: result.response.token }),
      ...(result.response?.expiresAt === undefined ? {} : { expiresAt: result.response.expiresAt }),
    }
    this.handleSuccessfulVerification(detail)
    this.requestUpdate()
  }

  private cancelVerification(): void {
    this.verificationRun += 1
    this.verificationController?.abort()
    this.verificationController = null
    this.verifying = false
    this.loadingChallenge = false
  }

  private dispatchVerificationError(detail: PlayCaptchaVerificationErrorDetail): void {
    this.dispatchEvent(
      new CustomEvent<PlayCaptchaVerificationErrorDetail>('verification-error', {
        detail,
        bubbles: true,
        composed: true,
      }),
    )
  }

  private verificationFailure(detail: PlayCaptchaVerificationErrorDetail): void {
    this.verifying = false
    this.issuedChallenge = null
    this.clearChallengeClock()
    this.trayMode = 'no'
    this.feedback = { kind: 'verification', error: detail }
    this.pendingCompletion = null
    this.sim.stage = ''
    this.pileElements.forEach((element) => {
      element.style.visibility = ''
    })
    this.soft.forEach((body) => {
      body.dx = 0
      body.dy = 0
      body.rot = 0
      body.sq = 0
    })
    this.sim = freshSim()
    this.carriedMahjongTile = null
    this.pileSettled = false
    this.setPhase('idle')
    this.dispatchVerificationError(detail)
    if (detail.kind !== 'config' && this.remoteEnabled && this.isConnected) {
      void this.loadIssuedChallenge()
    }
  }

  private challengeFailure(detail: PlayCaptchaVerificationErrorDetail): void {
    this.loadingChallenge = false
    this.issuedChallenge = null
    this.trayMode = 'no'
    this.feedback = { kind: 'verification', error: detail }
    this.pileSettled = false
    this.requestUpdate()
    this.dispatchVerificationError(detail)
  }
  private clearChallengeClock(): void {
    clearInterval(this.challengeTimer ?? undefined)
    this.challengeTimer = null
    this.challengeDeadline = 0
    this.challengeSecondsRemaining = null
  }

  private startChallengeClock(expiresAt: string | undefined): void {
    this.clearChallengeClock()
    if (!expiresAt) return
    const deadline = Date.parse(expiresAt)
    if (!Number.isFinite(deadline)) return
    this.challengeDeadline = deadline
    this.updateChallengeCountdown()
    if (this.challengeDeadline > 0) {
      this.challengeTimer = window.setInterval(this.updateChallengeCountdown, 250)
    }
  }

  private updateChallengeCountdown = (): void => {
    if (this.challengeDeadline <= 0) return
    const remaining = Math.max(0, Math.ceil((this.challengeDeadline - Date.now()) / 1000))
    if (remaining !== this.challengeSecondsRemaining) {
      this.challengeSecondsRemaining = remaining
      this.requestUpdate()
    }
    if (remaining > 0) return
    clearInterval(this.challengeTimer ?? undefined)
    this.challengeTimer = null
    this.challengeDeadline = 0
    if (!this.verifying && !this.loadingChallenge && this.issuedChallenge && this.isConnected) {
      this.issuedChallenge = null
      void this.loadIssuedChallenge()
    }
  }

  private requestConfiguration(): { endpoint: string | null; context: unknown } | null {
    const parsed = parseVerificationContext(this.verificationData)
    if (!parsed.valid) return null
    if (this._verificationTransport) return { endpoint: null, context: parsed.context }
    const endpoint = normalizeVerificationEndpoint(this.verifyEndpoint, this.ownerDocument.baseURI)
    return endpoint ? { endpoint, context: parsed.context } : null
  }

  private async performVerificationRequest(
    configuration: { endpoint: string | null },
    request: PlayCaptchaVerificationRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    if (this._verificationTransport) return this._verificationTransport({ request, signal })
    const response = await fetch(configuration.endpoint!, {
      method: 'POST',
      headers: {
        ...this.verificationHeaders,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: this.verificationCredentials,
      body: JSON.stringify(request),
      signal,
    })
    if (!response.ok) {
      throw new VerificationRequestFailure(
        'http',
        `Verification request failed with HTTP ${response.status}`,
        response.status,
      )
    }
    try {
      return await response.json()
    } catch {
      throw new VerificationRequestFailure('response', 'Invalid verification JSON')
    }
  }
  private applyIssuedChallenge(challenge: PlayCaptchaIssuedChallenge): void {
    this.issuedChallenge = challenge
    this.mahjong = null
    this.mahjongTileBySlot = []
    this.remoteMahjong = {
      handImage: challenge.challenge.handImage,
      candidateBySlot: challenge.challenge.candidates,
    }
    this.pile = scatterMahjongPile(0, challenge.challenge.candidates.length).map((slot) => ({
      ...slot,
      w: Math.min(slot.w, 70),
      rot: Math.max(-5, Math.min(5, slot.rot)),
    }))
    this.loadingChallenge = false
    this.resetRuntimeState(false)
    this.startChallengeClock(challenge.expiresAt)
    this.requestUpdate()
  }

  private async loadIssuedChallenge(): Promise<void> {
    const configuration = this.requestConfiguration()
    if (!configuration) {
      this.challengeFailure({ kind: 'config', message: 'Invalid verification configuration' })
      return
    }
    this.cancelVerification()
    this.resetRuntimeState(false)
    const run = this.verificationRun
    const controller = new AbortController()
    this.verificationController = controller
    this.loadingChallenge = true
    this.issuedChallenge = null
    this.pileSettled = false
    this.feedback = null
    this.trayMode = 'loading'
    this.requestUpdate()
    const request: PlayCaptchaCreateChallengeRequest = {
      version: 3,
      action: 'create',
      mode: 'mahjong',
      context: configuration.context,
    }
    const timeout = setTimeout(() => controller.abort('timeout'), this.verifyTimeout)
    try {
      const body = await this.performVerificationRequest(configuration, request, controller.signal)
      if (run !== this.verificationRun) return
      const challenge = parseIssuedChallenge(body)
      if (!challenge) {
        this.challengeFailure({ kind: 'response', message: 'Invalid challenge response' })
        return
      }
      this.applyIssuedChallenge(challenge)
    } catch (error) {
      if (run !== this.verificationRun) return
      const timedOut = controller.signal.aborted && controller.signal.reason === 'timeout'
      const failure = error instanceof VerificationRequestFailure ? error : null
      this.challengeFailure({
        kind: timedOut ? 'timeout' : (failure?.kind ?? 'network'),
        message: timedOut ? 'Challenge request timed out' : (failure?.message ?? String(error)),
        ...(failure?.status === undefined ? {} : { status: failure.status }),
      })
    } finally {
      clearTimeout(timeout)
      if (run === this.verificationRun) this.verificationController = null
    }
  }

  private verificationRequest(context: unknown): PlayCaptchaVerificationRequest | null {
    const selected = this.pendingCompletion?.selectedCandidate
    if (!this.issuedChallenge || !selected) return null
    return {
      version: 3,
      action: 'verify',
      challengeId: this.issuedChallenge.challengeId,
      completion: { selected },
      context,
    }
  }

  private async verifyWithBackend(): Promise<void> {
    if (this.verifying) return
    const configuration = this.requestConfiguration()
    const request = configuration ? this.verificationRequest(configuration.context) : null
    if (!configuration || !request) {
      this.verificationFailure({ kind: 'config', message: 'Invalid verification configuration' })
      return
    }
    this.cancelVerification()
    const run = this.verificationRun
    const controller = new AbortController()
    this.verificationController = controller
    this.verifying = true
    this.trayMode = 'checking'
    this.requestUpdate()
    const timeout = setTimeout(() => controller.abort('timeout'), this.verifyTimeout)
    try {
      const body = await this.performVerificationRequest(configuration, request, controller.signal)
      if (run !== this.verificationRun) return
      const result = parseVerificationResponse(body)
      if (!result) {
        this.verificationFailure({ kind: 'response', message: 'Invalid verification response' })
      } else if (!result.verified) {
        this.verificationFailure({
          kind: 'rejected',
          message: result.message ?? 'Verification rejected',
        })
      } else {
        this.pendingCompletion = null
        this.issuedChallenge = null
        this.acceptVerification({ source: 'remote', response: result })
      }
    } catch (error) {
      if (run !== this.verificationRun) return
      const timedOut = controller.signal.aborted && controller.signal.reason === 'timeout'
      const failure = error instanceof VerificationRequestFailure ? error : null
      this.verificationFailure({
        kind: timedOut ? 'timeout' : (failure?.kind ?? 'network'),
        message: timedOut ? 'Verification request timed out' : (failure?.message ?? String(error)),
        ...(failure?.status === undefined ? {} : { status: failure.status }),
      })
    } finally {
      clearTimeout(timeout)
      if (run === this.verificationRun) this.verificationController = null
    }
  }

  protected updated(changed: PropertyValues): void {
    if (changed.has('infoOpen')) {
      if (this.infoOpen)
        this.renderRoot.querySelector<HTMLButtonElement>('.clawcap-info-x')?.focus()
      else if (changed.get('infoOpen') === true)
        this.renderRoot.querySelector<HTMLButtonElement>('.clawcap-help')?.focus()
    }
    if (changed.has('phase')) {
      if (this.runtimeActive) this.observeGlass()
      this.renderFrame()
    }
  }

  protected handleSuccessfulVerification(detail: PlayCaptchaVerifyEventDetail): void {
    this.dispatchEvent(new CustomEvent('verify', { detail, bubbles: true, composed: true }))
  }

  protected setClawPosition(x: number): void {
    this.sim.x = Math.min(CLAW_MAX, Math.max(CLAW_MIN, x))
    this.renderFrame()
  }

  protected activate(): void {
    this.action()
  }

  protected advanceSimulation(now: number): void {
    this.step(now, false)
  }

  private resetMahjongChallenge(): void {
    this.remoteMahjong = null
    this.mahjong = createMahjongChallenge()
    const winningTile = this.mahjong.winningTile
    if (!winningTile) throw new Error('Local mahjong challenge requires a winning tile')
    this.mahjongTileBySlot = this.mahjong.candidates
    const targetIdentity = this.mahjong.candidates.indexOf(winningTile)
    this.pile = scatterMahjongPile(targetIdentity, this.mahjong.candidates.length).map((slot) => ({
      ...slot,
      w: Math.min(slot.w, 70),
      rot: Math.max(-5, Math.min(5, slot.rot)),
    }))
    this.resetRuntimeState()
  }

  private resetRuntimeState(cancelRequest = true): void {
    this.soft = freshSoft(this.pile)
    this.clearChallengeClock()
    this.pendingCompletion = null
    if (cancelRequest) this.cancelVerification()
    if (this.renderRoot) {
      this.pileElements.forEach((element) => {
        element.style.visibility = ''
      })
      if (this.carriedElement) {
        this.carriedElement.style.visibility = 'hidden'
        this.clearCarriedStyles()
      }
    }
    this.pileSettled = this.reduce
    this.sim = freshSim()
    this.phase = 'idle'
    this.feedback = null
    this.verified = false
    this.overTray = false
    this.trayMode = ''
    this.verifySent = false
    this.carriedMahjongTile = null
    this.direction = 0
    this.pressedKeys.clear()
    this.finishDrag()
    this.prevNow = 0
    if (this.reduce) this.setReducedPile()
    this.ensureFrame()
    this.carriedRemoteImage = null
    this.requestUpdate()
  }

  private refreshChallenge = (): void => {
    if (this.remoteEnabled) void this.loadIssuedChallenge()
    else this.resetMahjongChallenge()
  }

  private startRuntime(): void {
    if (this.runtimeActive) return
    this.runtimeActive = true
    if (this.infoOpen) PlayCaptcha.addOpenInfo(this)
    this.media = window.matchMedia?.('(prefers-reduced-motion: reduce)') ?? null
    this.reduce = this.media?.matches ?? false
    if (this.media && typeof this.media.addEventListener === 'function') {
      this.media.addEventListener('change', this.onMotionChange)
    } else {
      this.media?.addListener(this.onMotionChange)
    }
    this.observeHost()
    this.addLegacyInputFallback()
    this.observeGlass()
    if (this.reduce) this.setReducedPile()
    this.renderFrame()
    this.ensureFrame()
  }

  private setCompact(width: number): void {
    const compact = width > 0 && width <= 260
    if (compact === this.compact) return
    this.compact = compact
    this.requestUpdate()
  }

  private measureCompact(): void {
    this.setCompact(this.getBoundingClientRect().width)
  }

  private observeHost(): void {
    this.hostResizeObserver?.disconnect()
    this.hostResizeObserver = null
    this.resizeWindow?.removeEventListener('resize', this.onWindowResize)
    this.resizeWindow = null
    this.measureCompact()
    if (typeof ResizeObserver !== 'undefined') {
      this.hostResizeObserver = new ResizeObserver((entries) => {
        this.setCompact(entries[0]?.contentRect.width || this.getBoundingClientRect().width)
      })
      this.hostResizeObserver.observe(this)
      return
    }
    const resizeWindow = this.ownerDocument.defaultView
    if (!resizeWindow) return
    this.resizeWindow = resizeWindow
    resizeWindow.addEventListener('resize', this.onWindowResize)
  }

  private onWindowResize = (): void => {
    this.measureCompact()
    this.measureGlass()
  }

  private observeGlass(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    const glass = this.renderRoot.querySelector<HTMLElement>('.clawcap-glass')
    if (!glass) return
    const update = (width: number): void => {
      this.scale = width > 0 ? width / GW : 1
      glass.style.setProperty('--cc-scale', String(this.scale))
      if (width > 0) glass.style.height = `${(width * GH) / GW}px`
      this.updateOverlayGeometry(width)
      this.updateTrayGeometry()
      this.renderFrame()
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        update(entries[0]?.contentRect.width || glass.getBoundingClientRect().width)
      })
      this.resizeObserver.observe(glass)
    }
    update(glass.getBoundingClientRect().width)
  }

  private measureGlass(): void {
    const glass = this.renderRoot.querySelector<HTMLElement>('.clawcap-glass')
    if (!glass) return
    const width = glass.getBoundingClientRect().width
    this.scale = width > 0 ? width / GW : 1
    glass.style.setProperty('--cc-scale', String(this.scale))
    if (width > 0) glass.style.height = `${(width * GH) / GW}px`
    this.updateOverlayGeometry(width)
    this.updateTrayGeometry()
    this.renderFrame()
  }

  private updateOverlayGeometry(width?: number): void {
    const machine = this.renderRoot
      .querySelector<HTMLElement>('.clawcap-machine')
      ?.getBoundingClientRect()
    const glassElement = this.renderRoot.querySelector<HTMLElement>('.clawcap-glass')
    const glassRect = glassElement?.getBoundingClientRect()
    const overlay = this.renderRoot.querySelector<HTMLElement>('.cc-carry-overlay')
    if (!machine || !glassRect || !overlay) return
    const geometry = rectToLogicalOverlay(
      { left: machine.left, top: machine.top },
      {
        left: glassRect.left,
        top: glassRect.top,
        width: width && width > 0 ? width : glassRect.width,
      },
    )
    overlay.style.left = `${geometry.left}px`
    overlay.style.top = `${geometry.top}px`
    overlay.style.setProperty('--cc-scale', String(geometry.scale))
  }

  private updateTrayGeometry(): void {
    const glass = this.renderRoot
      .querySelector<HTMLElement>('.clawcap-glass')
      ?.getBoundingClientRect()
    const tray = this.renderRoot.querySelector<HTMLElement>('.cc-tray')?.getBoundingClientRect()
    if (glass && tray && glass.width > 0 && (tray.width > 0 || tray.right > tray.left)) {
      this.tray = rectToLogicalTray(glass, tray)
      this.sim.mouthY = this.tray.mouthY
    }
  }

  private ensureFrame(): void {
    if (!this.raf && this.isConnected) this.raf = requestAnimationFrame(this.frame)
  }

  private addLegacyInputFallback(): void {
    if (typeof PointerEvent !== 'undefined') return
    const inputWindow = this.ownerDocument.defaultView
    if (!inputWindow || this.legacyInputWindow) return
    this.legacyInputWindow = inputWindow
    inputWindow.addEventListener('mousemove', this.onLegacyMouseMove)
    inputWindow.addEventListener('mouseup', this.onLegacyMouseEnd)
    inputWindow.addEventListener('touchmove', this.onLegacyTouchMove, { passive: false })
    inputWindow.addEventListener('touchend', this.onLegacyTouchEnd)
    inputWindow.addEventListener('touchcancel', this.onLegacyTouchEnd)
  }

  private removeLegacyInputFallback(): void {
    const inputWindow = this.legacyInputWindow
    if (!inputWindow) return
    inputWindow.removeEventListener('mousemove', this.onLegacyMouseMove)
    inputWindow.removeEventListener('mouseup', this.onLegacyMouseEnd)
    inputWindow.removeEventListener('touchmove', this.onLegacyTouchMove)
    inputWindow.removeEventListener('touchend', this.onLegacyTouchEnd)
    inputWindow.removeEventListener('touchcancel', this.onLegacyTouchEnd)
    this.legacyInputWindow = null
  }

  private stopRuntime(): void {
    this.cancelVerification()
    this.clearChallengeClock()
    this.runtimeActive = false
    PlayCaptcha.removeOpenInfo(this)
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.prevNow = 0
    this.direction = 0
    this.pressedKeys.clear()
    this.finishDrag()
    this.removeLegacyInputFallback()
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.hostResizeObserver?.disconnect()
    this.hostResizeObserver = null
    this.resizeWindow?.removeEventListener('resize', this.onWindowResize)
    this.resizeWindow = null
    if (this.media && typeof this.media.removeEventListener === 'function') {
      this.media.removeEventListener('change', this.onMotionChange)
    } else {
      this.media?.removeListener(this.onMotionChange)
    }
    this.media = null
  }

  private onMotionChange = (event: MediaQueryListEvent): void => {
    this.reduce = event.matches
    if (this.reduce) this.setReducedPile()
    else this.requestUpdate()
    this.renderFrame()
  }

  private setReducedPile(): void {
    this.soft.forEach((body) => {
      body.dx = 0
      body.dy = 0
      body.rot = 0
      body.sq = 0
      body.vdx = 0
      body.vdy = 0
      body.vrot = 0
      body.vsq = 0
      body.ey = 0
      body.evy = 0
      body.landed = true
    })
    this.sim.sway = 0
    this.sim.swayV = 0
    this.sim.breeze = 0
    if (!this.pileSettled) {
      this.pileSettled = true
      this.requestUpdate()
    }
  }

  private frame = (now: number): void => {
    this.step(now, true)
  }

  private step(now: number, schedule: boolean): void {
    if (this.prevNow && now <= this.prevNow) {
      if (schedule) {
        this.raf = 0
        if (this.phase !== 'done') this.ensureFrame()
      }
      return
    }
    const raw = this.prevNow ? Math.min(0.04, Math.max(0.004, (now - this.prevNow) / 1000)) : 1 / 60
    this.prevNow = now
    const dt = raw * (this.reduce ? 2.4 : 1)
    const f = dt * 60
    const s = this.sim
    const phase = this.phase

    if (!this.reduce) {
      const lean = phase === 'idle' || phase === 'carry' ? -s.vx * 0.042 : 0
      s.swayV += (lean - s.sway) * 0.05 * f
      s.swayV *= Math.pow(0.93, f)
      s.sway += s.swayV * f
      s.breeze = Math.sin(now / 1500) * 0.45 + Math.sin(now / 521) * 0.12
    }
    this.updateSoftBodies(dt, f)

    if (phase === 'idle' || phase === 'carry') {
      s.drive += (this.direction - s.drive) * (1 - Math.exp(-13 * dt))
      s.vx += s.drive * 720 * dt
      s.vx *= Math.exp(-5.5 * dt)
      s.x = Math.min(CLAW_MAX, Math.max(CLAW_MIN, s.x + s.vx * dt))
      if (phase === 'carry') {
        this.updateTrayGeometry()
        s.xrot += (s.sway * 0.5 - s.xrot) * (1 - Math.exp(-6 * dt))
        const end = this.pendulumEnd()
        s.carry = { x: end.x, y: this.gripY(end.y) }
        const over = s.x >= this.tray.min && s.x <= this.tray.max
        if (over !== this.overTray) {
          this.overTray = over
          this.requestUpdate()
        }
      }
    } else if (phase === 'seq') this.stepGrab(dt)
    else if (phase === 'toTray') this.stepDrop(dt)
    else if (phase === 'celebrate') {
      if (s.stage === 'beat' && this.stageProgress(0.28, dt) >= 1) {
        this.nextStage('shine')
        if (this.remoteEnabled) void this.verifyWithBackend()
        else this.acceptVerification({ source: 'local' })
        this.requestUpdate()
      } else if (s.stage === 'shine' && this.verified && this.stageProgress(0.7, dt) >= 1) {
        this.setPhase('done')
      }
    } else if (phase === 'deny') this.stepDeny(dt)

    this.renderFrame()
    if (schedule) {
      this.raf = 0
      if (this.phase !== 'done') this.ensureFrame()
    }
  }

  private updateSoftBodies(dt: number, f: number): void {
    this.soft.forEach((body, index) => {
      if (!body.landed) {
        if (body.delay > 0) body.delay -= dt
        else {
          body.evy += ENTRANCE_G * dt
          body.ey += body.evy * dt
          if (body.ey >= 0) {
            body.ey = 0
            body.landed = true
            body.vsq += Math.min(0.055, body.evy * 0.00006)
            body.vrot += this.random(-0.8, 0.8)
            this.ripple(this.pile[index]!.x, Math.min(0.22, body.evy * 0.0002), index)
          }
        }
      }
      body.vdx += -body.dx * 0.055 * f
      body.vdy += -body.dy * 0.055 * f
      body.vrot += -body.rot * 0.05 * f
      body.vsq += -body.sq * 0.13 * f
      body.vdx *= Math.pow(0.9, f)
      body.vdy *= Math.pow(0.9, f)
      body.vrot *= Math.pow(0.91, f)
      body.vsq *= Math.pow(0.84, f)
      body.dx += body.vdx * f
      body.dy += body.vdy * f
      body.rot += body.vrot * f
      body.sq += body.vsq * f
    })
    if (!this.pileSettled && this.soft.every((body) => body.landed)) {
      this.pileSettled = true
      this.requestUpdate()
    }
  }

  private stepGrab(dt: number): void {
    const s = this.sim
    if (s.stage === 'antic') {
      const p = this.stageProgress(T.antic, dt)
      s.y = HOME_Y - ANTIC_RISE * easeOutCubic(p)
      s.close = -0.55 * easeOutCubic(p)
      if (p >= 1) {
        const candidate = this.candidateAtClaw()
        s.depthY =
          candidate < 0
            ? DROP_Y
            : Math.min(
                GH - 46,
                Math.max(
                  HOME_Y + 50,
                  this.pileItemCenter(candidate).y - this.gripOffset - this.pile[candidate]!.w / 2,
                ),
              )
        this.nextStage('down')
      }
    } else if (s.stage === 'down') {
      const p = this.stageProgress(T.down, dt)
      s.y = HOME_Y - ANTIC_RISE + (s.depthY - HOME_Y + ANTIC_RISE) * easeInQuad(p)
      if (s.y > 130 && !this.reduce)
        this.pile.forEach((slot, index) => {
          const distance = Math.abs(slot.x - s.x)
          if (distance < 56) {
            const push = (1 - distance / 56) * 7 * dt
            this.soft[index]!.vsq += push * 0.012
          }
        })
      if (p >= 1) this.nextStage('dwell1')
    } else if (s.stage === 'dwell1') {
      const p = this.stageProgress(T.dwell1, dt)
      s.y = s.depthY + (this.reduce ? 0 : 3.5 * Math.sin(Math.PI * p))
      if (p >= 1) {
        s.y = s.depthY
        this.nextStage('close')
      }
    } else if (s.stage === 'close') {
      const p = this.stageProgress(T.close, dt)
      s.close = -0.55 + 1.55 * easeOutCubic(p)
      if (p >= 1) {
        s.carried = this.candidateAtClaw()
        if (s.carried >= 0) this.pickUp(s.carried)
        else this.ripple(s.x, 0.2)
        this.nextStage('dwell2')
      }
    } else if (s.stage === 'dwell2') {
      if (this.stageProgress(T.dwell2, dt) >= 1)
        this.nextStage(s.carried >= 0 && !this.reduce ? 'load' : 'up')
      this.followGrip(dt)
    } else if (s.stage === 'load') {
      const p = this.stageProgress(T.load, dt)
      const bell = Math.sin(Math.PI * p)
      s.y = s.depthY + 6 * bell
      s.close = 1 + 0.12 * bell
      s.carrySq *= Math.exp(-8 * dt)
      this.followGrip(dt)
      if (p >= 1) {
        s.y = s.depthY
        this.nextStage('up')
      }
    } else if (s.stage === 'up') {
      const p = this.stageProgress(T.up, dt)
      s.y = s.depthY + (HOME_Y - s.depthY) * easeInOutCubic(p)
      s.carrySq *= Math.exp(-8 * dt)
      this.followGrip(dt)
      if (p >= 1) {
        s.carrySq = 0
        this.setPhase(s.carried >= 0 ? 'carry' : 'idle')
        this.feedback = s.carried >= 0 ? null : { kind: 'empty' }
      }
    }
  }

  private stepDrop(dt: number): void {
    const s = this.sim
    const targetIndex = this.pile.findIndex(
      ({ identity }) => this.mahjongTileBySlot[identity] === this.mahjong?.winningTile,
    )
    const submitted = this.remoteEnabled && s.carried >= 0
    const right = submitted || s.carried === targetIndex
    if (s.stage === 'open') {
      s.close = 1 - easeOutCubic(this.stageProgress(T.open, dt))
      if (s.st > 0.12 && !s.released) {
        s.released = true
        if (right) {
          this.trayMode = submitted ? 'checking' : 'open'
          if (this.reduce) {
            this.finishCorrectDrop()
            return
          }
          this.updateTrayGeometry()
          s.mouthY = this.tray.mouthY
          s.fallV = 30
        } else s.fallV = 40
        this.requestUpdate()
      }
    }
    if (right && s.released && s.carried >= 0) {
      s.fallV = Math.min(s.fallV + DROP_G * dt, 460)
      s.carry.y += s.fallV * dt
      s.carry.x += (this.tray.cx - s.carry.x) * (1 - Math.exp(-2.2 * dt))
      s.xrot += -s.xrot * (1 - Math.exp(-4 * dt))
      s.stretch = (Math.abs(s.fallV) / 460) * 0.09
      const width = this.pile[s.carried]!.w
      const sunk = s.carry.y + width / 2 - s.mouthY
      const carried = this.carriedElement
      if (sunk > 0 && carried) {
        carried.style.clipPath = `inset(0 0 ${sunk.toFixed(1)}px 0)`
        carried.style.filter = `brightness(${Math.max(0.4, 1 - (sunk / width) * 0.75).toFixed(3)})`
      }
      if (sunk >= width + 4) this.finishCorrectDrop()
    } else if (!right && s.released && s.carried >= 0 && s.fallV !== 0) {
      s.fallV = Math.min(s.fallV + DROP_G * dt, 360)
      s.carry.y += s.fallV * dt
      s.carry.x += (this.tray.cx - s.carry.x) * (1 - Math.exp(-4 * dt))
      s.xrot += -s.xrot * (1 - Math.exp(-3 * dt))
      s.stretch = (Math.abs(s.fallV) / 460) * 0.09
      if (s.fallV > 0 && s.carry.y >= this.tray.cy) {
        if (s.fallV > 200) {
          s.carry.y = this.tray.cy
          s.fallV *= -0.28
          s.xrot += this.random(-7, 7)
        } else {
          s.carry.y = this.tray.cy
          s.fallV = 0
          s.stretch = 0
          this.overTray = false
          this.trayMode = 'no'
          if (this.remoteEnabled) {
            this.finishCorrectDrop()
            return
          }
          const caughtTile = this.mahjongTileBySlot[this.pile[s.carried]!.identity]
          this.feedback = { kind: 'wrong', caughtTile }
          this.nextStage('beat')
          this.setPhase('deny')
        }
      }
    }
  }
  private finishCorrectDrop(): void {
    const carriedIndex = this.sim.carried
    const slotIdentity = carriedIndex >= 0 ? this.pile[carriedIndex]?.identity : undefined
    this.pendingCompletion = this.remoteEnabled
      ? {
          selectedCandidate:
            slotIdentity === undefined
              ? undefined
              : this.remoteMahjong?.candidateBySlot[slotIdentity]?.id,
        }
      : {
          selectedTile:
            slotIdentity === undefined ? undefined : this.mahjongTileBySlot[slotIdentity],
        }
    if (this.carriedElement) this.carriedElement.style.visibility = 'hidden'
    this.carriedMahjongTile = null
    this.carriedRemoteImage = null
    this.sim.carried = -1
    this.overTray = false
    this.trayMode = this.remoteEnabled ? 'checking' : 'win'
    this.nextStage('beat')
    this.setPhase('celebrate')
  }

  private stepDeny(dt: number): void {
    const s = this.sim
    if (s.stage !== 'beat') return
    const p = this.stageProgress(0.46, dt)
    s.swallow = easeOutCubic(p)
    s.carry.y -= 46 * dt
    if (p >= 1) {
      const index = s.carried
      this.trayMode = ''
      const pileElement = this.pileElements[index]
      if (pileElement) pileElement.style.visibility = ''
      if (this.carriedElement) {
        this.carriedElement.style.visibility = 'hidden'
        this.clearCarriedStyles()
      }
      this.carriedMahjongTile = null
      s.swallow = 0
      this.soft[index]!.vsq += 0.05
      this.soft[index]!.vrot += this.random(-1, 1)
      this.ripple(this.pile[index]!.x, 0.25, index)
      s.carried = -1
      this.setPhase('idle')
    }
  }

  private action = (): void => {
    if (!this.canOperate) return
    this.finishDrag()
    this.clearDirection()
    const s = this.sim
    if (this.phase === 'idle') {
      this.feedback = null
      s.close = 0
      this.nextStage('antic')
      this.setPhase('seq')
    } else {
      this.updateTrayGeometry()
      if (s.x < this.tray.min || s.x > this.tray.max) {
        this.feedback = { kind: 'move-to-tray' }
        this.requestUpdate()
        return
      }
      if (this.carriedElement) {
        this.carriedElement.style.visibility = 'visible'
        this.clearCarriedStyles()
      }
      this.nextStage('open')
      s.fallV = 0
      s.swallow = 0
      s.stretch = 0
      s.released = false
      this.overTray = false
      this.setPhase('toTray')
    }
  }

  private pickUp(index: number): void {
    const s = this.sim
    const center = this.pileItemCenter(index)
    s.carry = center
    s.xrot = this.pile[index]!.rot + this.soft[index]!.rot
    s.carrySq = this.soft[index]!.sq
    const source = this.pileElements[index]
    if (source) source.style.visibility = 'hidden'
    this.ripple(this.pile[index]!.x, 0.35, index)
    const carried = this.carriedElement
    if (carried) {
      if (carried instanceof HTMLImageElement && source instanceof HTMLImageElement) {
        carried.src = source.src
        if (this.remoteMahjong) {
          this.carriedRemoteImage = source.src
          carried.alt = ''
          delete carried.dataset.tile
          delete carried.dataset.suit
        } else {
          this.carriedMahjongTile = this.mahjongTileBySlot[this.pile[index]!.identity] ?? null
          carried.alt = source.alt
          carried.dataset.tile = source.dataset.tile
          carried.dataset.suit = source.dataset.suit
        }
      }
      carried.style.width = `${this.pile[index]!.w}px`
      carried.style.height = `${this.pile[index]!.w}px`
      carried.style.visibility = 'visible'
      this.clearCarriedStyles()
    }
  }

  private followGrip(dt: number): void {
    if (this.sim.carried < 0) return
    this.sim.xrot += -this.sim.xrot * (1 - Math.exp(-3.5 * dt))
    const end = this.pendulumEnd()
    this.sim.carry = { x: end.x, y: this.gripY(end.y) }
  }

  private pileItemCenter(index: number): { x: number; y: number } {
    return pileItemCenter(this.pile[index]!, this.soft[index]!)
  }

  private candidateAtClaw(): number {
    const currentX = (slot: Slot, index: number): number => slot.x + this.soft[index]!.dx
    return nearestCandidateAt(this.pile, this.sim.x, currentX)
  }

  private pendulumEnd(): { x: number; y: number } {
    const length = Math.max(2, this.sim.y - RAIL_Y)
    const radians = this.reduce ? 0 : ((this.sim.sway + this.sim.breeze) * Math.PI) / 180
    return { x: this.sim.x + Math.sin(radians) * length, y: RAIL_Y + Math.cos(radians) * length }
  }

  private get gripOffset(): number {
    return 32
  }

  private gripY(endY: number): number {
    return (
      endY + this.gripOffset + (this.sim.carried >= 0 ? this.pile[this.sim.carried]!.w : 80) / 2
    )
  }
  private stageProgress(duration: number, dt: number): number {
    this.sim.st += dt
    return clamp01(this.sim.st / duration)
  }
  private nextStage(stage: Stage): void {
    this.sim.stage = stage
    this.sim.st = 0
  }
  private setPhase(phase: Phase): void {
    this.phase = phase
    if (phase !== 'idle' && phase !== 'carry') {
      this.finishDrag()
      this.clearDirection()
    }
    this.requestUpdate()
  }
  private random(min: number, max: number): number {
    return min + Math.random() * (max - min)
  }

  private ripple(x: number, power: number, except = -1): void {
    if (this.reduce) return
    this.pile.forEach((slot, index) => {
      if (index === except || index === this.sim.carried) return
      const distance = Math.abs(slot.x - x)
      if (distance < 80) {
        const force = (1 - distance / 80) * power
        const side = slot.x < x ? -1 : 1
        const body = this.soft[index]!
        body.vdx += side * force * 1.6
        body.vdy -= force * 1.1
        body.vrot += side * force * 2
        body.vsq += force * 0.02
      }
    })
  }

  private renderFrame(): void {
    const s = this.sim
    const sway = this.reduce ? 0 : s.sway + s.breeze
    const length = Math.max(2, s.y - RAIL_Y)
    const trolley = this.renderRoot.querySelector<HTMLElement>('.cc-trolley')
    if (trolley) trolley.style.transform = `translateX(${(s.x - 14).toFixed(2)}px)`
    const slider = this.renderRoot.querySelector<HTMLElement>('.cc-joy')
    slider?.setAttribute(
      'aria-valuenow',
      String(Math.round(((s.x - CLAW_MIN) / (CLAW_MAX - CLAW_MIN)) * 100)),
    )
    const shadow = this.renderRoot.querySelector<HTMLElement>('.cc-claw-shadow')
    if (shadow) {
      const radians = (sway * Math.PI) / 180
      const endX = s.x + Math.sin(radians) * length
      const bottomY = s.carried >= 0 ? s.carry.y + this.pile[s.carried]!.w / 2 : s.y + 58
      const proximity = clamp01(1 - (GH - bottomY) / 210)
      shadow.style.transform = `translateX(${(endX - 45).toFixed(2)}px) scaleX(${(1.25 - 0.5 * proximity).toFixed(3)})`
      shadow.style.opacity = (0.1 + 0.3 * proximity).toFixed(3)
    }
    const rig = this.renderRoot.querySelector<SVGSVGElement>('.cc-rig')
    if (rig) {
      const height = length + 70
      rig.setAttribute('viewBox', `0 0 36 ${height.toFixed(1)}`)
      rig.setAttribute('height', height.toFixed(1))
      rig.style.transform = `translateX(${s.x.toFixed(2)}px) rotate(${sway.toFixed(2)}deg)`
      rig.style.transformOrigin = '0 0'
    }
    this.renderRoot
      .querySelector<SVGGElement>('.cc-coil')
      ?.setAttribute('transform', `translate(9 0) scale(1 ${(length / 100).toFixed(4)})`)
    this.renderRoot
      .querySelector<SVGGElement>('.cc-claw')
      ?.setAttribute(
        'transform',
        `translate(18 ${length.toFixed(2)}) scale(2.5) translate(-20.6 -8.9)`,
      )
    const pinch = 15 * s.close
    this.renderRoot
      .querySelector<SVGGElement>('.cc-claw-arm-l')
      ?.setAttribute('transform', `rotate(${pinch.toFixed(2)} ${CLAW_PIVOT.x} ${CLAW_PIVOT.y})`)
    this.renderRoot
      .querySelector<SVGGElement>('.cc-claw-arm-r')
      ?.setAttribute('transform', `rotate(${(-pinch).toFixed(2)} ${CLAW_PIVOT.x} ${CLAW_PIVOT.y})`)
    this.pileElements.forEach((element, index) => {
      const body = this.soft[index]!
      element.style.transform = `translate(${body.dx.toFixed(2)}px, ${(body.dy + body.ey).toFixed(2)}px) rotate(${(this.pile[index]!.rot + body.rot).toFixed(2)}deg) scale(${(1 - body.sq * 0.6).toFixed(3)}, ${(1 + body.sq).toFixed(3)})`
    })
    if (s.carried >= 0 && this.carriedElement) {
      const width = this.pile[s.carried]!.w
      const factor = 1 - s.swallow * 0.78
      this.carriedElement.style.transform = `translate(${(s.carry.x - width / 2).toFixed(2)}px, ${(s.carry.y - width / 2).toFixed(2)}px) rotate(${(sway + s.xrot).toFixed(2)}deg) scale(${(factor * (1 - s.carrySq * 0.6) * (1 - s.stretch * 0.55)).toFixed(3)}, ${(factor * (1 + s.carrySq) * (1 + s.stretch)).toFixed(3)})`
      if (s.swallow > 0) this.carriedElement.style.opacity = (1 - s.swallow).toFixed(2)
    }
  }

  private get pileElements(): HTMLElement[] {
    return [...this.renderRoot.querySelectorAll<HTMLElement>('.cc-prize')]
  }
  private get carriedElement(): HTMLElement | null {
    return this.renderRoot.querySelector<HTMLElement>('.cc-carried')
  }
  private clearCarriedStyles(): void {
    if (this.carriedElement) {
      this.carriedElement.style.opacity = ''
      this.carriedElement.style.clipPath = ''
      this.carriedElement.style.filter = ''
    }
  }

  private mahjongUrl(tile: MahjongTileId): string {
    const directory = assetDirectory(this.assetBase)
    return directory.href === DEFAULT_MAHJONG_BASE
      ? DEFAULT_MAHJONG_URLS[tile]
      : new URL(`${MAHJONG_TILE_META[tile].assetValue}.webp`, directory).href
  }
  private logoUrl(): string {
    const directory = assetDirectory(this.assetBase)
    return directory.href === DEFAULT_MAHJONG_BASE
      ? DEFAULT_LOGO_URL
      : new URL('../playcaptcha.svg', directory).href
  }
  private openInfo = (): void => {
    this.clearDirection()
    this.finishDrag()
    this.infoOpen = true
    if (this.runtimeActive) PlayCaptcha.addOpenInfo(this)
  }
  private closeInfo = (): void => {
    PlayCaptcha.removeOpenInfo(this)
    this.infoOpen = false
  }
  private stopInfoClick = (event: Event): void => {
    event.stopPropagation()
  }

  private beginLegacyDrag(capture: HTMLElement, clientX: number, id: number): void {
    if (this.drag || !this.canOperate) return
    this.drag = { id, startX: clientX, capture }
    const stick = this.renderRoot?.querySelector<HTMLElement>('.cc-joy-stick')
    if (stick) stick.style.transition = 'none'
  }

  private updateLegacyDrag(clientX: number, id: number): void {
    if (!this.drag || this.drag.id !== id) return
    if (!this.canOperate) {
      this.finishDrag()
      return
    }
    const delta = Math.max(
      -26,
      Math.min(26, logicalDelta(clientX - this.drag.startX, this.scale * GW)),
    )
    this.direction = delta / 26
    const stick = this.renderRoot?.querySelector<HTMLElement>('.cc-joy-stick')
    if (stick) stick.style.transform = `rotate(${(delta * 1.05).toFixed(1)}deg)`
  }

  private onLegacyMouseDown = (event: MouseEvent): void => {
    if (typeof PointerEvent !== 'undefined' || event.button !== 0) return
    this.beginLegacyDrag(event.currentTarget as HTMLElement, event.clientX, -1)
  }
  private onLegacyMouseMove = (event: MouseEvent): void => {
    this.updateLegacyDrag(event.clientX, -1)
  }
  private onLegacyMouseEnd = (): void => {
    if (this.drag?.id === -1) this.finishDrag()
  }
  private onLegacyTouchStart = (event: TouchEvent): void => {
    if (typeof PointerEvent !== 'undefined' || event.touches.length !== 1) return
    const touch = event.touches[0]
    this.beginLegacyDrag(event.currentTarget as HTMLElement, touch.clientX, touch.identifier)
  }
  private onLegacyTouchMove = (event: TouchEvent): void => {
    const touch = [...event.touches].find((candidate) => candidate.identifier === this.drag?.id)
    if (!touch) return
    event.preventDefault()
    this.updateLegacyDrag(touch.clientX, touch.identifier)
  }
  private onLegacyTouchEnd = (event: TouchEvent): void => {
    if (this.drag && ![...event.touches].some((touch) => touch.identifier === this.drag?.id)) {
      this.finishDrag()
    }
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!event.isPrimary || event.button !== 0 || this.drag || !this.canOperate) return
    const joy = event.currentTarget as HTMLElement
    joy.setPointerCapture?.(event.pointerId)
    this.drag = { id: event.pointerId, startX: event.clientX, capture: joy }
    const stick = this.renderRoot?.querySelector<HTMLElement>('.cc-joy-stick')
    if (stick) stick.style.transition = 'none'
  }
  private onPointerMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.id) return
    if (!this.canOperate) {
      this.finishDrag()
      return
    }
    const delta = Math.max(
      -26,
      Math.min(26, logicalDelta(event.clientX - this.drag.startX, this.scale * GW)),
    )
    this.direction = delta / 26
    const stick = this.renderRoot?.querySelector<HTMLElement>('.cc-joy-stick')
    if (stick) stick.style.transform = `rotate(${(delta * 1.05).toFixed(1)}deg)`
  }
  private onPointerEnd = (event: PointerEvent): void => {
    if (this.drag?.id === event.pointerId) this.finishDrag()
  }
  private finishDrag(): void {
    const drag = this.drag
    this.drag = null
    if (drag?.capture.hasPointerCapture?.(drag.id)) {
      try {
        drag.capture.releasePointerCapture(drag.id)
      } catch {
        // Capture can disappear between the guard and release (for example on detach).
      }
    }
    this.direction = 0
    const stick = this.renderRoot?.querySelector<HTMLElement>('.cc-joy-stick')
    if (stick) {
      stick.style.transition = this.reduce
        ? 'none'
        : 'transform 0.25s cubic-bezier(0.2, 1.6, 0.4, 1)'
      stick.style.transform = ''
    }
  }

  private updateDirectionFromKeys(): void {
    this.direction =
      Number(this.pressedKeys.has('ArrowRight')) - Number(this.pressedKeys.has('ArrowLeft'))
  }

  private clearDirection = (): void => {
    this.pressedKeys.clear()
    this.direction = 0
  }

  private get canOperate(): boolean {
    return (
      this.pileSettled &&
      !this.verified &&
      !this.verifying &&
      !this.loadingChallenge &&
      (!this.remoteEnabled || this.issuedChallenge !== null) &&
      !this.infoOpen &&
      (this.phase === 'idle' || this.phase === 'carry')
    )
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (!this.canOperate) return
    const path = event.composedPath()
    const button = path.find((node): node is HTMLButtonElement => node instanceof HTMLButtonElement)
    const fromDialog = path.some(
      (node) => node instanceof HTMLElement && node.getAttribute('role') === 'dialog',
    )
    if (
      fromDialog ||
      (button && !button.classList.contains('cc-action')) ||
      (button && (event.key === ' ' || event.key === 'Enter'))
    )
      return
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      this.pressedKeys.add(event.key)
      this.updateDirectionFromKeys()
    } else if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) {
      event.preventDefault()
      this.action()
    }
  }
  private onKeyUp = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      this.pressedKeys.delete(event.key)
      this.updateDirectionFromKeys()
    }
  }

  private renderInfoDialog() {
    if (!this.infoOpen) return nothing
    const messages = PLAY_CAPTCHA_MESSAGES[this.locale]
    return html`<div
      class="clawcap-info"
      id="clawcap-info-dialog"
      role="dialog"
      aria-label=${messages.aria.about}
      @click=${this.closeInfo}
    >
      <div class="clawcap-info-card" @click=${this.stopInfoClick}>
        <button
          type="button"
          class="clawcap-info-x"
          aria-label=${messages.aria.close}
          @click=${this.closeInfo}
        >
          <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
            <path
              d="M5 5l10 10M15 5 5 15"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
            ></path>
          </svg>
        </button>
        <div class="clawcap-info-head">
          <span class="clawcap-info-tile"
            ><img src=${this.logoUrl()} alt="" aria-hidden="true"
          /></span>
          <h4 class="clawcap-info-title">PlayCaptcha <span class="clawcap-info-ver">v1</span></h4>
          <p class="clawcap-info-tag">${messages.help.tagline}</p>
        </div>
        <ol class="clawcap-info-list">
          <li>
            <span class="clawcap-info-n">1</span
            ><span
              ><strong>${messages.help.moveTitle}</strong
              ><span class="clawcap-info-d">${messages.help.moveDescription}</span></span
            >
          </li>
          <li>
            <span class="clawcap-info-n">2</span
            ><span
              ><strong>${messages.help.grabTitle}</strong
              ><span class="clawcap-info-d">${messages.help.grabDescription}</span></span
            >
          </li>
          <li>
            <span class="clawcap-info-n">3</span
            ><span
              ><strong>${messages.help.dropTitle}</strong
              ><span class="clawcap-info-d">${messages.help.dropDescription}</span></span
            >
          </li>
        </ol>
        <button type="button" class="clawcap-info-done" @click=${this.closeInfo}>
          ${messages.help.done}
        </button>
      </div>
    </div>`
  }

  private renderMahjongTile(tile: MahjongTileId, className: string, style = '') {
    const meta = MAHJONG_TILE_META[tile]
    return html`<img
      class=${className}
      data-tile=${tile}
      data-suit=${meta.suit}
      src=${this.mahjongUrl(tile)}
      alt=${meta.label[this.locale]}
      draggable="false"
      style=${style}
    />`
  }

  private renderGlass() {
    const messages = PLAY_CAPTCHA_MESSAGES[this.locale]
    const countdown = this.challengeSecondsRemaining
    const countdownText =
      countdown === null
        ? null
        : `${Math.floor(countdown / 60)}:${String(countdown % 60).padStart(2, '0')}`
    return html`<div class=${`clawcap-glass${this.verified ? ' clawcap-glass--dim' : ''}`}>
      ${countdownText === null
        ? nothing
        : html`<span
            class=${`cc-countdown${countdown !== null && countdown <= 10 ? ' is-low' : ''}`}
            role="timer"
            aria-label=${messages.timeRemaining(countdown ?? 0)}
            >${countdownText}</span
          >`}
      <div class="cc-scene">
        <div class="cc-rail"></div>
        <div class="cc-trolley" aria-hidden="true"></div>
        <div class="cc-claw-shadow" aria-hidden="true"></div>
        ${this.pile.map((slot) => {
          const tile = this.mahjongTileBySlot[slot.identity]
          const remoteCandidate = this.remoteMahjong?.candidateBySlot[slot.identity]
          return html`<span
            class="cc-toy-wrap"
            style=${`left:${slot.x}px;top:${GH - slot.b}px;width:${slot.w}px;height:${slot.w}px;z-index:${slot.z}`}
            >${remoteCandidate
              ? html`<img
                  class="cc-prize cc-mahjong"
                  src=${remoteCandidate.image}
                  alt=""
                  draggable="false"
                  style=${`--cc-toy-width:${slot.w};--cc-mahjong-drop:${slot.dropFrom}px`}
                />`
              : tile
                ? html`<img
                    class="cc-prize cc-mahjong"
                    data-tile=${tile}
                    data-suit=${MAHJONG_TILE_META[tile].suit}
                    src=${this.mahjongUrl(tile)}
                    alt=${MAHJONG_TILE_META[tile].label[this.locale]}
                    draggable="false"
                    style=${`--cc-toy-width:${slot.w};--cc-mahjong-drop:${slot.dropFrom}px`}
                  />`
                : nothing}</span
          >`
        })}
        <div class="cc-pile-shadow"></div>
        <svg
          class="cc-rig"
          width="36"
          height=${COIL_LEN + 70}
          viewBox=${`0 0 36 ${COIL_LEN + 70}`}
          aria-hidden="true"
        >
          <g class="cc-coil" transform=${`translate(9 0) scale(1 ${COIL_LEN / 100})`}>
            <path
              d="M9 0 L9 5 C 15 7.5 15 9.5 9 12 C 3 14.5 3 16.5 9 19 C 15 21.5 15 23.5 9 26 C 3 28.5 3 30.5 9 33 C 15 35.5 15 37.5 9 40 C 3 42.5 3 44.5 9 47 C 15 49.5 15 51.5 9 54 C 3 56.5 3 58.5 9 61 C 15 63.5 15 65.5 9 68 C 3 70.5 3 72.5 9 75 C 15 77.5 15 79.5 9 82 C 3 84.5 3 86.5 9 89 C 15 91.5 15 93.5 9 95 L 9 100"
              fill="none"
              stroke="#9A9FA8"
              stroke-width="2.2"
              stroke-linecap="round"
              stroke-linejoin="round"
            ></path>
          </g>
          <g
            class="cc-claw"
            transform=${`translate(18 ${COIL_LEN}) scale(2.5) translate(-20.6 -8.9)`}
          >
            <g class="cc-claw-arm-l">
              ${CLAW_ARM_L.map((path) => svg`<path fill=${path.fill} d=${path.d}></path>`)}
            </g>
            <g class="cc-claw-arm-r">
              ${CLAW_ARM_R.map((path) => svg`<path fill=${path.fill} d=${path.d}></path>`)}
            </g>
            ${CLAW_BODY.map((path) => svg`<path fill=${path.fill} d=${path.d}></path>`)}
          </g>
        </svg>
      </div>
      <div class="cc-glass-shine"></div>
    </div>`
  }

  private renderCarryOverlay() {
    if (this.remoteMahjong) {
      return html`<div class="cc-carry-overlay">
        <img
          class="cc-carried cc-mahjong"
          src=${this.carriedRemoteImage ?? ''}
          alt=""
          draggable="false"
          style=${`visibility:${this.sim.carried >= 0 && this.phase !== 'idle' ? 'visible' : 'hidden'};width:${this.sim.carried >= 0 ? this.pile[this.sim.carried]!.w : 0}px;height:${this.sim.carried >= 0 ? this.pile[this.sim.carried]!.w : 0}px`}
        />
      </div>`
    }
    return html`<div class="cc-carry-overlay">
      ${this.renderMahjongTile(
        this.carriedMahjongTile ?? this.mahjong?.winningTile ?? 'wan-1',
        'cc-carried cc-mahjong',
        `visibility:${this.sim.carried >= 0 && this.phase !== 'idle' ? 'visible' : 'hidden'};width:${this.sim.carried >= 0 ? this.pile[this.sim.carried]!.w : 0}px;height:${this.sim.carried >= 0 ? this.pile[this.sim.carried]!.w : 0}px`,
      )}
    </div>`
  }

  private renderControls() {
    const messages = PLAY_CAPTCHA_MESSAGES[this.locale]
    const controlsDisabled = !this.canOperate
    const trayClass = `cc-tray${this.trayMode ? ` cc-tray--${this.trayMode}` : this.overTray ? ' cc-tray--hot' : ''}`
    const trayLabel =
      this.trayMode === 'win'
        ? messages.tray.success
        : this.trayMode === 'loading'
          ? messages.verification.loading
          : this.trayMode === 'checking'
            ? messages.verification.pending
            : this.trayMode === 'no'
              ? messages.trayWrong
              : this.trayMode === 'open'
                ? ''
                : this.overTray
                  ? messages.tray.release
                  : messages.tray.idle
    const trayIcon = this.trayMode === 'win' ? 'check' : this.trayMode === 'no' ? 'retry' : 'drop'
    return html`<div class="clawcap-panel">
      <div
        class="cc-joy"
        tabindex=${controlsDisabled ? '-1' : '0'}
        role="slider"
        aria-label=${messages.controls.moveClaw}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow=${Math.round(((this.sim.x - CLAW_MIN) / (CLAW_MAX - CLAW_MIN)) * 100)}
        aria-disabled=${controlsDisabled ? 'true' : 'false'}
        @mousedown=${this.onLegacyMouseDown}
        @touchstart=${this.onLegacyTouchStart}
        @pointerdown=${this.onPointerDown}
        @pointermove=${this.onPointerMove}
        @pointerup=${this.onPointerEnd}
        @pointercancel=${this.onPointerEnd}
        @lostpointercapture=${this.onPointerEnd}
      >
        <div class="cc-joy-base"></div>
        <div class="cc-joy-stick">
          <div class="cc-joy-shaft"></div>
          <div class="cc-joy-ball"></div>
        </div>
      </div>
      <div class=${trayClass}>
        <span class="cc-tray-hatch" aria-hidden="true"
          ><span class="cc-tray-mouth"></span><span class="cc-tray-door cc-tray-door--l"></span
          ><span class="cc-tray-door cc-tray-door--r"></span
          ><span class="cc-tray-skin"></span></span
        >${this.trayMode === 'win' && !this.reduce
          ? html`<span class="cc-confetti" aria-hidden="true"
              >${CONFETTI.map(
                (piece) =>
                  html`<i
                    style=${`background:${piece.c};animation-delay:${piece.d}s;--dx:${piece.dx}px;--dy:${piece.dy}px;--dr:${piece.dr}deg`}
                  ></i>`,
              )}</span
            >`
          : nothing}<span class="cc-tray-label"
          ><svg
            class="cc-tray-icon"
            data-icon=${trayIcon}
            viewBox="0 0 16 16"
            width="14"
            height="14"
            aria-hidden="true"
          >
            ${trayIcon === 'check'
              ? svg`<path
                  d="m3.2 8.2 3 3 6.5-6.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                ></path>`
              : trayIcon === 'retry'
                ? svg`<path
                    d="M4.1 5.5A5 5 0 1 1 3.4 9M4.1 5.5V2.6M4.1 5.5H7"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  ></path>`
                : svg`<path
                    d="M8 2.4v7.1m0 0L5.2 6.8M8 9.5l2.8-2.7M3 12.6h10"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  ></path>`}</svg
          ><span>${trayLabel}</span></span
        >
      </div>
      <button
        type="button"
        class=${`cc-action${this.phase === 'carry' && this.overTray ? ' cc-action--ready' : ''}`}
        aria-label=${this.phase === 'carry' ? messages.dropTile : messages.controls.grab}
        ?disabled=${controlsDisabled}
        @click=${this.action}
      >
        ${this.phase === 'carry' ? messages.controls.drop : messages.controls.grab}
      </button>
    </div>`
  }

  protected render() {
    const messages = PLAY_CAPTCHA_MESSAGES[this.locale]
    const targetTile = this.mahjong?.winningTile
    const verificationError =
      this.feedback?.kind === 'verification'
        ? messages.verification[this.feedback.error.kind]
        : null
    const verificationStatus = this.loadingChallenge
      ? messages.verification.loading
      : this.verifying
        ? messages.verification.pending
        : verificationError
    const feedback =
      verificationStatus ??
      (this.feedback?.kind === 'empty'
        ? messages.emptyGrab
        : this.feedback?.kind === 'move-to-tray'
          ? messages.moveToTray
          : this.feedback?.kind === 'wrong' && this.feedback.caughtTile && targetTile
            ? !this.remoteEnabled && this.showAnswer
              ? messages.wrongTile(
                  messages.tiles[this.feedback.caughtTile],
                  messages.tiles[targetTile],
                )
              : messages.wrongTileHidden(messages.tiles[this.feedback.caughtTile])
            : null)
    const stepNo =
      this.verified || ['carry', 'toTray', 'celebrate', 'done'].includes(this.phase)
        ? 3
        : this.phase === 'seq'
          ? 2
          : 1
    return html`<div
      class=${`clawcap clawcap--mahjong${this.compact ? ' clawcap--compact' : ''}`}
      lang=${this.locale}
      role="group"
      aria-label=${messages.verificationLabel}
      tabindex="0"
      @keydown=${this.onKeyDown}
      @keyup=${this.onKeyUp}
      @focusout=${this.clearDirection}
    >
      <header class="clawcap-top">
        <span
          class=${`clawcap-shield${this.verified ? ' clawcap-shield--ok' : ''}`}
          aria-hidden="true"
          ><svg viewBox="0 0 20 20" width="14" height="14">
            <path
              d="M10 2.2 4 4.6v4.6c0 4 2.6 6.7 6 8.2 3.4-1.5 6-4.2 6-8.2V4.6Z"
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linejoin="round"
            ></path>
            ${this.verified
              ? svg`<path
                  d="m7 9.8 2.2 2.2L13.4 7.6"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.7"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                ></path>`
              : nothing}
          </svg></span
        ><span class="clawcap-top-actions"
          ><button
            type="button"
            class="clawcap-refresh"
            aria-label=${messages.aria.refresh}
            @click=${this.refreshChallenge}
          >
            <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
              <path
                d="M15.2 6.2A6 6 0 1 0 16 11M15.2 3.5v2.7h-2.7"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
              ></path>
            </svg></button
          ><button
            type="button"
            class="clawcap-help"
            aria-label=${messages.aria.about}
            aria-haspopup="dialog"
            aria-expanded=${this.infoOpen ? 'true' : 'false'}
            aria-controls=${this.infoOpen ? 'clawcap-info-dialog' : nothing}
            @click=${this.openInfo}
          >
            ?
          </button></span
        >
      </header>
      ${this.renderInfoDialog()}
      <h3 class="clawcap-title">
        <span
          >${this.verified
            ? messages.verifiedTitle
            : (this.titleOverride ?? messages.defaultTitle)}</span
        >
      </h3>
      <p class="clawcap-sub" aria-live="polite">
        <span
          >${this.verified
            ? messages.verifiedMessage
            : (feedback ??
              (targetTile && !this.remoteEnabled && this.showAnswer
                ? html`${messages.challengePrefix}
                    <em>${this.renderMahjongTile(targetTile, 'clawcap-sub-mahjong')}</em>`
                : messages.judgePrompt))}</span
        >
      </p>
      ${this.remoteMahjong
        ? html`<div
            class="clawcap-mahjong-hand clawcap-mahjong-hand--remote"
            role="img"
            aria-label=${messages.handLabel}
          >
            <img class="clawcap-hand-image" src=${this.remoteMahjong.handImage} alt="" />
          </div>`
        : this.mahjong
          ? html`<div class="clawcap-mahjong-hand" role="group" aria-label=${messages.handLabel}>
              ${sortMahjongTiles(this.mahjong.hand).map((tile, index, sorted) =>
                this.renderMahjongTile(
                  tile,
                  `clawcap-hand-tile${index > 0 && MAHJONG_TILE_META[sorted[index - 1]!].suit !== MAHJONG_TILE_META[tile].suit ? ' is-suit-start' : ''}`,
                ),
              )}
            </div>`
          : nothing}
      <ol
        class="clawcap-steps"
        data-step=${stepNo}
        style=${`--step-index:${stepNo - 1}`}
        aria-hidden="true"
      >
        ${messages.steps.map(
          (label, index) =>
            html`<li class=${stepNo === index + 1 ? 'is-active' : ''}>
              <span class="clawcap-step-n">${index + 1}</span> ${label}
            </li>`,
        )}
      </ol>
      ${keyed(
        this.issuedChallenge?.challengeId ?? this.mahjong,
        html`<div class="clawcap-machine" ?inert=${this.infoOpen}>
          <div class="clawcap-case">${this.renderGlass()}${this.renderControls()}</div>
          ${this.renderCarryOverlay()}
        </div>`,
      )}
      <p class="clawcap-hint">${messages.hint}</p>
    </div>`
  }
}
