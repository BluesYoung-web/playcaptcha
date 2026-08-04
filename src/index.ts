import { PlayCaptcha } from './PlayCaptcha.ts'

export { PlayCaptcha }
export {
  DEFAULT_PLAY_CAPTCHA_LOCALE,
  PLAY_CAPTCHA_LOCALES,
  normalizeLocale,
  type PlayCaptchaLocale,
} from './i18n.ts'
export {
  MAHJONG_TILE_IDS,
  MAHJONG_TILE_META,
  createMahjongChallenge,
  isMahjongTileId,
  isStandardMahjongWin,
  sortMahjongTiles,
  winningTilesForHand,
  type MahjongChallenge,
  type MahjongTileId,
  type MahjongWaitType,
} from './mahjong.ts'
export {
  DEFAULT_VERIFICATION_TIMEOUT,
  parseIssuedChallenge,
  normalizeVerificationEndpoint,
  normalizeVerificationTimeout,
  parseVerificationContext,
  parseVerificationResponse,
  type PlayCaptchaCreateChallengeRequest,
  type PlayCaptchaIssuedChallenge,
  type PlayCaptchaOpaqueCandidate,
  type PlayCaptchaVerifyChallengeRequest,
  type PlayCaptchaVerificationContext,
  type PlayCaptchaVerificationErrorDetail,
  type PlayCaptchaVerificationErrorKind,
  type PlayCaptchaVerificationRequest,
  type PlayCaptchaVerificationResponse,
  type PlayCaptchaVerificationTransport,
  type PlayCaptchaVerificationTransportInput,
  type PlayCaptchaVerifyEventDetail,
} from './verification.ts'

const registry = globalThis.customElements
if (registry && !registry.get('play-captcha')) {
  registry.define('play-captcha', PlayCaptcha)
}

declare global {
  interface HTMLElementTagNameMap {
    'play-captcha': PlayCaptcha
  }
}
