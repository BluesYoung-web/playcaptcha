import assert from 'node:assert/strict'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, win32 } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

import { auditFixtureSourceText, safeFixturePath, verifyOutputText } from './verify-playgrounds.mjs'
import {
  EXPECTED_RESOURCES,
  assertPortableReport,
  verifyComponentRegistration,
  verifyResourceFiles,
} from './verify-release-artifacts.mjs'

const project = new URL('..', import.meta.url)
const verifierSource = readFileSync(new URL('verify-playgrounds.mjs', import.meta.url), 'utf8')

function isolatedEnvironment() {
  const root = mkdtempSync(join(tmpdir(), 'playcaptcha-playgrounds-test-'))
  return {
    root,
    env: { TMPDIR: root, TMP: root, TEMP: root },
  }
}

function ownedRoots(parent) {
  return readdirSync(parent).filter((entry) => entry.startsWith('playcaptcha-playgrounds-'))
}

function sourceFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)
    return entry.isDirectory() ? sourceFiles(child) : [child]
  })
}

function assertSafeCleanupContract(source) {
  assert.doesNotMatch(
    source,
    /readdirSync\(tmpdir\(\)\)[\s\S]*?startsWith\(['"]playcaptcha-playgrounds-['"]\)/u,
  )
}

function runVerifier(options = {}) {
  return spawnSync(
    process.execPath,
    ['scripts/verify-playgrounds.mjs', '--skip-build', ...(options.args ?? [])],
    {
      cwd: project,
      encoding: 'utf8',
      env: { ...process.env, ...options.env },
      timeout: 180_000,
    },
  )
}

function describeFailure(result) {
  return [
    `status: ${result.status}`,
    `signal: ${result.signal}`,
    `error: ${result.error?.stack ?? result.error ?? '(none)'}`,
    `stdout:\n${result.stdout || '(empty)'}`,
    `stderr:\n${result.stderr || '(empty)'}`,
  ].join('\n')
}

function syntheticDist(t, files) {
  const root = mkdtempSync(join(tmpdir(), 'playcaptcha-output-audit-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const [relativePath, source] of Object.entries(files)) {
    const path = join(root, relativePath)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, source)
  }
  return root
}

void test('scans every emitted text type and rejects a generic home path', async (t) => {
  for (const [file, source] of [
    ['index.html', '<script src="/home/other/private-entry.js"></script>'],
    ['assets/app.js', 'const source = "/home/other/private-entry.ts"'],
    ['assets/app.css', '/* /home/other/private-entry.css */'],
    ['assets/app.js.map', '{"version":3,"sources":["/home/other/private-entry.ts"],"mappings":""}'],
    ['metadata.json', '{"source":"/home/other/private-entry.ts"}'],
  ]) {
    await t.test(file, (t) => {
      const dist = syntheticDist(t, {
        'clean.html': '<play-captcha></play-captcha>',
        'assets/clean.js': 'customElements.define("play-captcha", class {})',
        [file]: source,
      })
      assert.throws(
        () => verifyOutputText('vanilla', dist),
        new RegExp(`vanilla output contains home absolute path: ${file.replace('.', '\\.')}`, 'i'),
      )
    })
  }
})

void test('rejects unresolved playcaptcha imports without rejecting stable bundle strings', (t) => {
  const leaked = syntheticDist(t, {
    'index.html': '<main></main>',
    'assets/app.js': 'import { PlayCaptcha } from "playcaptcha"',
  })
  assert.throws(
    () => verifyOutputText('react', leaked),
    /react output contains bare playcaptcha import: assets\/app\.js/i,
  )

  const clean = syntheticDist(t, {
    'index.html': '<play-captcha></play-captcha>',
    'assets/app.js':
      'const packageName="playcaptcha";customElements.define("play-captcha",class{})',
    'assets/app.css': 'play-captcha { display: block }',
    'assets/app.js.map': '{"version":3,"sources":["src/main.ts"],"mappings":""}',
    'metadata.json': '{"component":"play-captcha"}',
    'assets/image.png': '/home/other/binary-source.png',
  })
  assert.doesNotThrow(() => verifyOutputText('react', clean))
})

void test('requires side-effect and public API imports independently', () => {
  assert.throws(
    () => auditFixtureSourceText('vanilla', "import 'playcaptcha'\nconst tag = 'play-captcha'"),
    /does not import a playcaptcha public API/i,
  )
  assert.throws(
    () =>
      auditFixtureSourceText(
        'vanilla',
        "import { PlayCaptcha } from 'playcaptcha'\nconst tag = 'play-captcha'",
      ),
    /does not side-effect import playcaptcha/i,
  )
  assert.throws(
    () =>
      auditFixtureSourceText(
        'vanilla',
        "// import 'playcaptcha'\nconst fake = \"import { PlayCaptcha } from 'playcaptcha'\"\nconst tag = 'play-captcha'",
      ),
    /does not import a playcaptcha public API/i,
  )

  assert.doesNotThrow(() =>
    auditFixtureSourceText(
      'vue',
      "import 'playcaptcha'\nimport { PlayCaptcha } from 'playcaptcha'",
    ),
  )
})

void test('safe fixture paths use path semantics on POSIX and Windows', () => {
  assert.equal(safeFixturePath('/owned/root', '/owned/root/vue'), '/owned/root/vue')
  assert.throws(() => safeFixturePath('/owned/root', '/owned/rooted/vue'), /outside fixture root/i)
  assert.equal(
    safeFixturePath(String.raw`C:\owned\root`, String.raw`C:\owned\root\vue`, win32),
    String.raw`C:\owned\root\vue`,
  )
  assert.throws(
    () => safeFixturePath(String.raw`C:\owned\root`, String.raw`D:\escape\vue`, win32),
    /outside fixture root/i,
  )
})

void test('rejects low-cost synthetic output leaks independently', async (t) => {
  for (const [source, expected] of [
    ['const dependency = "workspace:*"', /workspace dependency/i],
    [
      `const source = ${JSON.stringify(project.pathname)} + "src/index.ts"`,
      /project absolute path/i,
    ],
    ['const source = "playgrounds/react/src/main.tsx"', /playground source path/i],
    ["import('playcaptcha')", /bare playcaptcha import/i],
  ]) {
    await t.test(expected.source, (t) => {
      const dist = syntheticDist(t, {
        'index.html': '<play-captcha></play-captcha>',
        'assets/app.js': source,
      })
      assert.throws(() => verifyOutputText('vanilla', dist), expected)
    })
  }
})

void test('rejects fixture, tarball, macOS, and Windows absolute-path leaks', async (t) => {
  const fixture = '/isolated/playcaptcha-playgrounds-owned/vanilla'
  const tarball = '/isolated/playcaptcha-playgrounds-owned/playcaptcha-0.1.0.tgz'
  for (const [source, expected] of [
    [`const source = ${JSON.stringify(`${fixture}/src/main.ts`)}`, /fixture absolute path/i],
    [`const archive = ${JSON.stringify(`file:${tarball}`)}`, /tarball absolute path/i],
    ['const source = "/private/var/folders/build/main.ts"', /macos temporary path/i],
    ['const source = "/Users/example/project/main.ts"', /macos user path/i],
    ['const source = "/opt/ci/private/main.ts"', /unix absolute path/i],
    ['const source = "/root/build/main.ts"', /unix absolute path/i],
    ['const source = "/workspace/project/src/main.ts"', /unix absolute path/i],
    ['const source = "/build/project/dist/main.js"', /unix absolute path/i],
    ['const source = "/var/tmp/build/main.ts"', /unix absolute path/i],
    ['const source = "/Volumes/workspace/src/main.ts"', /unix absolute path/i],
    [String.raw`const source = "C:\\build\\fixture\\main.ts"`, /windows absolute path/i],
    [String.raw`const source = "\\\\server\\share\\build\\main.ts"`, /windows absolute path/i],
    [
      'const source = "file:/workspace/project/src/main.ts"',
      /workspace absolute path|unix absolute path/i,
    ],
  ]) {
    await t.test(expected.source, (t) => {
      const dist = syntheticDist(t, { 'assets/app.js': source })
      assert.throws(() => verifyOutputText('vanilla', dist, { fixture, tarball }), expected)
    })
  }

  const legalUrls = syntheticDist(t, {
    'index.html': '<img src="https://example.com/avatar.png">',
    'assets/app.css': '.avatar { background: url("/assets/avatar.png") }',
    'assets/app.js': 'const route = "/home/profile"',
  })
  assert.doesNotThrow(() => verifyOutputText('vanilla', legalUrls))
})

void test('rejects extensionless common-root, file URL, drive, and UNC leaks', async (t) => {
  for (const [source, expected] of [
    ['const cache = "/opt/ci/cache"', /unix absolute path/i],
    ['const cache = "file:/srv/private/cache"', /file absolute path/i],
    [String.raw`const cache = "C:\\ci\\cache"`, /windows absolute path/i],
    [String.raw`const cache = "\\\\server\\share\\cache"`, /windows absolute path/i],
  ]) {
    await t.test(expected.source, (t) => {
      const dist = syntheticDist(t, { 'assets/app.js': source })
      assert.throws(() => verifyOutputText('vanilla', dist), expected)
    })
  }
})

void test('rejects arbitrary POSIX filesystem roots without rejecting web routes', async (t) => {
  for (const source of [
    'const source = "/usr/local/build/main.ts"',
    'const cache = "/srv/ci/cache"',
    'const output = "/mnt/agent/file.js"',
    'const state = "/var/lib/build/state.json"',
  ]) {
    await t.test(source, (t) => {
      const dist = syntheticDist(t, { 'assets/app.js': source })
      assert.throws(() => verifyOutputText('vanilla', dist), /POSIX absolute path/i)
    })
  }
  const routes = syntheticDist(t, {
    'assets/app.js':
      'const profile = "/home/profile"; const api = "/v1/users"; const history = "/checkout/orders/history"',
  })
  assert.doesNotThrow(() => verifyOutputText('vanilla', routes))
})

void test('requires all 35 runtime resources exactly once and referenced by final output', (t) => {
  const files = Object.fromEntries(
    EXPECTED_RESOURCES.map(({ stem, extension, directory }) => [
      `assets/${directory ? `${directory}/` : ''}${stem}-hash.${extension}`,
      'binary',
    ]),
  )
  files['assets/app.js'] = EXPECTED_RESOURCES.map(
    ({ stem, extension, directory }) =>
      `new URL("/assets/${directory ? `${directory}/` : ''}${stem}-hash.${extension}", import.meta.url)`,
  ).join('\n')
  const complete = syntheticDist(t, files)
  assert.equal(verifyResourceFiles('vanilla', complete).resourceFiles.length, 35)

  const extra = syntheticDist(t, { ...files, 'assets/extra-hash.png': 'binary' })
  assert.throws(() => verifyResourceFiles('vanilla', extra), /emitted 36 media files/i)

  const commentsOnly = syntheticDist(t, {
    ...files,
    'assets/app.js': EXPECTED_RESOURCES.map(
      ({ stem, extension }) => `// /assets/${stem}-hash.${extension}`,
    ).join('\n'),
  })
  assert.throws(() => verifyResourceFiles('vanilla', commentsOnly), /does not reference resource/i)

  const sourceMapOnly = syntheticDist(t, {
    ...files,
    'assets/app.js': 'const value = 1\n//# sourceMappingURL=app.js.map',
    'assets/app.js.map': JSON.stringify({
      version: 3,
      sources: EXPECTED_RESOURCES.map(
        ({ stem, extension }) => `../assets/${stem}-hash.${extension}`,
      ),
      mappings: '',
    }),
  })
  assert.throws(() => verifyResourceFiles('vanilla', sourceMapOnly), /does not reference resource/i)

  const markupCommentsOnly = syntheticDist(t, {
    ...files,
    'index.html': EXPECTED_RESOURCES.map(
      ({ stem, extension }) => `<!-- <img src="/assets/${stem}-hash.${extension}"> -->`,
    ).join('\n'),
    'assets/app.js': 'const value = 1',
  })
  assert.throws(
    () => verifyResourceFiles('vanilla', markupCommentsOnly),
    /does not reference resource/i,
  )

  const cssCommentsOnly = syntheticDist(t, {
    ...files,
    'assets/app.css': EXPECTED_RESOURCES.map(
      ({ stem, extension }) => `/* url("./${stem}-hash.${extension}") */`,
    ).join('\n'),
    'assets/app.js': 'const value = 1',
  })
  assert.throws(
    () => verifyResourceFiles('vanilla', cssCommentsOnly),
    /does not reference resource/i,
  )

  const nestedFiles = Object.fromEntries(
    EXPECTED_RESOURCES.map(({ stem, extension }) => [
      `media/deep/${stem}-hash.${extension}`,
      'binary',
    ]),
  )
  nestedFiles['assets/js/app.js'] = EXPECTED_RESOURCES.map(
    ({ stem, extension }) =>
      `new URL("../../media\\\\deep\\\\${stem}-hash.${extension}", import.meta.url)`,
  ).join('\n')
  const nested = syntheticDist(t, nestedFiles)
  assert.equal(verifyResourceFiles('vanilla', nested).resourceFiles.length, 35)

  const brokenReference = syntheticDist(t, {
    ...files,
    'assets/app.js': `${files['assets/app.js']}\nconst missing = "/assets/ghost-hash.png"`,
  })
  assert.throws(
    () => verifyResourceFiles('vanilla', brokenReference),
    /references missing output file: assets\/ghost-hash\.png/i,
  )

  const missingFiles = { ...files }
  delete missingFiles['assets/playcaptcha-hash.svg']
  missingFiles['assets/app.js'] = missingFiles['assets/app.js'].replace(
    'new URL("/assets/playcaptcha-hash.svg", import.meta.url)\n',
    '',
  )
  const missing = syntheticDist(t, missingFiles)
  assert.throws(
    () => verifyResourceFiles('vanilla', missing),
    /missing output file: assets\/playcaptcha-hash\.svg/i,
  )
})

void test('rejects media URLs that traverse outside dist', (t) => {
  const files = Object.fromEntries(
    EXPECTED_RESOURCES.map(({ stem, extension }) => [`assets/${stem}-hash.${extension}`, 'binary']),
  )
  files['assets/app.css'] = EXPECTED_RESOURCES.map(
    ({ stem, extension }) => `url("./${stem}-hash.${extension}")`,
  ).join('\n')
  files['assets/app.js'] = 'const invalid = "../../outside.png"'

  const dist = syntheticDist(t, files)
  assert.throws(() => verifyResourceFiles('vanilla', dist), /resolves outside dist/i)
})

void test('does not treat media strings resolved against an external URL as dist references', (t) => {
  const files = Object.fromEntries(
    EXPECTED_RESOURCES.map(({ stem, extension }) => [`assets/${stem}-hash.${extension}`, 'binary']),
  )
  files['assets/app.js'] = EXPECTED_RESOURCES.map(
    ({ stem, extension }) => `new URL("/assets/${stem}-hash.${extension}", "https://cdn.example/")`,
  ).join('\n')

  const dist = syntheticDist(t, files)
  assert.throws(() => verifyResourceFiles('vanilla', dist), /does not reference resource/i)
})

void test('executes the final bundle and rejects tag strings without registration', async (t) => {
  const dist = syntheticDist(t, {
    'index.html': '<div id="app"></div><script type="module" src="/assets/app.js"></script>',
    'assets/app.js': 'document.querySelector("#app").innerHTML = "<play-captcha></play-captcha>"',
  })
  await assert.rejects(
    verifyComponentRegistration('vanilla', dist),
    /did not register play-captcha/i,
  )
})

void test('rejects a bundle that registers but never renders the page component', async (t) => {
  const dist = syntheticDist(t, {
    'index.html': '<div id="app"></div><script type="module" src="/assets/app.js"></script>',
    'assets/app.js':
      'customElements.define("play-captcha", class extends HTMLElement { connectedCallback(){ this.attachShadow({mode:"open"}).innerHTML="<div class=clawcap></div>" } }); const tag="play-captcha"',
  })
  await assert.rejects(
    verifyComponentRegistration('vanilla', dist),
    /did not render exactly one play-captcha/i,
  )
})

void test('rejects a module entry outside dist and accepts query/hash URLs', async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'playcaptcha-entry-containment-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const dist = join(parent, 'dist')
  mkdirSync(dist)
  const registeringBundle =
    'customElements.define("play-captcha", class extends HTMLElement { connectedCallback(){ this.attachShadow({mode:"open"}).innerHTML="<div class=clawcap></div>" } }); document.querySelector("#app").innerHTML="<play-captcha></play-captcha>"'
  writeFileSync(join(parent, 'outside.js'), registeringBundle)
  writeFileSync(
    join(dist, 'index.html'),
    '<div id="app"></div><script type="module" src="../outside.js"></script>',
  )
  assert.throws(() => verifyComponentRegistration('vanilla', dist), /outside dist/i)

  writeFileSync(join(dist, 'app.js'), registeringBundle)
  writeFileSync(
    join(dist, 'index.html'),
    '<div id="app"></div><script type="module" src="./app.js?v=1#entry"></script>',
  )
  await assert.doesNotReject(verifyComponentRegistration('vanilla', dist))
})

void test('rejects protocol-relative module entries', (t) => {
  const dist = syntheticDist(t, {
    'index.html': '<div id="app"></div><script type="module" src="//cdn.example/app.js"></script>',
  })
  assert.throws(() => verifyComponentRegistration('vanilla', dist), /not a local file URL/i)
})

void test('marks verification successful only after writing the report', () => {
  const reportWrite = verifierSource.indexOf('console.log(JSON.stringify(report, null, 2))')
  const successAssignment = verifierSource.indexOf('succeeded = true', reportWrite)

  assert.notEqual(reportWrite, -1)
  assert.ok(successAssignment > reportWrite)
})

void test('playground reports permit absolute paths only at exact kept fixture fields', () => {
  assert.throws(
    () => assertPortableReport({ outputs: { vue: { source: 'C:\\build\\src\\main.ts' } } }),
    /outputs\.vue\.source/i,
  )
  assert.throws(
    () =>
      assertPortableReport(
        { outputs: { vanilla: '/tmp/not-a-kept-fixture' } },
        new Set(['fixtures.vanilla']),
      ),
    /outputs\.vanilla/i,
  )
  assert.doesNotThrow(() =>
    assertPortableReport(
      { fixtures: { vanilla: '/tmp/playcaptcha-playgrounds-owned/vanilla' } },
      new Set(['fixtures.vanilla']),
    ),
  )
})

void test('portable reports reject arbitrary POSIX absolute paths', () => {
  for (const path of ['/srv/ci/output', '/mnt/agent/work', '/var/lib/build', '/srv/cache']) {
    assert.throws(() => assertPortableReport({ output: path }), /output/i)
  }
  assert.throws(() => assertPortableReport({ route: '/home/profile' }), /route/i)
})

void test('never derives cleanup targets from a global temporary-root snapshot', () => {
  const dangerousVerifierSource = String.raw`
    function temporaryRoots() {
      return readdirSync(tmpdir()).filter((entry) =>
        entry.startsWith('playcaptcha-playgrounds-'))
    }
    const rootsBeforeVerification = new Set(temporaryRoots())
    for (const root of temporaryRoots().filter((entry) => !rootsBeforeVerification.has(entry))) {
      rmSync(join(tmpdir(), root), { recursive: true, force: true })
    }
  `

  assert.throws(() => assertSafeCleanupContract(dangerousVerifierSource), assert.AssertionError)
  assertSafeCleanupContract(
    "const temporary = mkdtempSync(join(tmpdir(), 'playcaptcha-playgrounds-'))",
  )
  assertSafeCleanupContract(verifierSource)
})

void test('verifies all packed playgrounds and cleans the default fixture root', () => {
  const sandbox = isolatedEnvironment()
  try {
    const result = runVerifier({ env: sandbox.env })
    assert.equal(result.status, 0, describeFailure(result))
    const report = JSON.parse(result.stdout)
    const version = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ).version
    assert.deepEqual(report.frameworks, ['vanilla', 'react', 'vue', 'server'])
    assert.equal(JSON.stringify(report).includes(sandbox.root), false)
    assert.deepEqual(Object.keys(report).sort(), ['frameworks', 'outputs'])
    for (const framework of report.frameworks) {
      const output = report.outputs[framework]
      assert.deepEqual(Object.keys(output).sort(), [
        'auditedTextFiles',
        'componentRegistration',
        'componentRendered',
        'html',
        'installedVersion',
        'javascript',
        'packageSource',
        'portable',
        'resources',
      ])
      assert.deepEqual(
        { ...output, auditedTextFiles: true },
        {
          html: true,
          javascript: true,
          componentRegistration: true,
          componentRendered: true,
          resources: 35,
          auditedTextFiles: true,
          portable: true,
          packageSource: true,
          installedVersion: version,
        },
      )
      assert.ok(output.auditedTextFiles > 0)
    }
    assert.equal(report.fixtures, undefined)
    assert.deepEqual(ownedRoots(sandbox.root), [])
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

void test('cleans the fixture root when a child command fails', () => {
  const sandbox = isolatedEnvironment()
  try {
    const result = runVerifier({
      args: ['--keep-fixtures'],
      env: {
        ...sandbox.env,
        PLAYCAPTCHA_PLAYGROUNDS_PNPM: 'playcaptcha-command-that-does-not-exist',
      },
    })
    assert.notEqual(result.status, 0, describeFailure(result))
    assert.deepEqual(ownedRoots(sandbox.root), [])
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

void test('kept framework fixtures contain every source input independently', () => {
  const sandbox = isolatedEnvironment()
  try {
    const result = runVerifier({ args: ['--keep-fixtures'], env: sandbox.env })
    assert.equal(result.status, 0, describeFailure(result))
    const report = JSON.parse(result.stdout)
    for (const fixture of Object.values(report.fixtures)) {
      assert.equal(existsSync(join(fixture, 'shared', 'demo.css')), true)
      for (const sourcePath of sourceFiles(join(fixture, 'src'))) {
        assert.doesNotMatch(readFileSync(sourcePath, 'utf8'), /\.\.\/\.\.\/shared\/demo\.css/u)
      }
    }
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

void test('rejects the wrong configured pnpm version and cleans its fixture root', () => {
  const sandbox = isolatedEnvironment()
  try {
    const shim = join(sandbox.root, 'pnpm')
    writeFileSync(shim, '#!/usr/bin/env node\nprocess.stdout.write("10.32.0\\n")\n')
    chmodSync(shim, 0o755)
    const result = runVerifier({
      env: { ...sandbox.env, PLAYCAPTCHA_PLAYGROUNDS_PNPM: shim },
    })
    assert.notEqual(result.status, 0, describeFailure(result))
    assert.match(result.stderr, /expected pnpm 10\.33\.0/i)
    assert.match(result.stderr, /10\.32\.0/)
    assert.deepEqual(ownedRoots(sandbox.root), [])
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

void test('keeps and reports successful fixtures only when requested', () => {
  const sandbox = isolatedEnvironment()
  try {
    const result = runVerifier({ args: ['--keep-fixtures'], env: sandbox.env })
    assert.equal(result.status, 0, describeFailure(result))
    const report = JSON.parse(result.stdout)
    assert.deepEqual(Object.keys(report.fixtures), ['vanilla', 'react', 'vue', 'server'])
    for (const fixture of Object.values(report.fixtures)) assert.equal(isAbsolute(fixture), true)

    const roots = new Set(Object.values(report.fixtures).map((fixture) => dirname(fixture)))
    assert.equal(roots.size, 1)
    const [root] = roots
    assert.equal(dirname(root), sandbox.root)
    assert.equal(existsSync(root), true)
    for (const fixture of Object.values(report.fixtures)) {
      assert.equal(dirname(fixture), root)
      assert.equal(existsSync(fixture), true)
    }
    assert.match(result.stderr, new RegExp(`Playground fixtures kept at ${root}`))
    assert.deepEqual(ownedRoots(sandbox.root), [basename(root)])
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

void test('rejects unknown flags without creating a fixture root', () => {
  const sandbox = isolatedEnvironment()
  try {
    const result = runVerifier({ args: ['--unknown'], env: sandbox.env })
    assert.notEqual(result.status, 0, describeFailure(result))
    assert.match(result.stderr, /unknown option: --unknown/i)
    assert.deepEqual(ownedRoots(sandbox.root), [])
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})
