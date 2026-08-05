import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { expect, test, vi } from 'vitest'

test('marks the auto-registering package entry as side-effectful', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as Record<string, unknown>

  expect(packageJson).not.toHaveProperty('sideEffects')
})

test('publishes bundled defaults and exposes source assets for optional self-hosting', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    files?: string[]
    exports?: Record<string, unknown>
  }

  expect(packageJson.files).toContain('dist')
  expect(packageJson.files).toContain('assets')
  expect(packageJson.files).not.toContain('scripts/verify-package-consumer.mjs')
  expect(packageJson.files).not.toContain('scripts/verify-release-artifacts.mjs')
  const [packed] = JSON.parse(
    execFileSync('npm', ['pack', '--ignore-scripts', '--dry-run', '--json'], {
      encoding: 'utf8',
    }),
  ) as [{ files: Array<{ path: string }> }]
  expect(packed.files.some(({ path }) => path === 'scripts' || path.startsWith('scripts/'))).toBe(
    false,
  )
  expect(packageJson.exports?.['./assets/*']).toBe('./assets/*')
})

test('builds fresh artifacts before release checks', () => {
  const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts?: Record<string, string>
  }

  expect(packageJson.scripts?.['build:consumer']).toBe('node scripts/verify-package-consumer.mjs')
  expect(packageJson.scripts?.test).toBe(
    'vp test --run && node --test scripts/verify-umd-build.test.mjs && pnpm run test:workspace-contract',
  )
  expect(packageJson.scripts?.['test:umd']).toBe(
    'node --test scripts/verify-umd-build.test.mjs && node scripts/verify-umd-build.mjs',
  )
  expect(packageJson.scripts?.['test:playgrounds-contract']).toBe(
    'node --test scripts/verify-playgrounds.test.mjs',
  )
  expect(packageJson.scripts?.['test:playgrounds']).toBe(
    'pnpm run playgrounds:check && node scripts/verify-playgrounds.mjs',
  )
  expect(packageJson.scripts?.prepublishOnly).toBe('pnpm build && pnpm check && pnpm test')
})

test('documents the exact Mahjong-only playground and release contract', () => {
  const readme = readFileSync('README.md', 'utf8')

  expect(readme).toContain('根页面：本地纯前端麻将')
  expect(readme).toContain('Vanilla')
  expect(readme).toContain('React')
  expect(readme).toContain('Vue')
  expect(readme).toContain('Server：远端 v3')
  expect(readme).toContain('consumer contract')
  expect(readme).toContain('playground contract')
})

test('documents the classic script contract and legacy browser boundary', () => {
  const readme = readFileSync('README.md', 'utf8')

  expect(readme).toContain(
    '<script src="https://cdn.example/playcaptcha/dist/playcaptcha.umd.js"></script>',
  )
  expect(readme).toContain('`dist/playcaptcha.umd.js` 到包根 `assets/`')
  expect(readme).toContain('Chrome 80')
  expect(readme).toContain('Safari 13')
  expect(readme).toContain('不支持 IE11')
  expect(readme).toContain('不暴露受支持的全局 API')
})

test('registers <play-captcha> safely across repeated imports', async () => {
  await import('./index.ts')
  vi.resetModules()
  await import('./index.ts')

  expect(globalThis.customElements?.get('play-captcha')).toBeDefined()
})
