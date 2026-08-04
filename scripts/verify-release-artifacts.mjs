import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const STANDARD_MAHJONG_VALUES = [
  1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28, 29, 32,
  33, 34, 35, 36, 37, 38, 39, 40,
]
const PACKAGED_MAHJONG_VALUES = [...STANDARD_MAHJONG_VALUES, 46, 47, 48, 49, 50, 51, 52, 53]

export const EXPECTED_PACKAGE_ASSETS = [
  ...PACKAGED_MAHJONG_VALUES.map((value) => `assets/majiang_ui/${value}.webp`),
  'assets/playcaptcha.svg',
]

export const EXPECTED_RESOURCES = [
  ...STANDARD_MAHJONG_VALUES.map((value) => ({
    stem: String(value),
    extension: 'webp',
    directory: 'majiang_ui',
  })),
  { stem: 'playcaptcha', extension: 'svg', directory: '' },
]

const textExtensions = new Set(['.html', '.js', '.css', '.map', '.json', '.svg'])

export function filesRecursively(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)
    return entry.isDirectory() ? filesRecursively(child) : [child]
  })
}

function normalizedForms(path) {
  if (!path) return []
  const native = String(path)
  const posix = native.replaceAll('\\', '/')
  const windows = posix.replaceAll('/', '\\')
  return [...new Set([native, posix, windows])]
}

function containsPosixFilesystemPath(source) {
  const matches = source.matchAll(/(?:^|["'\s(])(\/(?:[^/"'\s)]+\/)+[^"'\s)]*)/giu)
  for (const match of matches) {
    const value = match[1].split(/[?#]/u, 1)[0]
    const segments = value.split('/').filter(Boolean)
    if (['assets', 'api', 'v1', 'v2', 'v3'].includes(segments[0])) continue
    if (/\.(?:[cm]?[jt]sx?|css|map|json|tgz)$/iu.test(value)) return true
    if (
      /^(?:home|Users|tmp|private|root|workspace|build|opt|var|Volumes|usr|srv|mnt)$/u.test(
        segments[0],
      )
    ) {
      return value !== '/home/profile'
    }
  }
  return false
}

export function auditOutputText(label, root, exactPaths = {}) {
  let auditedTextFiles = 0
  for (const path of filesRecursively(root)) {
    if (!textExtensions.has(extname(path))) continue
    auditedTextFiles += 1
    const source = readFileSync(path, 'utf8')
    const filesystemText = source.replaceAll(/\burl\(\s*["']?\/[^)]*\)/giu, '')
    const outputPath = relative(root, path).split(sep).join('/')
    const checks = [
      ...Object.entries(exactPaths).flatMap(([name, exact]) =>
        (Array.isArray(exact) ? exact : [exact]).flatMap((value) =>
          normalizedForms(value).map((form) => [`${name} absolute path`, source.includes(form)]),
        ),
      ),
      [
        'file tarball absolute path',
        /\bfile:(?:\/{1,3}|[A-Za-z]:[\\/])[^\s"')]+\.tgz\b/iu.test(source),
      ],
      ['temporary path', filesystemPathPattern('tmp', true).test(filesystemText)],
      ['macOS temporary path', filesystemPathPattern('private/var', true).test(filesystemText)],
      ['macOS user path', filesystemPathPattern('Users', true).test(filesystemText)],
      ['home absolute path', filesystemPathPattern('home', true).test(filesystemText)],
      [
        'Unix absolute path',
        filesystemPathPattern('(?:opt|root|workspace|build|var/tmp|Volumes)', true).test(
          filesystemText,
        ),
      ],
      ['file absolute path', /(?:^|["'\s(])file:\/{1,3}[^"'\s)]*/iu.test(filesystemText)],
      [
        'Windows absolute path',
        /(?:^|["'\s(])(?:[A-Za-z]:\\[^"'\s)]*|\\{2,}(?:[^\\/"'\s)]+\\)+[^"'\s)]*)/iu.test(
          filesystemText,
        ),
      ],
      ['POSIX absolute path', containsPosixFilesystemPath(filesystemText)],
    ]
    for (const [kind, found] of checks) {
      if (found) throw new Error(`${label} output contains ${kind}: ${outputPath}`)
    }
  }
  return { auditedTextFiles, portable: true }
}

function filesystemPathPattern(prefix, requirePathEvidence = false) {
  const suffix = requirePathEvidence
    ? `(?=/[^"'\\s)]*(?:/|\\.(?:[cm]?[jt]sx?|css|map|json|tgz)\\b)|["'])`
    : ''
  return new RegExp(`(?:^|["'\\s(])(?:file:)?/${prefix}${suffix}(?:/[^"'\\s)]*)?`, 'iu')
}

function normalizeMediaReference(sourcePath, dist, value) {
  if (/^(?:[a-z]+:|\/\/|#)/iu.test(value)) return undefined
  const clean = value.replaceAll('\\', '/').split(/[?#]/u, 1)[0]
  if (!/\.(?:png|webp|svg|jpe?g|gif|avif)$/iu.test(clean)) return undefined
  const rootRelative = clean.startsWith('/')
    ? posix.normalize(clean.replace(/^\/+/, ''))
    : posix.normalize(posix.join(relative(dist, dirname(sourcePath)).replaceAll('\\', '/'), clean))
  if (rootRelative === '..' || rootRelative.startsWith('../') || posix.isAbsolute(rootRelative)) {
    throw new Error(`media URL resolves outside dist: ${value}`)
  }
  return rootRelative
}

function referencedAssets(path, dist, source) {
  const extension = extname(path)
  if (extension === '.html') {
    const markup = source.replaceAll(/<!--[\s\S]*?-->/gu, '')
    return [...markup.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/giu)]
      .map((match) => normalizeMediaReference(path, dist, match[1]))
      .filter(Boolean)
  }
  if (extension === '.css') {
    const css = source.replaceAll(/\/\*[\s\S]*?\*\//gu, '')
    return [...css.matchAll(/\burl\(\s*["']?([^"')\s]+)["']?\s*\)/giu)]
      .map((match) => normalizeMediaReference(path, dist, match[1]))
      .filter(Boolean)
  }
  if (extension !== '.js') return []

  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  )
  const references = []
  function containsImportMetaUrl(node) {
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'url' &&
      ts.isMetaProperty(node.expression) &&
      node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
      node.expression.name.text === 'meta'
    ) {
      return true
    }
    return node.getChildren(sourceFile).some(containsImportMetaUrl)
  }
  function visit(node) {
    if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      /\.(?:png|webp|svg|jpe?g|gif|avif)(?:[?#].*)?$/iu.test(node.text)
    ) {
      const parent = node.parent
      if (ts.isNewExpression(parent) && parent.expression.getText(sourceFile) === 'URL') {
        const isBundlerAssetUrl =
          parent.arguments?.[0] === node &&
          parent.arguments.length > 1 &&
          containsImportMetaUrl(parent.arguments[1])
        if (!isBundlerAssetUrl) {
          ts.forEachChild(node, visit)
          return
        }
      }
      const reference = normalizeMediaReference(path, dist, node.text)
      if (reference) references.push(reference)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return references
}

export function verifyResourceFiles(label, dist) {
  const files = filesRecursively(dist)
  const relativeFiles = files.map((path) => relative(dist, path).split(sep).join('/'))
  const references = new Set(
    files
      .filter((path) => textExtensions.has(extname(path)))
      .flatMap((path) => referencedAssets(path, dist, readFileSync(path, 'utf8'))),
  )
  const emitted = new Set(relativeFiles)
  for (const reference of references) {
    if (!emitted.has(reference)) {
      throw new Error(`${label} output references missing output file: ${reference}`)
    }
  }
  const resourceFiles = []
  const invalid = []

  for (const { stem, extension } of EXPECTED_RESOURCES.filter(
    ({ extension }) => extension !== 'webp',
  )) {
    const pattern = new RegExp(`(?:^|/)${stem}-[A-Za-z0-9_-]+.${extension}$`, 'u')
    const matches = relativeFiles.filter((path) => pattern.test(path))
    if (matches.length !== 1) {
      invalid.push(`${stem} (${matches.length})`)
      continue
    }
    const [resource] = matches
    if (!references.has(resource)) {
      throw new Error(
        `${label} output does not reference resource: ${resource}; parsed references: ${[...references].sort((left, right) => left.localeCompare(right)).join(', ') || '(none)'}`,
      )
    }
    resourceFiles.push(resource)
  }
  const emittedWebp = relativeFiles.filter((path) => path.endsWith('.webp'))
  const referencedWebp = emittedWebp.filter((path) => references.has(path))
  const minimumWebp = EXPECTED_RESOURCES.filter(({ extension }) => extension === 'webp').length - 2
  const maximumWebp = EXPECTED_RESOURCES.filter(({ extension }) => extension === 'webp').length
  if (
    emittedWebp.length < minimumWebp ||
    emittedWebp.length > maximumWebp ||
    referencedWebp.length !== emittedWebp.length
  ) {
    invalid.push(`deduplicated WebP (${referencedWebp.length}/${emittedWebp.length})`)
  }
  resourceFiles.push(...emittedWebp)
  if (invalid.length) {
    throw new Error(`${label} output resources are not unique: ${invalid.join(', ')}`)
  }
  const emittedMedia = relativeFiles.filter((path) =>
    /\.(?:png|webp|svg|jpe?g|gif|avif)$/iu.test(path),
  )
  if (emittedMedia.length !== resourceFiles.length) {
    throw new Error(
      `${label} output emitted ${emittedMedia.length} media files instead of ${resourceFiles.length}`,
    )
  }
  return { resources: EXPECTED_RESOURCES.length, resourceFiles }
}

function isWithin(parent, child, pathApi) {
  const path = pathApi.relative(pathApi.resolve(parent), pathApi.resolve(child))
  return (
    path !== '' &&
    !path.startsWith(`..${pathApi.sep}`) &&
    path !== '..' &&
    !pathApi.isAbsolute(path)
  )
}

export function assertPackageSource({
  fixture,
  installedRealpath,
  projectRealpath,
  packedManifest,
  installedManifest,
  realpathResolver = resolve,
  pathApi = { isAbsolute, relative, resolve, sep },
}) {
  const canonicalFixture = realpathResolver(fixture)
  const canonicalInstalled = realpathResolver(installedRealpath)
  const canonicalProject = realpathResolver(projectRealpath)
  if (
    !isWithin(canonicalFixture, canonicalInstalled, pathApi) ||
    pathApi.resolve(canonicalInstalled) === pathApi.resolve(canonicalProject)
  ) {
    throw new Error('playcaptcha resolved outside its fixture')
  }
  if (
    installedManifest.name !== packedManifest.name ||
    installedManifest.version !== packedManifest.version
  ) {
    throw new Error(
      `installed unexpected package ${installedManifest.name}@${installedManifest.version}`,
    )
  }
  return { packageSource: true, installedVersion: installedManifest.version }
}

export function assertPortableReport(report, allowedAbsolutePaths = new Set()) {
  function visit(value, keyPath = []) {
    if (typeof value === 'string') {
      const dottedPath = keyPath.join('.')
      if (allowedAbsolutePaths.has(dottedPath)) return
      const filesystemAbsolute = [
        /^\//u,
        /^file:(?:\/{1,3}|[A-Za-z]:[\\/])/iu,
        /^[A-Za-z]:[\\/]/u,
        /^\\\\[^\\/]+[\\/][^\\/]+/u,
      ].some((pattern) => pattern.test(value))
      if (filesystemAbsolute) {
        throw new Error(`report contains absolute path at ${dottedPath}`)
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, [...keyPath, String(index)]))
      return
    }
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) visit(child, [...keyPath, key])
    }
  }
  visit(report)
  return report
}

export function verifyInstalledPackageSource(fixture, project, packedManifest) {
  const fixtureRealpath = realpathSync(fixture)
  const installedRealpath = realpathSync(join(fixture, 'node_modules', 'playcaptcha'))
  const installedManifest = JSON.parse(
    readFileSync(join(installedRealpath, 'package.json'), 'utf8'),
  )
  return {
    ...assertPackageSource({
      fixture: fixtureRealpath,
      installedRealpath,
      projectRealpath: realpathSync(project),
      packedManifest,
      installedManifest,
    }),
    installedRealpath,
  }
}

function containedFileUrl(label, root, htmlPath, value) {
  const normalizedValue = value.startsWith('/') && !value.startsWith('//') ? `.${value}` : value
  const baseUrl = pathToFileURL(htmlPath)
  if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname = `${dirname(baseUrl.pathname)}/`
  const url = new URL(normalizedValue, baseUrl)
  if (url.protocol !== 'file:') throw new Error(`${label} entry is not a local file URL`)
  if (url.host) throw new Error(`${label} entry is not a local file URL`)
  const entry = fileURLToPath(url)
  if (!isWithin(root, entry, { isAbsolute, relative, resolve, sep })) {
    throw new Error(
      `${label} entry resolves outside ${label.includes('native') ? 'fixture' : 'dist'}`,
    )
  }
  const canonicalRoot = realpathSync(root)
  const canonicalEntry = realpathSync(entry)
  if (!isWithin(canonicalRoot, canonicalEntry, { isAbsolute, relative, resolve, sep })) {
    throw new Error(
      `${label} entry resolves outside ${label.includes('native') ? 'fixture' : 'dist'}`,
    )
  }
  return entry
}

export function verifyComponentRegistration(framework, dist) {
  const htmlPath = join(dist, 'index.html')
  const html = readFileSync(htmlPath, 'utf8')
  const match = /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']([^"']+)["'][^>]*>/iu.exec(html)
  if (!match) throw new Error(`${framework} output has no module entry`)
  const entry = containedFileUrl(`${framework} module`, dist, htmlPath, match[1])
  const runner = fileURLToPath(new URL('verify-component-registration.mjs', import.meta.url))

  return runRegistrationCheck(runner, framework, entry, dist, htmlPath)
}

export function verifyClassicRegistration(entry, cwd, htmlPath) {
  const runner = fileURLToPath(new URL('verify-component-registration.mjs', import.meta.url))
  return runRegistrationCheck(runner, 'classic', entry, cwd, htmlPath)
}

export function verifyNativeHtml(label, htmlPath) {
  const html = readFileSync(htmlPath, 'utf8')
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/giu)]
  if (scripts.length !== 1)
    throw new Error(`${label} native HTML must contain exactly one script src`)
  const fixture = dirname(htmlPath)
  const entry = containedFileUrl(`${label} native`, fixture, htmlPath, scripts[0][1])
  const runner = fileURLToPath(new URL('verify-component-registration.mjs', import.meta.url))
  return runRegistrationCheck(runner, 'classic', entry, fixture, htmlPath)
}

function runRegistrationCheck(runner, mode, entry, cwd, htmlPath) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [runner, mode, entry, htmlPath].filter(Boolean), {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk))
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15_000)
    child.on('error', reject)
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      if (code !== 0) {
        reject(
          new Error(
            `${mode} final bundle did not register play-captcha (${signal ?? code}): ${stderr.trim()}`,
          ),
        )
        return
      }
      const report = JSON.parse(stdout)
      if (!report.componentRegistration) {
        reject(new Error(`${mode} final bundle did not register play-captcha`))
        return
      }
      if (!report.componentRendered) {
        reject(new Error(`${mode} final bundle did not render play-captcha`))
        return
      }
      resolvePromise(report)
    })
  })
}
