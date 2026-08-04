// @vitest-environment node

import { expect, test } from 'vitest'

test('evaluates the package entry without DOM globals', async () => {
  Reflect.deleteProperty(globalThis, 'customElements')
  expect(globalThis).not.toHaveProperty('customElements')
  await expect(import('./index.ts')).resolves.toMatchObject({ PlayCaptcha: expect.any(Function) })
})
