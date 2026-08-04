import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { Window } from 'happy-dom'
import { parseSync, transformSync } from 'vite-plus/binding'

const insetFallbackSelectors = [
  '.clawcap-info',
  '.cc-glass-shine',
  '.cc-tray-hatch',
  '.cc-tray-mouth',
  '.cc-tray-mouth::after',
  '.cc-tray-skin',
  '.cc-tray-label',
  '.cc-tray::before',
  '.cc-tray--win::after',
]

export const assertEs2018 = (code, filename, sourceType) => {
  const normalize = (target) => {
    const result = transformSync(filename, code, { sourceType, target })
    if (result.errors.length) {
      throw new Error(
        `Oxc could not validate ${filename} for ${target}: ${JSON.stringify(result.errors)}`,
      )
    }
    return result.code
  }
  if (normalize('esnext') !== normalize('es2018')) {
    throw new Error(
      `${filename} contains lowerable syntax above ES2018 (for example class static blocks, optional chaining, or nullish coalescing)`,
    )
  }
}

const parseProgram = (code, filename, sourceType) => {
  const parsed = parseSync(filename, code, { sourceType })
  if (parsed.errors.length) {
    throw new Error(`Oxc could not parse ${filename}: ${JSON.stringify(parsed.errors)}`)
  }
  return JSON.parse(parsed.program).node
}

export const findUnsupportedImportMetaUses = (
  code,
  filename = 'fixture.mjs',
  sourceType = 'module',
) => {
  const program = parseProgram(code, filename, sourceType)
  const unsupported = []
  const visit = (value, parent) => {
    if (!value || typeof value !== 'object') return
    if (
      value.type === 'MetaProperty' &&
      value.meta?.name === 'import' &&
      value.property?.name === 'meta'
    ) {
      const allowed =
        parent?.type === 'MemberExpression' &&
        parent.object === value &&
        !parent.computed &&
        parent.property?.type === 'Identifier' &&
        parent.property.name === 'url'
      if (!allowed) {
        unsupported.push(code.slice(value.start, parent?.object === value ? parent.end : value.end))
      }
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        for (const item of child) visit(item, value)
      } else {
        visit(child, value)
      }
    }
  }
  visit(program)
  return unsupported
}

export const preservesLitExternalImport = (code, filename = 'fixture.mjs') => {
  const program = parseProgram(code, filename, 'module')
  return program.body.some(
    (statement) => statement.type === 'ImportDeclaration' && statement.source?.value === 'lit',
  )
}

const findClosingBrace = (text, openingBrace) => {
  let depth = 0
  for (let index = openingBrace; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1
    if (text[index] === '}') {
      depth -= 1
      if (depth === 0) return index
    }
  }
  return -1
}

const parseStyleRules = (block) => {
  const rules = []
  let cursor = 0
  while (cursor < block.length) {
    const openingBrace = block.indexOf('{', cursor)
    if (openingBrace < 0) break
    const closingBrace = findClosingBrace(block, openingBrace)
    if (closingBrace < 0) break
    const selectorText = block.slice(cursor, openingBrace).trim()
    if (selectorText && !selectorText.startsWith('@')) {
      const declarations = new Map()
      for (const declaration of block.slice(openingBrace + 1, closingBrace).split(';')) {
        const colon = declaration.indexOf(':')
        if (colon < 0) continue
        declarations.set(
          declaration.slice(0, colon).trim(),
          declaration
            .slice(colon + 1)
            .trim()
            .replaceAll(/\s+/gu, ''),
        )
      }
      rules.push({
        selectors: selectorText.split(',').map((selector) => selector.trim().replaceAll('::', ':')),
        declarations,
      })
    }
    cursor = closingBrace + 1
  }
  return rules
}

const extractInsetSupportRules = (bundleText) => {
  const program = parseProgram(bundleText, 'inline-css-bundle.js', 'unambiguous')
  const cssPayloads = []
  const collectCssPayloads = (value) => {
    if (!value || typeof value !== 'object') return
    if (
      value.type === 'Literal' &&
      typeof value.value === 'string' &&
      value.value.trimStart().startsWith(':host') &&
      value.value.includes('@supports')
    ) {
      cssPayloads.push(value.value)
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        for (const item of child) collectCssPayloads(item)
      } else {
        collectCssPayloads(child)
      }
    }
  }
  collectCssPayloads(program)
  const rules = []
  const pattern = /@supports\s+not\s*\(\s*inset\s*:\s*0\s*\)\s*\{/gu
  for (const css of cssPayloads) {
    for (const match of css.matchAll(pattern)) {
      const openingBrace = match.index + match[0].lastIndexOf('{')
      const closingBrace = findClosingBrace(css, openingBrace)
      if (closingBrace >= 0) {
        rules.push(...parseStyleRules(css.slice(openingBrace + 1, closingBrace)))
      }
    }
  }
  return rules
}

export const auditInsetFallback = (bundleText, artifactName = 'artifact') => {
  const rules = extractInsetSupportRules(bundleText)
  const hasBoundFallback = (selector, prefix, fallback) => {
    const normalizedSelector = selector.replaceAll('::', ':')
    return rules.some(
      (rule) =>
        rule.selectors.includes(normalizedSelector) &&
        ['top', 'right', 'bottom', 'left'].every(
          (edge) =>
            rule.declarations.get(edge) === `var(--cc-${prefix}-fallback-${edge},${fallback})`,
        ),
    )
  }
  const valid =
    insetFallbackSelectors.every((selector) => hasBoundFallback(selector, 'inset', '0')) &&
    hasBoundFallback('.cc-action::after', 'action-inset', '-9px')
  if (!valid) {
    throw new Error(`${artifactName} does not preserve the Chrome 80 / Safari 13 inset fallback`)
  }
}

export const verifyUmdBuild = async () => {
  const output = resolve(import.meta.dirname, '../dist/playcaptcha.umd.js')
  const esmOutput = resolve(import.meta.dirname, '../dist/index.mjs')
  const typesOutput = resolve(import.meta.dirname, '../dist/index.d.mts')
  if (!existsSync(esmOutput) || !existsSync(typesOutput)) {
    throw new Error('UMD build did not preserve dist/index.mjs and dist/index.d.mts')
  }
  const code = readFileSync(output, 'utf8')
  const esmCode = readFileSync(esmOutput, 'utf8')
  const compatibilityErrors = []
  for (const [name, artifact, filename, sourceType] of [
    ['ESM', esmCode, esmOutput, 'module'],
    ['UMD', code, output, 'script'],
  ]) {
    try {
      assertEs2018(artifact, filename, sourceType)
    } catch (error) {
      compatibilityErrors.push(error.message)
    }
    try {
      auditInsetFallback(artifact, name)
    } catch (error) {
      compatibilityErrors.push(error.message)
    }
  }
  if (findUnsupportedImportMetaUses(esmCode).length) {
    compatibilityErrors.push(
      'ESM contains unsupported import.meta usage other than import.meta.url',
    )
  }
  try {
    if (findUnsupportedImportMetaUses(code, output, 'script').length) {
      compatibilityErrors.push('UMD contains import.meta')
    }
  } catch {
    compatibilityErrors.push('UMD contains import.meta')
  }
  if (!preservesLitExternalImport(esmCode, esmOutput)) {
    compatibilityErrors.push('ESM no longer preserves Lit as an external import')
  }
  if (compatibilityErrors.length) throw new Error(compatibilityErrors.join('\n'))

  const invalid = [
    [/^\s*import\s/mu, 'top-level import'],
    [/^\s*export\s/mu, 'top-level export'],
    [/from\s+["'](?:lit|lit-html|@lit)(?:\/|["'])/u, 'external Lit import'],
    [/\brequire\(["'](?:lit|lit-html|@lit)(?:\/|["'])/u, 'external Lit require'],
  ].filter(([pattern]) => pattern.test(code))

  if (invalid.length) {
    throw new Error(`UMD contains ${invalid.map(([, name]) => name).join(', ')}`)
  }
  if (!code.includes('play-captcha')) {
    throw new Error('UMD does not contain the registration entry')
  }
  if (!code.includes('../assets/')) {
    throw new Error('UMD does not preserve package-relative assets')
  }

  const window = new Window({ url: 'https://cdn.test/playcaptcha/native.html' })
  const script = window.document.createElement('script')
  script.src = 'https://cdn.test/playcaptcha/dist/playcaptcha.umd.js'
  window.document.head.append(script)
  Object.defineProperty(window.document, 'currentScript', { configurable: true, value: script })
  window.eval(code)
  const definition = window.customElements.get('play-captcha')
  if (!definition) throw new Error('classic UMD execution did not register play-captcha')
  window.eval(code)
  if (window.customElements.get('play-captcha') !== definition) {
    throw new Error('repeated classic UMD execution replaced the definition')
  }
  if ('PlayCaptcha' in window) throw new Error('UMD leaked an unsupported PlayCaptcha global')

  const amdWindow = new Window({ url: 'https://app.test/demo/native.html' })
  const amdScript = amdWindow.document.createElement('script')
  amdScript.src = 'https://cdn.test/playcaptcha/dist/playcaptcha.umd.js'
  amdWindow.document.head.append(amdScript)
  Object.defineProperty(amdWindow.document, 'currentScript', {
    configurable: true,
    value: amdScript,
  })
  let amdDefineCalls = 0
  const define = () => {
    amdDefineCalls += 1
  }
  define.amd = {}
  amdWindow.define = define
  amdWindow.eval(code)
  if (!amdWindow.customElements.get('play-captcha')) {
    throw new Error('classic bundle did not register immediately beside an AMD loader')
  }
  if (amdDefineCalls !== 0) throw new Error('classic bundle registered an anonymous AMD module')
  const amdCaptcha = amdWindow.document.createElement('play-captcha')
  amdWindow.document.body.append(amdCaptcha)
  await amdCaptcha.updateComplete
  const amdTile = amdCaptcha.shadowRoot?.querySelector('.cc-mahjong')
  if (!amdTile?.src.startsWith('https://cdn.test/playcaptcha/assets/majiang_ui/')) {
    throw new Error(`AMD coexistence resolved assets from the wrong base: ${amdTile?.src}`)
  }
  await Promise.all([window.happyDOM.close(), amdWindow.happyDOM.close()])

  console.log(
    JSON.stringify(
      { output, classicScript: true, idempotent: true, amdCoexistence: true },
      null,
      2,
    ),
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyUmdBuild()
}
