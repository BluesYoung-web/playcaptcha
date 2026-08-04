import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, win32 } from 'node:path'
import { before, test } from 'node:test'
import {
  assertPackageSource,
  assertPortableReport,
  auditOutputText,
  verifyNativeHtml,
} from './verify-release-artifacts.mjs'

const project = new URL('..', import.meta.url)
const packageVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version

function sourceFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)
    return entry.isDirectory() ? sourceFiles(child) : [child]
  })
}

function releaseBuildIsCurrent() {
  const outputs = ['dist/index.mjs', 'dist/index.d.mts', 'dist/playcaptcha.umd.js']
  if (outputs.some((path) => !existsSync(path))) return false
  const oldestOutput = Math.min(...outputs.map((path) => statSync(path).mtimeMs))
  const inputs = [
    'package.json',
    'vite.config.ts',
    ...sourceFiles('src').filter((path) => !path.endsWith('.test.ts')),
  ]
  return inputs.every((path) => statSync(path).mtimeMs <= oldestOutput)
}

before(() => {
  if (releaseBuildIsCurrent()) return
  const result = spawnSync('pnpm', ['build'], { cwd: project, encoding: 'utf8', timeout: 180_000 })
  assert.equal(result.status, 0, describeFailure(result))
})

function runConsumer(options = {}) {
  return spawnSync(
    process.execPath,
    ['scripts/verify-package-consumer.mjs', ...(options.args ?? [])],
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

function isolatedEnvironment(prefix = 'playcaptcha-consumer-test-') {
  const root = mkdtempSync(join(tmpdir(), prefix))
  return {
    root,
    env: { TMPDIR: root, TMP: root, TEMP: root },
  }
}

function ownedRoots(parent) {
  return readdirSync(parent).filter((entry) => entry.startsWith('playcaptcha-consumer-'))
}

void test('verifies the packed UMD with a native HTML fixture', () => {
  const sandbox = isolatedEnvironment()
  try {
    const result = runConsumer({ args: ['--skip-build'], env: sandbox.env })
    assert.equal(result.status, 0, describeFailure(result))
    const report = JSON.parse(result.stdout)
    assert.equal(JSON.stringify(report).includes(sandbox.root), false)
    assert.deepEqual(Object.keys(report).sort(), [
      'auditedTextFiles',
      'componentRegistration',
      'componentRendered',
      'installedVersion',
      'nativeHtml',
      'outputFiles',
      'packageSource',
      'portable',
      'resourceFiles',
      'resources',
      'scriptRelativeAssets',
      'tarball',
      'umd',
    ])

    assert.equal(report.umd, true)
    assert.equal(report.resources, 35)
    assert.equal(report.nativeHtml, true)
    assert.equal(report.packageSource, true)
    assert.equal(report.installedVersion, packageVersion)
    assert.equal(report.portable, true)
    assert.ok(report.auditedTextFiles > 0)
    assert.equal(report.nativeFixture, undefined)
    assert.deepEqual(ownedRoots(sandbox.root), [])
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

void test('rejects wrong installed identity and an installed realpath outside the fixture', () => {
  const valid = {
    fixture: '/tmp/owned-consumer',
    installedRealpath: '/tmp/owned-consumer/node_modules/playcaptcha',
    projectRealpath: '/workspace/playcaptcha',
    packedManifest: { name: 'playcaptcha', version: packageVersion },
    installedManifest: { name: 'playcaptcha', version: packageVersion },
  }
  assert.doesNotThrow(() => assertPackageSource(valid))
  assert.throws(
    () =>
      assertPackageSource({
        ...valid,
        installedManifest: { name: 'wrong', version: packageVersion },
      }),
    new RegExp(`unexpected package wrong@${packageVersion.replaceAll('.', '\\.')}`, 'i'),
  )
  assert.throws(
    () =>
      assertPackageSource({
        ...valid,
        installedManifest: { name: 'playcaptcha', version: '9.9.9' },
      }),
    /unexpected package playcaptcha@9\.9\.9/i,
  )
  assert.throws(
    () => assertPackageSource({ ...valid, installedRealpath: '/workspace/playcaptcha' }),
    /resolved outside/i,
  )
})

void test('canonicalizes package parents and children through an injectable realpath resolver', () => {
  const aliases = new Map([
    ['/var/folders/fixture', '/private/var/folders/fixture'],
    [
      '/var/folders/fixture/node_modules/playcaptcha',
      '/private/var/folders/fixture/node_modules/playcaptcha',
    ],
    ['/workspace/playcaptcha', '/workspace/playcaptcha'],
  ])
  assert.doesNotThrow(() =>
    assertPackageSource({
      fixture: '/var/folders/fixture',
      installedRealpath: '/var/folders/fixture/node_modules/playcaptcha',
      projectRealpath: '/workspace/playcaptcha',
      packedManifest: { name: 'playcaptcha', version: packageVersion },
      installedManifest: { name: 'playcaptcha', version: packageVersion },
      realpathResolver: (path) => aliases.get(path) ?? path,
    }),
  )
})

void test('uses Windows path semantics for installed-package containment', () => {
  const valid = {
    fixture: String.raw`C:\fixtures\consumer`,
    installedRealpath: String.raw`C:\fixtures\consumer\node_modules\playcaptcha`,
    projectRealpath: String.raw`D:\source\playcaptcha`,
    packedManifest: { name: 'playcaptcha', version: packageVersion },
    installedManifest: { name: 'playcaptcha', version: packageVersion },
    realpathResolver: (path) => path,
    pathApi: win32,
  }

  assert.doesNotThrow(() => assertPackageSource(valid))
  assert.throws(
    () =>
      assertPackageSource({
        ...valid,
        installedRealpath: String.raw`C:\fixtures\consumer-copy\node_modules\playcaptcha`,
      }),
    /resolved outside/i,
  )
})

void test('native HTML execution rejects a page tag plus a non-registering classic bundle', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'playcaptcha-native-synthetic-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'bundle.js'), 'const tag = "play-captcha"')
  writeFileSync(
    join(root, 'native.html'),
    '<script src="./bundle.js"></script><play-captcha></play-captcha>',
  )
  await assert.rejects(verifyNativeHtml('consumer', join(root, 'native.html')), /did not register/i)
})

void test('native HTML execution rejects a classic script outside its fixture', async (t) => {
  const parent = mkdtempSync(join(tmpdir(), 'playcaptcha-native-containment-'))
  t.after(() => rmSync(parent, { recursive: true, force: true }))
  const fixture = join(parent, 'fixture')
  mkdirSync(fixture)
  writeFileSync(join(parent, 'outside.js'), 'customElements.define("play-captcha", class {})')
  writeFileSync(
    join(fixture, 'native.html'),
    '<script src="../outside.js"></script><play-captcha></play-captcha>',
  )
  assert.throws(
    () => verifyNativeHtml('consumer', join(fixture, 'native.html')),
    /outside fixture/i,
  )
})

void test('consumer text audit rejects temporary and file tarball leaks', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'playcaptcha-consumer-output-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(
    join(root, 'index.js'),
    `const archive = "file:/tmp/playcaptcha-${packageVersion}.tgz"`,
  )
  assert.throws(() => auditOutputText('consumer', root), /temporary path|tarball absolute path/i)
})

void test('report audit permits only the exact keep-fixture fields', () => {
  assert.throws(
    () => assertPortableReport({ outputs: { vanilla: { debugPath: '/workspace/build/app.js' } } }),
    /outputs\.vanilla\.debugPath/i,
  )
  assert.throws(
    () =>
      assertPortableReport(
        { outputs: { nativeFixture: '/tmp/not-a-kept-fixture' } },
        new Set(['nativeFixture']),
      ),
    /outputs\.nativeFixture/i,
  )
  assert.doesNotThrow(() =>
    assertPortableReport(
      { nativeFixture: '/tmp/playcaptcha-consumer-owned' },
      new Set(['nativeFixture']),
    ),
  )
})

void test('cleans a kept native fixture when a child command fails', () => {
  const sandbox = isolatedEnvironment()
  const shimRoot = mkdtempSync(join(tmpdir(), 'playcaptcha-consumer-shim-'))
  try {
    const npmShim = join(shimRoot, 'npm')
    writeFileSync(npmShim, '#!/bin/sh\necho controlled npm failure >&2\nexit 42\n')
    chmodSync(npmShim, 0o755)
    const result = runConsumer({
      args: ['--skip-build', '--keep-native-fixture'],
      env: { ...sandbox.env, PATH: `${shimRoot}:${process.env.PATH ?? ''}` },
    })

    assert.notEqual(result.status, 0, describeFailure(result))
    assert.match(result.stderr, /controlled npm failure/i)
    assert.deepEqual(ownedRoots(sandbox.root), [])
  } finally {
    rmSync(shimRoot, { recursive: true, force: true })
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

void test('keeps and reports a successful native fixture only when requested', () => {
  const sandbox = isolatedEnvironment()
  let fixture
  try {
    const result = runConsumer({
      args: ['--skip-build', '--keep-native-fixture'],
      env: sandbox.env,
    })
    assert.equal(result.status, 0, describeFailure(result))
    const report = JSON.parse(result.stdout)
    assert.deepEqual(Object.keys(report).sort(), [
      'auditedTextFiles',
      'componentRegistration',
      'componentRendered',
      'installedVersion',
      'nativeFixture',
      'nativeHtml',
      'outputFiles',
      'packageSource',
      'portable',
      'resourceFiles',
      'resources',
      'scriptRelativeAssets',
      'tarball',
      'umd',
    ])
    fixture = report.nativeFixture
    assert.equal(isAbsolute(fixture), true)
    assert.equal(existsSync(fixture), true)
    assert.deepEqual(ownedRoots(sandbox.root), [basename(fixture)])
    assert.equal(join(sandbox.root, ownedRoots(sandbox.root)[0]), fixture)
  } finally {
    if (fixture) rmSync(fixture, { recursive: true, force: true })
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

void test('emits pure JSON while reusing the suite release build', () => {
  const sandbox = isolatedEnvironment()
  try {
    const result = runConsumer({ args: ['--skip-build'], env: sandbox.env })
    assert.equal(result.status, 0, describeFailure(result))
    const report = JSON.parse(result.stdout)
    assert.equal(JSON.stringify(report).includes(sandbox.root), false)
    assert.equal(report.umd, true)
    assert.equal(report.resources, 35)
    assert.equal(report.nativeHtml, true)
    assert.equal(report.componentRendered, true)
    assert.equal(report.scriptRelativeAssets, true)
    assert.equal(report.packageSource, true)
    assert.equal(report.installedVersion, packageVersion)
    assert.equal(report.portable, true)
    assert.equal(report.nativeFixture, undefined)
    assert.deepEqual(ownedRoots(sandbox.root), [])
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})

void test('rejects unknown flags before creating a fixture root', () => {
  const sandbox = isolatedEnvironment()
  try {
    const result = runConsumer({ args: ['--skip-build', '--unknown'], env: sandbox.env })
    assert.notEqual(result.status, 0, describeFailure(result))
    assert.match(result.stderr, /unknown option: --unknown/i)
    assert.deepEqual(ownedRoots(sandbox.root), [])
  } finally {
    rmSync(sandbox.root, { recursive: true, force: true })
  }
})
