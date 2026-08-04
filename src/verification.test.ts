import { describe, expect, test } from 'vitest'

import {
  DEFAULT_VERIFICATION_TIMEOUT,
  normalizeVerificationEndpoint,
  normalizeVerificationTimeout,
  parseIssuedChallenge,
  parseVerificationContext,
  parseVerificationResponse,
  type PlayCaptchaVerifyChallengeRequest,
} from './verification.ts'

const candidates = Array.from({ length: 12 }, (_, index) => ({
  id: `candidate-${index}`,
  image: `/api/captcha/assets/image-${index}`,
}))

describe('verification configuration normalization', () => {
  test.each([
    ['/api/verify', 'https://shop.example/checkout', 'https://shop.example/api/verify'],
    [
      'https://captcha.example/verify?flow=checkout',
      'https://shop.example/',
      'https://captcha.example/verify?flow=checkout',
    ],
  ])('normalizes endpoint %s', (value, base, expected) => {
    expect(normalizeVerificationEndpoint(value, base)).toBe(expected)
  })

  test.each(['', 'data:text/plain,no', 'file:///tmp/verify', 'https://['])(
    'rejects endpoint %s',
    (value) => expect(normalizeVerificationEndpoint(value, 'https://shop.example/')).toBeNull(),
  )

  test.each([
    [1000, 1000],
    ['2500', 2500],
    [60_000, 60_000],
    [999, DEFAULT_VERIFICATION_TIMEOUT],
    [60_001, DEFAULT_VERIFICATION_TIMEOUT],
    ['nope', DEFAULT_VERIFICATION_TIMEOUT],
  ])('normalizes timeout %s', (value, expected) => {
    expect(normalizeVerificationTimeout(value)).toBe(expected)
  })

  test('parses JSON context without constraining its shape', () => {
    expect(parseVerificationContext(null)).toEqual({ valid: true, context: null })
    expect(parseVerificationContext('{"checkoutId":"order-42"}')).toEqual({
      valid: true,
      context: { checkoutId: 'order-42' },
    })
    expect(parseVerificationContext('{')).toEqual({ valid: false, context: null })
  })
})

describe('server-issued challenge parsing', () => {
  test('accepts an opaque v3 mahjong challenge', () => {
    const challenge = {
      version: 3,
      challengeId: 'mahjong-1',
      mode: 'mahjong',
      challenge: { handImage: '/api/captcha/assets/hand', candidates },
    }
    expect(parseIssuedChallenge(challenge)).toEqual(challenge)
  })

  test.each([
    null,
    { version: 2, challengeId: 'x', mode: 'mahjong', challenge: {} },
    { version: 3, challengeId: '', mode: 'mahjong', challenge: {} },
    {
      version: 3,
      challengeId: 'x',
      mode: 'toys',
      challenge: { handImage: '/hand', candidates },
    },
    {
      version: 3,
      challengeId: 'x',
      mode: 'mahjong',
      challenge: { handImage: '/hand', candidates: candidates.slice(0, 11) },
    },
    {
      version: 3,
      challengeId: 'x',
      mode: 'mahjong',
      challenge: { handImage: '/hand', candidates: candidates.map(() => candidates[0]) },
    },
  ])('rejects malformed or semantic challenge %#', (value) => {
    expect(parseIssuedChallenge(value)).toBeNull()
  })

  test('verify request carries only opaque candidate identity', () => {
    const request: PlayCaptchaVerifyChallengeRequest = {
      version: 3,
      action: 'verify',
      challengeId: 'opaque-id',
      completion: { selected: 'candidate-7' },
      context: { scene: 'login' },
    }
    expect(request).not.toHaveProperty('challenge')
    expect(JSON.stringify(request)).not.toMatch(/wan-|bamboo-|circle-|east|south|west|north/)
  })
})

describe('verification response parsing', () => {
  test('accepts minimal and optional opaque fields', () => {
    expect(parseVerificationResponse({ verified: true })).toEqual({ verified: true })
    expect(
      parseVerificationResponse({
        verified: true,
        token: 'opaque-token',
        expiresAt: '2026-07-28T12:00:00Z',
      }),
    ).toEqual({
      verified: true,
      token: 'opaque-token',
      expiresAt: '2026-07-28T12:00:00Z',
    })
    expect(parseVerificationResponse({ verified: false, message: 'Challenge expired' })).toEqual({
      verified: false,
      message: 'Challenge expired',
    })
  })

  test.each([
    null,
    [],
    {},
    { verified: 'yes' },
    { verified: true, token: 42 },
    { verified: false, message: { text: 'no' } },
  ])('rejects malformed response %#', (value) => {
    expect(parseVerificationResponse(value)).toBeNull()
  })
})
