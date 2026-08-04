import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { build } from 'vite'
import {
  auditOutputText,
  assertPortableReport,
  EXPECTED_PACKAGE_ASSETS,
  verifyInstalledPackageSource,
  verifyNativeHtml,
  verifyResourceFiles,
} from './verify-release-artifacts.mjs'

const project = resolve(import.meta.dirname, '..')
const supportedOptions = new Set(['--skip-build', '--keep-native-fixture'])
const options = process.argv.slice(2)
for (const option of options) {
  if (!supportedOptions.has(option)) throw new Error(`Unknown option: ${option}`)
}
const skipBuild = options.includes('--skip-build')
const keepNativeFixture = options.includes('--keep-native-fixture')
const temporary = mkdtempSync(join(tmpdir(), 'playcaptcha-consumer-'))
let succeeded = false

function relay(output) {
  if (output) process.stderr.write(output)
}

function run(command, args, cwd) {
  try {
    const output = execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    relay(output)
  } catch (error) {
    relay(error.stdout)
    throw error
  }
}

function runForOutput(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    })
  } catch (error) {
    relay(error.stdout)
    throw error
  }
}

function assertConsumerReport(report, includeFixture) {
  const expectedKeys = [
    'auditedTextFiles',
    'componentRegistration',
    'componentRendered',
    'installedVersion',
    ...(includeFixture ? ['nativeFixture'] : []),
    'nativeHtml',
    'outputFiles',
    'packageSource',
    'portable',
    'resourceFiles',
    'resources',
    'scriptRelativeAssets',
    'tarball',
    'umd',
  ].sort()
  const actualKeys = Object.keys(report).sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`consumer report schema mismatch: ${actualKeys.join(', ')}`)
  }
  if (!Number.isInteger(report.auditedTextFiles) || report.auditedTextFiles < 1) {
    throw new Error('consumer report must audit at least one text file')
  }
}

try {
  if (!skipBuild) run('pnpm', ['run', 'build'], project)
  const packJson = runForOutput(
    'npm',
    ['pack', '--ignore-scripts', '--dry-run=false', '--json', '--pack-destination', temporary],
    project,
  )
  const [packed] = JSON.parse(packJson)
  const { filename } = packed
  const packedManifest = { name: packed.name, version: packed.version }
  const tarball = resolve(temporary, filename)
  writeFileSync(
    join(temporary, 'package.json'),
    '{"name":"playcaptcha-consumer","private":true,"type":"module"}',
  )
  mkdirSync(join(temporary, 'src'))
  writeFileSync(
    join(temporary, 'index.html'),
    '<div id="app"></div><script type="module" src="/src/main.js"></script>',
  )
  writeFileSync(
    join(temporary, 'src/main.js'),
    "import 'playcaptcha'; document.querySelector('#app').innerHTML = '<play-captcha target=\"duck\"></play-captcha>'",
  )
  run(
    'npm',
    ['install', '--ignore-scripts', '--dry-run=false', '--no-audit', '--no-fund', tarball],
    temporary,
  )
  const packageRoot = join(temporary, 'node_modules', 'playcaptcha')
  const packageSource = verifyInstalledPackageSource(temporary, project, packedManifest)
  const umdPath = join(packageRoot, 'dist', 'playcaptcha.umd.js')
  const expectedAssets = EXPECTED_PACKAGE_ASSETS
  for (const path of [umdPath, ...expectedAssets.map((asset) => join(packageRoot, asset))]) {
    if (!existsSync(path)) throw new Error(`tarball missing ${path}`)
  }
  const umd = readFileSync(umdPath, 'utf8')
  if (!umd.includes('../assets/') || /\bimport\.meta\b/u.test(umd)) {
    throw new Error('tarball UMD does not preserve classic-script relative asset URLs')
  }
  writeFileSync(
    join(temporary, 'native.html'),
    '<script src="./node_modules/playcaptcha/dist/playcaptcha.umd.js"></script>' +
      '<play-captcha></play-captcha><output id="result"></output>' +
      '<script>document.querySelector("play-captcha").addEventListener("verify",()=>{document.querySelector("#result").textContent="verified"})</script>',
  )
  const native = await verifyNativeHtml('consumer', join(temporary, 'native.html'))
  await build({ root: temporary, configFile: false, logLevel: 'error' })

  const assets = join(temporary, 'dist', 'assets')
  const files = readdirSync(assets)
  const resources = verifyResourceFiles('consumer', join(temporary, 'dist'))
  const portability = auditOutputText('consumer', join(temporary, 'dist'), {
    project: [project, realpathSync(project)],
    temporary: [temporary, realpathSync(temporary)],
    tarball: [tarball, realpathSync(tarball)],
    'installed package': [packageRoot, packageSource.installedRealpath],
  })
  const report = {
    tarball: filename,
    resources: resources.resources,
    resourceFiles: resources.resourceFiles,
    outputFiles: files,
    umd: true,
    nativeHtml: native.componentRegistration && native.componentRendered,
    componentRegistration: native.componentRegistration,
    componentRendered: native.componentRendered,
    scriptRelativeAssets: native.scriptRelativeAssets,
    packageSource: packageSource.packageSource,
    installedVersion: packageSource.installedVersion,
    auditedTextFiles: portability.auditedTextFiles,
    portable: portability.portable,
    ...(keepNativeFixture ? { nativeFixture: temporary } : {}),
  }
  assertConsumerReport(report, keepNativeFixture)
  assertPortableReport(report, keepNativeFixture ? new Set(['nativeFixture']) : undefined)
  console.log(JSON.stringify(report, null, 2))
  succeeded = true
} finally {
  if (!keepNativeFixture || !succeeded) rmSync(temporary, { recursive: true, force: true })
}
