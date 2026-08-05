import type React from 'react'
import type { PlayCaptcha, PlayCaptchaLocale } from '@bluesyoung/playcaptcha'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'play-captcha': React.DetailedHTMLProps<React.HTMLAttributes<PlayCaptcha>, PlayCaptcha> & {
        ref?: React.Ref<PlayCaptcha>
        'show-answer'?: boolean
        locale?: PlayCaptchaLocale
        title?: string
        'asset-base'?: string
        'verify-endpoint'?: string
        'verify-timeout'?: number | string
        'verification-data'?: string
      }
    }
  }
}
