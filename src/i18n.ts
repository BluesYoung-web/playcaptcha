import type { MahjongTileId } from './mahjong.ts'

export const PLAY_CAPTCHA_LOCALES = ['zh-CN', 'en'] as const
export type PlayCaptchaLocale = (typeof PLAY_CAPTCHA_LOCALES)[number]

export const DEFAULT_PLAY_CAPTCHA_LOCALE: PlayCaptchaLocale = 'zh-CN'

export function normalizeLocale(value: unknown): PlayCaptchaLocale {
  if (typeof value !== 'string') return DEFAULT_PLAY_CAPTCHA_LOCALE
  const language = value.trim().replace(/_/g, '-').toLowerCase()
  if (language === 'zh' || language.startsWith('zh-')) return 'zh-CN'
  if (language === 'en' || language.startsWith('en-')) return 'en'
  return DEFAULT_PLAY_CAPTCHA_LOCALE
}

interface PlayCaptchaMessages {
  defaultTitle: string
  verifiedTitle: string
  verifiedMessage: string
  challengePrefix: string
  handLabel: string
  wrongTile: (caught: string, target: string) => string
  emptyGrab: string
  moveToTray: string
  trayWrong: string
  dropTile: string
  judgePrompt: string
  wrongTileHidden: (caught: string) => string
  verificationLabel: string
  verification: {
    loading: string
    pending: string
    rejected: string
    http: string
    network: string
    timeout: string
    response: string
    config: string
  }
  tray: { success: string; release: string; idle: string }
  controls: { moveClaw: string; grab: string; drop: string }
  steps: readonly [string, string, string]
  hint: string
  aria: { about: string; refresh: string; close: string }
  help: {
    tagline: string
    moveTitle: string
    moveDescription: string
    grabTitle: string
    grabDescription: string
    dropTitle: string
    dropDescription: string
    done: string
  }
  tiles: Record<MahjongTileId, string>
}

const zhTiles: Record<MahjongTileId, string> = {
  'wan-1': '一万',
  'wan-2': '二万',
  'wan-3': '三万',
  'wan-4': '四万',
  'wan-5': '五万',
  'wan-6': '六万',
  'wan-7': '七万',
  'wan-8': '八万',
  'wan-9': '九万',
  'bamboo-1': '一条',
  'bamboo-2': '二条',
  'bamboo-3': '三条',
  'bamboo-4': '四条',
  'bamboo-5': '五条',
  'bamboo-6': '六条',
  'bamboo-7': '七条',
  'bamboo-8': '八条',
  'bamboo-9': '九条',
  'circle-1': '一筒',
  'circle-2': '二筒',
  'circle-3': '三筒',
  'circle-4': '四筒',
  'circle-5': '五筒',
  'circle-6': '六筒',
  'circle-7': '七筒',
  'circle-8': '八筒',
  'circle-9': '九筒',
  east: '东风',
  south: '南风',
  west: '西风',
  north: '北风',
  red: '红中',
  green: '发财',
  white: '白板',
}

const enTiles: Record<MahjongTileId, string> = {
  'wan-1': '1 Characters',
  'wan-2': '2 Characters',
  'wan-3': '3 Characters',
  'wan-4': '4 Characters',
  'wan-5': '5 Characters',
  'wan-6': '6 Characters',
  'wan-7': '7 Characters',
  'wan-8': '8 Characters',
  'wan-9': '9 Characters',
  'bamboo-1': '1 Bamboo',
  'bamboo-2': '2 Bamboo',
  'bamboo-3': '3 Bamboo',
  'bamboo-4': '4 Bamboo',
  'bamboo-5': '5 Bamboo',
  'bamboo-6': '6 Bamboo',
  'bamboo-7': '7 Bamboo',
  'bamboo-8': '8 Bamboo',
  'bamboo-9': '9 Bamboo',
  'circle-1': '1 Circle',
  'circle-2': '2 Circles',
  'circle-3': '3 Circles',
  'circle-4': '4 Circles',
  'circle-5': '5 Circles',
  'circle-6': '6 Circles',
  'circle-7': '7 Circles',
  'circle-8': '8 Circles',
  'circle-9': '9 Circles',
  east: 'East Wind',
  south: 'South Wind',
  west: 'West Wind',
  north: 'North Wind',
  red: 'Red Dragon',
  green: 'Green Dragon',
  white: 'White Dragon',
}

export const PLAY_CAPTCHA_MESSAGES: Record<PlayCaptchaLocale, PlayCaptchaMessages> = {
  'zh-CN': {
    defaultTitle: '判断胡哪张牌',
    verifiedTitle: '验证通过',
    verifiedMessage: '已确认你是真人，抓得漂亮！',
    challengePrefix: '这手牌听',
    handLabel: '待胡手牌',
    wrongTile: (caught, target) => `夹到的是${caught}，这手牌胡${target}。`,
    emptyGrab: '没有夹到麻将，请重试。',
    moveToTray: '请先把麻将移到投放口上方。',
    trayWrong: '这张不能胡',
    dropTile: '投放麻将',
    judgePrompt: '请观察手牌，判断胡哪张牌',
    wrongTileHidden: (caught) => `夹到的是${caught}，这张不能胡。`,
    verificationLabel: '麻将胡牌真人验证',
    verification: {
      loading: '正在从服务器加载挑战…',
      pending: '正在向服务器验证…',
      rejected: '服务器未通过验证，请重试。',
      http: '验证服务暂时不可用，请重试。',
      network: '无法连接验证服务，请检查网络后重试。',
      timeout: '服务器验证超时，请重试。',
      response: '验证服务返回了无效结果，请重试。',
      config: '验证接口配置无效，请联系网站管理员。',
    },
    tray: { success: '抓得漂亮！', release: '松开！', idle: '投放到这里' },
    controls: { moveClaw: '移动夹爪', grab: '抓取', drop: '投放' },
    steps: ['移动', '抓取', '投放'],
    hint: '使用摇杆或 ← → 移动 · 按空格键抓取和投放',
    aria: { about: '关于 PlayCaptcha', refresh: '重新生成挑战', close: '关闭' },
    help: {
      tagline: '判断这手牌胡哪张，再夹起正确麻将。',
      moveTitle: '移动',
      moveDescription: '先观察精简显示的待胡手牌，再用摇杆或 ← → 键对准能胡的麻将。',
      grabTitle: '抓取',
      grabDescription: '按红色按钮或空格键，夹起你判断的麻将。',
      dropTitle: '投放',
      dropDescription: '把麻将移到投放口后松开；选错的牌会回到牌堆。',
      done: '知道了',
    },
    tiles: zhTiles,
  },
  en: {
    defaultTitle: 'Find the winning tile',
    verifiedTitle: 'Verified',
    verifiedMessage: 'You’re human. Nice catch.',
    challengePrefix: 'This hand waits for',
    handLabel: 'Seven-tile equivalent ready hand',
    wrongTile: (caught, target) => `${caught} does not win. This hand waits for ${target}.`,
    emptyGrab: 'Came up without a tile. Try again.',
    moveToTray: 'Move the tile over the drop zone first.',
    trayWrong: 'That tile does not win',
    dropTile: 'Drop the mahjong tile',
    judgePrompt: 'Study the hand and choose the winning tile',
    wrongTileHidden: (caught) => `${caught} does not complete this hand.`,
    verificationLabel: 'Mahjong winning-tile verification',
    verification: {
      loading: 'Loading challenge from the server…',
      pending: 'Checking with the server…',
      rejected: 'The server did not accept the challenge. Try again.',
      http: 'The verification service is unavailable. Try again.',
      network: 'Could not reach the verification service. Check your connection and try again.',
      timeout: 'Server verification timed out. Try again.',
      response: 'The verification service returned an invalid result. Try again.',
      config: 'The verification endpoint is misconfigured. Contact the site administrator.',
    },
    tray: { success: 'Nice catch!', release: 'Release!', idle: 'Drop here' },
    controls: { moveClaw: 'Move the claw', grab: 'Grab', drop: 'Drop' },
    steps: ['Move', 'Grab', 'Drop'],
    hint: 'Joystick or ← → to move · Space to grab & drop',
    aria: { about: 'About PlayCaptcha', refresh: 'Generate a new challenge', close: 'Close' },
    help: {
      tagline: 'Read the ready hand, then catch the tile that completes it.',
      moveTitle: 'Move',
      moveDescription: 'Study the compact ready hand, then line the claw up over a winning tile.',
      grabTitle: 'Grab',
      grabDescription: 'Use the red button or Space to catch your chosen mahjong tile.',
      dropTitle: 'Drop',
      dropDescription: 'Move it to the hatch and release. A non-winning tile returns to the pile.',
      done: 'Got it',
    },
    tiles: enTiles,
  },
}
