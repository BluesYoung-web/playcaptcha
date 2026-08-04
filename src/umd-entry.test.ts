import { expect, test, vi } from 'vitest'

test('the UMD side-effect entry registers play-captcha idempotently', async () => {
  const define = vi.spyOn(customElements, 'define')

  await import('./umd.ts')
  vi.resetModules()
  await import('./umd.ts')

  expect(customElements.get('play-captcha')).toBeDefined()
  expect(define.mock.calls.filter(([name]) => name === 'play-captcha')).toHaveLength(1)
})
