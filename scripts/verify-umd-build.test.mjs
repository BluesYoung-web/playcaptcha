import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertEs2018,
  auditInsetFallback,
  findUnsupportedImportMetaUses,
  preservesLitExternalImport,
} from './verify-umd-build.mjs'

const zeroSelectors = [
  '.clawcap-info',
  '.cc-glass-shine',
  '.cc-tray-hatch',
  '.cc-tray-mouth',
  '.cc-tray-mouth:after',
  '.cc-tray-skin',
  '.cc-tray-label',
  '.cc-tray:before',
  '.cc-tray--win:after',
]
const zeroDeclarations = [
  'top:var(--cc-inset-fallback-top,0)',
  'right:var(--cc-inset-fallback-right,0)',
  'bottom:var(--cc-inset-fallback-bottom,0)',
  'left:var(--cc-inset-fallback-left,0)',
].join(';')
const actionDeclarations = [
  'top:var(--cc-action-inset-fallback-top,-9px)',
  'right:var(--cc-action-inset-fallback-right,-9px)',
  'bottom:var(--cc-action-inset-fallback-bottom,-9px)',
  'left:var(--cc-action-inset-fallback-left,-9px)',
].join(';')
const currentBundleFixture =
  `const css=":host{display:block}@supports not (inset: 0) {${zeroSelectors.join(',')}{${zeroDeclarations}}` +
  `.cc-action:after{${actionDeclarations}}}";`

void test('accepts the current bundled inset fallbacks', () => {
  assert.doesNotThrow(() => auditInsetFallback(currentBundleFixture))
})

void test('rejects every missing zero-fallback selector', () => {
  for (const selector of zeroSelectors) {
    const mutatedSelectors = zeroSelectors.filter((candidate) => candidate !== selector)
    const mutated = currentBundleFixture.replace(
      zeroSelectors.join(','),
      mutatedSelectors.join(','),
    )
    assert.throws(() => auditInsetFallback(mutated))
  }
})

void test('rejects a changed zero fallback on every edge', () => {
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    assert.throws(() =>
      auditInsetFallback(
        currentBundleFixture.replace(
          `--cc-inset-fallback-${edge},0`,
          `--cc-inset-fallback-${edge},1px`,
        ),
      ),
    )
  }
})

void test('rejects a changed action fallback on every edge', () => {
  for (const edge of ['top', 'right', 'bottom', 'left']) {
    assert.throws(() =>
      auditInsetFallback(
        currentBundleFixture.replace(
          `--cc-action-inset-fallback-${edge},-9px`,
          `--cc-action-inset-fallback-${edge},0`,
        ),
      ),
    )
  }
})

void test('rejects a declaration moved to the wrong selector', () => {
  const moved = currentBundleFixture
    .replace(`top:var(--cc-inset-fallback-top,0);`, '')
    .replace(
      `.cc-action:after{`,
      `.wrong-selector{top:var(--cc-inset-fallback-top,0)}.cc-action:after{`,
    )
  assert.throws(() => auditInsetFallback(moved))
})

void test('rejects fallback text that exists only in JavaScript comments or unrelated strings', () => {
  assert.throws(() => auditInsetFallback(`// ${currentBundleFixture}`))
  assert.throws(() =>
    auditInsetFallback(`const unrelated = ${JSON.stringify(currentBundleFixture)}`),
  )
})

void test('allows only real import.meta.url syntax', () => {
  assert.deepEqual(findUnsupportedImportMetaUses('const url = import.meta.url'), [])
  assert.deepEqual(findUnsupportedImportMetaUses('const value = import.meta.resolve("x")'), [
    'import.meta.resolve',
  ])
  assert.deepEqual(findUnsupportedImportMetaUses('const text = "import.meta.resolve"'), [])
  assert.deepEqual(findUnsupportedImportMetaUses('// import.meta.resolve\nconst value = 1'), [])
  assert.deepEqual(findUnsupportedImportMetaUses('/* import.meta.resolve */ const value = 1'), [])
})

void test('IIFE import.meta audit ignores strings and comments but rejects real syntax', () => {
  assert.deepEqual(
    findUnsupportedImportMetaUses('const text = "import.meta"', 'fixture.js', 'script'),
    [],
  )
  assert.deepEqual(
    findUnsupportedImportMetaUses('// import.meta\nconst value = 1', 'fixture.js', 'script'),
    [],
  )
  assert.deepEqual(
    findUnsupportedImportMetaUses('/* import.meta */ const value = 1', 'fixture.js', 'script'),
    [],
  )
  assert.throws(() =>
    findUnsupportedImportMetaUses('const value = import.meta.url', 'fixture.js', 'script'),
  )
})

void test('accepts only a real bare Lit import declaration as the ESM external', () => {
  assert.equal(preservesLitExternalImport(`import { LitElement } from 'lit'`), true)
  assert.equal(preservesLitExternalImport(`import './x'; const marker = 'from "lit"'`), false)
  assert.equal(preservesLitExternalImport(`import './x'; // from 'lit'`), false)
  assert.equal(preservesLitExternalImport(`const marker = 'from "lit"'`), false)
  assert.equal(preservesLitExternalImport(`const marker = 'lit'`), false)
  assert.equal(preservesLitExternalImport(`// from 'lit'`), false)
  assert.equal(preservesLitExternalImport(`/* from 'lit' */`), false)
  assert.equal(preservesLitExternalImport(`const marker = 'nothing to import'`), false)
  assert.equal(preservesLitExternalImport(''), false)
})

void test('rejects syntax above ES2018 in ESM and IIFE code without scanning CSS strings', () => {
  assert.doesNotThrow(() => assertEs2018('export const value = 1', 'fixture.mjs', 'module'))
  assert.doesNotThrow(() => assertEs2018('(() => { const value = 1 })()', 'fixture.js', 'script'))
  assert.doesNotThrow(() =>
    assertEs2018('export const css = ".selector{content:\\"?.\\"}"', 'fixture.mjs', 'module'),
  )
  assert.doesNotThrow(() =>
    assertEs2018('(() => ".selector{content:\\"?.\\"}")()', 'fixture.js', 'script'),
  )
  assert.throws(() =>
    assertEs2018('export const value = globalThis.foo?.bar', 'fixture.mjs', 'module'),
  )
  assert.throws(() => assertEs2018('(() => globalThis.foo?.bar)()', 'fixture.js', 'script'))
})
