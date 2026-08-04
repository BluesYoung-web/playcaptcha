export const DEFAULT_VERIFICATION_TIMEOUT = 10_000
export type PlayCaptchaVerificationContext = unknown

export interface PlayCaptchaCreateChallengeRequest {
  version: 3
  action: 'create'
  mode: 'mahjong'
  context: PlayCaptchaVerificationContext
}

export interface PlayCaptchaVerifyChallengeRequest {
  version: 3
  action: 'verify'
  challengeId: string
  completion: { selected: string }
  context: PlayCaptchaVerificationContext
}

export type PlayCaptchaVerificationRequest =
  | PlayCaptchaCreateChallengeRequest
  | PlayCaptchaVerifyChallengeRequest

export interface PlayCaptchaOpaqueCandidate {
  id: string
  image: string
}

export interface PlayCaptchaIssuedChallenge {
  version: 3
  challengeId: string
  mode: 'mahjong'
  challenge: {
    handImage: string
    candidates: readonly PlayCaptchaOpaqueCandidate[]
  }
  expiresAt?: string
}

export interface PlayCaptchaVerificationTransportInput {
  request: PlayCaptchaVerificationRequest
  signal: AbortSignal
}

export type PlayCaptchaVerificationTransport = (
  input: PlayCaptchaVerificationTransportInput,
) => Promise<unknown>

export interface PlayCaptchaVerificationResponse {
  verified: boolean
  token?: string
  expiresAt?: string
  message?: string
}

export interface PlayCaptchaVerifyEventDetail {
  mode: 'mahjong'
  source: 'local' | 'remote'
  token?: string
  expiresAt?: string
}

export type PlayCaptchaVerificationErrorKind =
  | 'config'
  | 'rejected'
  | 'http'
  | 'network'
  | 'timeout'
  | 'response'

export interface PlayCaptchaVerificationErrorDetail {
  kind: PlayCaptchaVerificationErrorKind
  message: string
  status?: number
}

export function normalizeVerificationEndpoint(value: unknown, baseUrl: string): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    const endpoint = new URL(value.trim(), baseUrl)
    if (!['http:', 'https:'].includes(endpoint.protocol)) return null
    return endpoint.href
  } catch {
    return null
  }
}

export function normalizeVerificationTimeout(value: unknown): number {
  const timeout = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(timeout) && timeout >= 1000 && timeout <= 60_000
    ? Math.round(timeout)
    : DEFAULT_VERIFICATION_TIMEOUT
}

export function parseVerificationContext(value: string | null): {
  valid: boolean
  context: PlayCaptchaVerificationContext
} {
  if (value === null || value.trim() === '') return { valid: true, context: null }
  try {
    return { valid: true, context: JSON.parse(value) as unknown }
  } catch {
    return { valid: false, context: null }
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

export function parseIssuedChallenge(value: unknown): PlayCaptchaIssuedChallenge | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const response = value as Record<string, unknown>
  if (
    response.version !== 3 ||
    !isNonEmptyString(response.challengeId) ||
    response.mode !== 'mahjong' ||
    (response.expiresAt !== undefined && typeof response.expiresAt !== 'string') ||
    !response.challenge ||
    typeof response.challenge !== 'object' ||
    Array.isArray(response.challenge)
  ) {
    return null
  }
  const challenge = response.challenge as Record<string, unknown>
  if (!isNonEmptyString(challenge.handImage) || !Array.isArray(challenge.candidates)) return null
  const candidates = challenge.candidates
  if (
    candidates.length !== 12 ||
    !candidates.every(
      (candidate) =>
        candidate !== null &&
        typeof candidate === 'object' &&
        !Array.isArray(candidate) &&
        isNonEmptyString((candidate as Record<string, unknown>).id) &&
        isNonEmptyString((candidate as Record<string, unknown>).image),
    )
  ) {
    return null
  }
  const normalized = candidates as PlayCaptchaOpaqueCandidate[]
  if (
    new Set(normalized.map(({ id }) => id)).size !== 12 ||
    new Set(normalized.map(({ image }) => image)).size !== 12
  ) {
    return null
  }
  return {
    version: 3,
    challengeId: response.challengeId,
    mode: 'mahjong',
    challenge: { handImage: challenge.handImage, candidates: normalized },
    ...(response.expiresAt === undefined ? {} : { expiresAt: response.expiresAt as string }),
  }
}

export function parseVerificationResponse(value: unknown): PlayCaptchaVerificationResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const response = value as Record<string, unknown>
  if (typeof response.verified !== 'boolean') return null
  if (response.token !== undefined && typeof response.token !== 'string') return null
  if (response.expiresAt !== undefined && typeof response.expiresAt !== 'string') return null
  if (response.message !== undefined && typeof response.message !== 'string') return null
  return {
    verified: response.verified,
    ...(response.token === undefined ? {} : { token: response.token }),
    ...(response.expiresAt === undefined ? {} : { expiresAt: response.expiresAt }),
    ...(response.message === undefined ? {} : { message: response.message }),
  }
}
