import { execFileSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import * as nativePath from 'node:path'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'
import {
  auditOutputText,
  assertPortableReport,
  filesRecursively,
  EXPECTED_PACKAGE_ASSETS,
  verifyComponentRegistration,
  verifyInstalledPackageSource,
  verifyResourceFiles,
} from './verify-release-artifacts.mjs'

const supportedOptions = new Set(['--skip-build', '--keep-fixtures'])
const project = resolve(import.meta.dirname, '..')
const frameworks = ['vanilla', 'react', 'vue', 'server']

function relay(output) {
  if (output) process.stderr.write(output)
}

function run(command, args, cwd) {
  try {
    const output = execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    relay(output)
  } catch (error) {
    relay(error.stdout)
    relay(error.stderr)
    throw error
  }
}

function packTarball(temporary) {
  let output
  try {
    output = execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--dry-run=false', '--json', '--pack-destination', temporary],
      { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
  } catch (error) {
    relay(error.stdout)
    relay(error.stderr)
    throw error
  }

  const report = JSON.parse(output)
  if (!Array.isArray(report) || report.length !== 1 || typeof report[0]?.filename !== 'string') {
    throw new Error('npm pack did not return one tarball filename')
  }
  const packed = report[0]
  const tarball = resolve(temporary, packed.filename)
  if (!existsSync(tarball)) throw new Error(`npm pack did not create ${tarball}`)
  const packedPaths = new Set(packed.files?.map((file) => file.path))
  const expectedAssets = EXPECTED_PACKAGE_ASSETS
  for (const asset of expectedAssets) {
    if (!packedPaths.has(asset)) throw new Error(`npm tarball is missing ${asset}`)
  }
  return {
    tarball,
    manifest: { name: packed.name, version: packed.version },
  }
}

export function safeFixturePath(temporary, path, pathApi = nativePath) {
  const resolved = pathApi.resolve(path)
  const relativePath = pathApi.relative(pathApi.resolve(temporary), resolved)
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${pathApi.sep}`) ||
    pathApi.isAbsolute(relativePath)
  ) {
    throw new Error(`Refusing to modify path outside fixture root: ${resolved}`)
  }
  return resolved
}

function sourceFiles(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = join(path, entry.name)
    return entry.isDirectory() ? sourceFiles(child) : [child]
  })
}

export function auditFixtureSourceText(framework, source) {
  const sourceFile = ts.createSourceFile(
    `${framework}.tsx`,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TSX,
  )
  const imports = sourceFile.statements.filter(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === 'playcaptcha',
  )
  if (!imports.some((statement) => statement.importClause)) {
    throw new Error(`${framework} fixture source does not import a playcaptcha public API`)
  }
  if (!imports.some((statement) => !statement.importClause)) {
    throw new Error(`${framework} fixture source does not side-effect import playcaptcha`)
  }
}

function auditFixtureSource(framework) {
  const sources = sourceFiles(join(project, 'playgrounds', framework, 'src')).map((path) => ({
    contents: readFileSync(path, 'utf8'),
    path,
  }))
  const executableSource = sources
    .flatMap(({ contents, path }) => {
      if (extname(path) !== '.vue') return [contents]
      return [...contents.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gu)].map(
        (match) => match[1],
      )
    })
    .join('\n')
  auditFixtureSourceText(framework, executableSource)
}

function copyFixtures(temporary, tarball, packageManager) {
  return Object.fromEntries(
    frameworks.map((framework) => {
      auditFixtureSource(framework)
      const fixture = safeFixturePath(temporary, join(temporary, framework))
      cpSync(join(project, 'playgrounds', framework), fixture, { recursive: true })
      const fixtureShared = safeFixturePath(temporary, join(fixture, 'shared'))
      cpSync(join(project, 'playgrounds', 'shared'), fixtureShared, { recursive: true })
      for (const generated of ['node_modules', 'dist']) {
        rmSync(safeFixturePath(temporary, join(fixture, generated)), {
          recursive: true,
          force: true,
        })
      }

      for (const sourcePath of sourceFiles(join(fixture, 'src'))) {
        const source = readFileSync(sourcePath, 'utf8')
        const rewritten = source.replaceAll('../../shared/demo.css', '../shared/demo.css')
        if (rewritten !== source) writeFileSync(sourcePath, rewritten)
      }

      const manifestPath = join(fixture, 'package.json')
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      manifest.dependencies.playcaptcha = `file:${tarball}`
      manifest.packageManager = packageManager
      manifest.pnpm = {
        ...manifest.pnpm,
        overrides: {
          ...manifest.pnpm?.overrides,
          vite: 'npm:@voidzero-dev/vite-plus-core@0.2.6',
          vitest: '4.1.10',
        },
      }
      writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      return [framework, fixture]
    }),
  )
}

export function verifyOutputText(framework, dist, exactPaths = {}) {
  const portability = auditOutputText(framework, dist, { project, ...exactPaths })
  for (const path of filesRecursively(dist)) {
    if (!['.html', '.js', '.css', '.map', '.json', '.svg'].includes(extname(path))) continue
    const source = readFileSync(path, 'utf8')
    const outputPath = relative(dist, path).split(sep).join('/')
    const forbidden = [
      ['workspace dependency', /workspace:\*/u],
      ['project absolute path', source.includes(project)],
      ['playground source path', /playgrounds[\\/](?:vanilla|react|vue|server)[\\/]src/u],
      [
        'bare playcaptcha import',
        /(?:\bfrom\s*["']playcaptcha["']|\bimport\s*(?:["']playcaptcha["']|\(\s*["']playcaptcha["']))/u,
      ],
    ]
    for (const [label, check] of forbidden) {
      const found = typeof check === 'boolean' ? check : check.test(source)
      if (found) throw new Error(`${framework} output contains ${label}: ${outputPath}`)
    }
  }
  return portability
}

function verifyPackageSource(framework, fixture, tarball, packedManifest) {
  const manifest = JSON.parse(readFileSync(join(fixture, 'package.json'), 'utf8'))
  if (manifest.dependencies?.playcaptcha !== `file:${tarball}`) {
    throw new Error(`${framework} fixture does not depend on the packed tarball`)
  }
  return verifyInstalledPackageSource(fixture, project, packedManifest)
}

async function verifyOutput(temporary, framework, fixture, packed) {
  const dist = safeFixturePath(temporary, join(fixture, 'dist'))
  const htmlPath = join(dist, 'index.html')
  if (!existsSync(htmlPath)) throw new Error(`${framework} build is missing dist/index.html`)
  const files = filesRecursively(dist)
  const scripts = files.filter((path) => extname(path) === '.js')
  if (scripts.length === 0) throw new Error(`${framework} build is missing JavaScript`)
  const resources = verifyResourceFiles(framework, dist)
  const installedPath = join(fixture, 'node_modules', 'playcaptcha')
  const portability = verifyOutputText(framework, dist, {
    project: [project, realpathSync(project)],
    temporary: [temporary, realpathSync(temporary)],
    fixture: [fixture, realpathSync(fixture)],
    tarball: [packed.tarball, realpathSync(packed.tarball)],
    'installed package': [installedPath, realpathSync(installedPath)],
  })
  const component = await verifyComponentRegistration(framework, dist)
  const packageSource = verifyPackageSource(framework, fixture, packed.tarball, packed.manifest)

  return {
    html: true,
    javascript: true,
    ...component,
    resources: resources.resources,
    ...portability,
    packageSource: packageSource.packageSource,
    installedVersion: packageSource.installedVersion,
  }
}

function assertPlaygroundReport(report, includeFixtures) {
  const expectedTopLevel = includeFixtures
    ? ['fixtures', 'frameworks', 'outputs']
    : ['frameworks', 'outputs']
  if (JSON.stringify(Object.keys(report).sort()) !== JSON.stringify(expectedTopLevel)) {
    throw new Error(`playground report schema mismatch: ${Object.keys(report).join(', ')}`)
  }
  const expectedOutputKeys = [
    'auditedTextFiles',
    'componentRegistration',
    'componentRendered',
    'html',
    'installedVersion',
    'javascript',
    'packageSource',
    'portable',
    'resources',
  ].sort()
  for (const framework of frameworks) {
    const output = report.outputs[framework]
    if (
      !output ||
      JSON.stringify(Object.keys(output).sort()) !== JSON.stringify(expectedOutputKeys)
    ) {
      throw new Error(`${framework} report schema mismatch`)
    }
    if (!Number.isInteger(output.auditedTextFiles) || output.auditedTextFiles < 1) {
      throw new Error(`${framework} report must audit at least one text file`)
    }
  }
}

export async function main(options = process.argv.slice(2), env = process.env) {
  for (const option of options) {
    if (!supportedOptions.has(option)) throw new Error(`Unknown option: ${option}`)
  }

  const skipBuild = options.includes('--skip-build')
  const keepFixtures = options.includes('--keep-fixtures')
  const pnpm = env.PLAYCAPTCHA_PLAYGROUNDS_PNPM || 'pnpm'
  const rootManifest = JSON.parse(readFileSync(join(project, 'package.json'), 'utf8'))
  const packageManager = rootManifest.packageManager
  const packageManagerMatch = /^pnpm@(.+)$/u.exec(packageManager)
  if (!packageManagerMatch)
    throw new Error(`Expected an exact pnpm packageManager, received ${packageManager}`)
  const expectedPnpmVersion = packageManagerMatch[1]
  const temporary = mkdtempSync(join(tmpdir(), 'playcaptcha-playgrounds-'))
  let succeeded = false

  try {
    const actualPnpmVersion = execFileSync(pnpm, ['--version'], {
      cwd: project,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    if (actualPnpmVersion !== expectedPnpmVersion) {
      throw new Error(`Expected pnpm ${expectedPnpmVersion}, received ${actualPnpmVersion}`)
    }
    if (!skipBuild) run(pnpm, ['run', 'playgrounds:build'], project)
    const packed = packTarball(temporary)
    if (!isAbsolute(packed.tarball)) throw new Error('npm pack tarball path must be absolute')
    const fixtures = copyFixtures(temporary, packed.tarball, packageManager)
    const outputs = {}

    for (const framework of frameworks) {
      const fixture = fixtures[framework]
      run(pnpm, ['install', '--ignore-scripts', '--lockfile=false'], fixture)
      run(pnpm, ['run', 'build'], fixture)
      outputs[framework] = await verifyOutput(temporary, framework, fixture, packed)
    }

    const report = {
      frameworks,
      outputs,
      ...(keepFixtures ? { fixtures } : {}),
    }
    assertPlaygroundReport(report, keepFixtures)
    assertPortableReport(
      report,
      keepFixtures ? new Set(frameworks.map((framework) => `fixtures.${framework}`)) : undefined,
    )
    console.log(JSON.stringify(report, null, 2))
    succeeded = true
  } finally {
    if (!keepFixtures || !succeeded) {
      rmSync(temporary, { recursive: true, force: true })
    } else {
      process.stderr.write(`Playground fixtures kept at ${temporary}\n`)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main()
