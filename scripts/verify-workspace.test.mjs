import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))

function readPackage(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function assertStableIds(source, extraIds = []) {
  for (const id of ['width-toggle', 'result', 'captcha-shell', ...extraIds]) {
    assert.match(source, new RegExp(`(?:id=|['"])${id}(?:['"]|\\})`))
  }
}

function extractJsxButton(source, id) {
  const button = source.match(
    new RegExp(`<button\\b(?=[^>]*\\bid=["']${id}["'])[^>]*>[\\s\\S]*?<\\/button>`),
  )?.[0]
  assert.ok(button, `Expected to find the ${id} button`)
  return button
}

function extractVanillaWidthButton(source) {
  const button = source.match(
    /const widthToggle = document\.createElement\(['"]button['"]\)[\s\S]*?widthToggle\.addEventListener\(['"]click['"],\s*\(\) => \{[\s\S]*?\n\}\)/,
  )?.[0]
  assert.ok(button, 'Expected to find the vanilla width button control')
  return button
}

function assertReactStrictMode(source) {
  assert.match(
    source,
    /import\s*\{[^}]*\bStrictMode\b[^}]*\}\s*from\s*['"]react['"]/,
    'React entry must import StrictMode from react',
  )
  assert.match(
    source,
    /createRoot\(root\)\.render\(\s*<StrictMode>\s*<App\s*\/>\s*<\/StrictMode>,?\s*\)/,
    'React root render must wrap App in StrictMode',
  )
}

void test('rejects a React root render without StrictMode', () => {
  assert.throws(() => assertReactStrictMode('createRoot(root).render(<App />)'), /StrictMode/)
})

void test('keeps the publishable playcaptcha package at the workspace root', () => {
  assert.equal(packageJson.name, 'playcaptcha')
  assert.notEqual(packageJson.private, true)
  assert.equal(packageJson.packageManager, 'pnpm@10.33.0')
})

void test('registers only playground packages and centralizes tool overrides', () => {
  const workspace = readFileSync('pnpm-workspace.yaml', 'utf8')

  assert.equal(packageJson.overrides, undefined)
  assert.match(workspace, /^packages:\n  - 'playgrounds\/\*'\n/m)
  assert.match(
    workspace,
    /^overrides:\n  vite: 'npm:@voidzero-dev\/vite-plus-core@0\.2\.6'\n  vitest: '4\.1\.10'\n?$/m,
  )
})

void test('uses pnpm as the only repository lockfile', () => {
  assert.equal(existsSync('pnpm-lock.yaml'), true)
  assert.equal(existsSync('package-lock.json'), false)
})

void test('documents repository development with pnpm commands', () => {
  const readme = readFileSync('README.md', 'utf8')
  const development = readme.match(/## 本地开发\n([\s\S]*?)(?=\n## )/)?.[1]

  assert.ok(development)
  assert.match(development, /```bash\npnpm install\n/)
  assert.match(development, /pnpm run (?:dev|check|build|test:consumer)/)
  const commands = [...development.matchAll(/```bash\n([\s\S]*?)```/g)]
    .map((match) => match[1])
    .join('\n')
  assert.doesNotMatch(commands, /^npm (?:install|run)\b/m)
  assert.match(development, /`npm pack` 和 `npm install` 模拟 npm 消费者/)
})

void test('defines the vanilla playground workspace contract', () => {
  const vanillaPackage = JSON.parse(readFileSync('playgrounds/vanilla/package.json', 'utf8'))
  const vanillaSource = readFileSync('playgrounds/vanilla/src/main.ts', 'utf8')

  assert.equal(vanillaPackage.name, '@playcaptcha/playground-vanilla')
  assert.equal(vanillaPackage.private, true)
  assert.equal(vanillaPackage.dependencies.playcaptcha, 'workspace:*')
  assert.match(vanillaPackage.scripts.dev, /--port 4183\b/)
  assert.match(vanillaPackage.scripts.dev, /--strictPort\b/)

  assert.match(vanillaSource, /from ['"]playcaptcha['"]/)
  assert.match(vanillaSource, /import ['"]playcaptcha['"]/)
  assert.match(vanillaSource, /addEventListener\(['"]verify['"]/)
  const verifyListener = vanillaSource.match(
    /captcha\.addEventListener\(['"]verify['"],\s*\(event\)\s*=>\s*\{([\s\S]*?)\n\}\)/,
  )?.[1]
  assert.ok(verifyListener)
  assert.match(verifyListener, /detail\.source/)
  assert.match(
    verifyListener,
    /resultMessage\.textContent\s*=\s*`verify · source=\$\{detail\.source\}`/,
  )
  assert.match(vanillaSource, /result\.dataset\.state\s*=\s*['"]success['"]/)
  assert.doesNotMatch(vanillaSource, /TOY_IDS|TOY_META|ToyId|target-select|\.target\b/)
  for (const id of ['width-toggle', 'result', 'captcha-shell']) {
    assert.match(vanillaSource, new RegExp(`['"]${id}['"]`))
  }
  assert.doesNotMatch(extractVanillaWidthButton(vanillaSource), /aria-pressed/)

  assert.equal(
    packageJson.scripts['playground:vanilla'],
    'pnpm build && vp run @playcaptcha/playground-vanilla#dev',
  )
})

void test('defines the React direct-consumer playground contract', () => {
  const reactPackage = readPackage('playgrounds/react/package.json')
  const reactSource = readFileSync('playgrounds/react/src/main.tsx', 'utf8')
  const reactConfig = readFileSync('playgrounds/react/vite.config.ts', 'utf8')
  const reactJsx = readFileSync('playgrounds/react/src/playcaptcha-jsx.d.ts', 'utf8')

  assert.equal(reactPackage.name, '@playcaptcha/playground-react')
  assert.equal(reactPackage.private, true)
  assert.equal(reactPackage.dependencies.playcaptcha, 'workspace:*')
  assert.match(reactPackage.scripts.dev, /--port 4184\b/)
  assert.match(reactPackage.scripts.dev, /--strictPort\b/)
  assert.match(reactConfig, /plugins:\s*\[react\(\)\]/)
  assert.doesNotMatch(reactConfig, /\bany\b|@ts-ignore|\bas\s+(?:unknown|UserConfig)/)

  assert.match(reactSource, /from ['"]playcaptcha['"]/)
  assert.match(reactSource, /import ['"]playcaptcha['"]/)
  assert.equal(reactSource.match(/<play-captcha\b/g)?.length, 1)
  assert.doesNotMatch(reactSource, /TOY_IDS|TOY_META|ToyId|target-select|\btarget\b/)
  assertStableIds(reactSource)
  assert.doesNotMatch(extractJsxButton(reactSource, 'width-toggle'), /aria-pressed/)
  assertReactStrictMode(reactSource)

  const verifyEffect = reactSource.match(/useEffect\(\(\) => \{([\s\S]*?)\n  \}, \[\]\)/)
  assert.ok(verifyEffect, 'React verify listener must have an empty-dependency cleanup effect')
  assert.match(verifyEffect[1], /const onVerify\s*=\s*\(event:\s*Event\)\s*=>/)
  assert.match(verifyEffect[1], /detail\.source/)
  assert.match(verifyEffect[1], /captcha\.addEventListener\(['"]verify['"],\s*onVerify\)/)
  assert.match(verifyEffect[1], /captcha\.removeEventListener\(['"]verify['"],\s*onVerify\)/)
  assert.match(verifyEffect[1], /captcha\.addEventListener\(['"]click['"],\s*onClick\)/)
  assert.match(verifyEffect[1], /captcha\.removeEventListener\(['"]click['"],\s*onClick\)/)
  assert.match(reactJsx, /ref\??:\s*React\.Ref<PlayCaptcha>/)
  assert.match(reactJsx, /['"]show-answer['"]\??:\s*boolean/)
  assert.match(reactJsx, /title\??:\s*string/)
  assert.match(reactJsx, /['"]asset-base['"]\??:\s*string/)
  assert.doesNotMatch(reactJsx, /target|mode|ToyId|PlayCaptchaMode|\bany\b|@ts-ignore/)
})

void test('defines the Vue direct-consumer playground contract', () => {
  const vuePackage = readPackage('playgrounds/vue/package.json')
  const vueSource = readFileSync('playgrounds/vue/src/App.vue', 'utf8')
  const vueEntry = readFileSync('playgrounds/vue/src/main.ts', 'utf8')
  const vueConfig = readFileSync('playgrounds/vue/vite.config.ts', 'utf8')

  assert.equal(vuePackage.name, '@playcaptcha/playground-vue')
  assert.equal(vuePackage.private, true)
  assert.equal(vuePackage.dependencies.playcaptcha, 'workspace:*')
  assert.match(vuePackage.scripts.dev, /--port 4185\b/)
  assert.match(vuePackage.scripts.dev, /--strictPort\b/)
  assert.match(vueConfig, /isCustomElement:\s*\(tag\)\s*=>\s*tag\s*===\s*['"]play-captcha['"]/)
  assert.doesNotMatch(vueConfig, /\bany\b|@ts-ignore|\bas\s+(?:unknown|UserConfig)/)

  assert.match(vueSource, /from ['"]playcaptcha['"]/)
  assert.match(vueEntry, /import ['"]playcaptcha['"]/)
  assert.match(vueEntry, /shared\/demo\.css['"]/)
  assert.equal(vueSource.match(/<play-captcha\b/g)?.length, 1)
  assert.doesNotMatch(vueSource, /TOY_IDS|TOY_META|ToyId|target-select|\btarget\b/)
  assertStableIds(vueSource, ['mount-toggle'])
  assert.match(vueSource, /v-if=['"]mounted['"]/)
  assert.doesNotMatch(extractJsxButton(vueSource, 'width-toggle'), /aria-pressed/)
  assert.doesNotMatch(extractJsxButton(vueSource, 'mount-toggle'), /aria-pressed/)

  const verifyHandler = vueSource.match(/function onVerify\([^)]*\)\s*\{([\s\S]*?)\n\}/)?.[1]
  assert.ok(verifyHandler)
  assert.match(verifyHandler, /detail\.source/)
  const captchaWatch = vueSource.match(
    /watch\(captcha,\s*\(current, previous\)\s*=>\s*\{([\s\S]*?)\n\}\)/,
  )?.[1]
  assert.ok(captchaWatch, 'Vue must watch the template ref lifecycle')
  assert.match(captchaWatch, /previous\?\.removeEventListener\(['"]verify['"],\s*onVerify\)/)
  assert.match(captchaWatch, /current\?\.addEventListener\(['"]verify['"],\s*onVerify\)/)
  assert.match(
    vueSource,
    /onBeforeUnmount\(\(\)\s*=>\s*\{[\s\S]*?removeEventListener\(['"]click['"],\s*onClick\)[\s\S]*?removeEventListener\(['"]verify['"],\s*onVerify\)[\s\S]*?\}\)/,
  )
})

void test('defines the server-issued challenge playground contract', () => {
  const serverPackage = readPackage('playgrounds/server/package.json')
  const serverSource = readFileSync('playgrounds/server/server.mjs', 'utf8')
  const browserSource = readFileSync('playgrounds/server/src/main.ts', 'utf8')

  assert.equal(serverPackage.name, '@playcaptcha/playground-server')
  assert.equal(serverPackage.private, true)
  assert.equal(serverPackage.dependencies.playcaptcha, 'workspace:*')
  assert.match(serverPackage.scripts.dev, /--port 4186\b/)
  assert.match(serverPackage.scripts.dev, /--host 0\.0\.0\.0\b/)
  assert.match(browserSource, /from ['"]playcaptcha['"]/)
  assert.match(browserSource, /import ['"]playcaptcha['"]/)
  assert.match(browserSource, /verifyEndpoint\s*=\s*['"]\/api\/captcha['"]/)
  assert.match(browserSource, /addEventListener\(['"]verify['"]/)
  assert.match(browserSource, /addEventListener\(['"]verification-error['"]/)
  for (const id of ['new-challenge', 'protocol-log', 'result', 'captcha-shell']) {
    assert.match(browserSource, new RegExp(`(?:id=|['"])${id}(?:['"]|\\})`))
  }
  assert.doesNotMatch(browserSource, /mode-select|value=['"]toys['"]/)

  assert.equal(serverPackage.dependencies.pngjs, undefined)
  assert.equal(serverPackage.dependencies.sharp, '^0.35.3')
  assert.match(serverSource, /variantsPerTile\s*=\s*8/)
  assert.match(serverSource, /contentType\s*=\s*['"]image\/webp['"]/)
  assert.match(serverSource, /majiang_ui['"`], `\$\{value\}\.webp`/)
  assert.match(serverSource, /payload\?\.version\s*!==\s*3/)
  assert.match(serverSource, /payload\.mode\s*!==\s*['"]mahjong['"]/)
  assert.match(serverSource, /randomUUID\(\)/)
  assert.match(serverSource, /HttpOnly; SameSite=Lax/)
  assert.match(serverSource, /challengeTtl\s*=\s*5\s*\*\s*60_000/)
  assert.match(serverSource, /challenges\.delete\(payload\.challengeId\)/)
  assert.match(serverSource, /handImage/)
  assert.match(serverSource, /answerCandidateId/)
  assert.doesNotMatch(serverSource, /PNG\.sync\.|from ['"]pngjs['"]/)
  assert.match(serverSource, /\.webp\(\{ lossless: true/)
  assert.match(serverSource, /Cache-Control['"]:\s*['"]private, no-store['"]/)
  assert.doesNotMatch(serverSource, /TOY_IDS|mode:\s*['"]toys['"]|target, candidates/)
  assert.equal(
    packageJson.scripts['playground:server'],
    'pnpm build && vp run @playcaptcha/playground-server#dev',
  )
})

void test('defines exact root playground commands', () => {
  assert.deepEqual(
    {
      vanilla: packageJson.scripts['playground:vanilla'],
      react: packageJson.scripts['playground:react'],
      vue: packageJson.scripts['playground:vue'],
      server: packageJson.scripts['playground:server'],
      check: packageJson.scripts['playgrounds:check'],
      build: packageJson.scripts['playgrounds:build'],
    },
    {
      vanilla: 'pnpm build && vp run @playcaptcha/playground-vanilla#dev',
      react: 'pnpm build && vp run @playcaptcha/playground-react#dev',
      vue: 'pnpm build && vp run @playcaptcha/playground-vue#dev',
      server: 'pnpm build && vp run @playcaptcha/playground-server#dev',
      check: "pnpm build && vp run --filter '@playcaptcha/playground-*' --fail-if-no-match check",
      build: "pnpm build && vp run --filter '@playcaptcha/playground-*' --fail-if-no-match build",
    },
  )
})
