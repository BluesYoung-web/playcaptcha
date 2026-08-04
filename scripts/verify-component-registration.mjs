import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { Window } from 'happy-dom'

const [mode, entry, htmlPath] = process.argv.slice(2)
const pageUrl = htmlPath ? pathToFileURL(htmlPath).href : 'http://localhost/'
const window = new Window({ url: pageUrl })
if (htmlPath) window.document.write(readFileSync(htmlPath, 'utf8'))

for (const key of [
  'document',
  'Document',
  'customElements',
  'HTMLElement',
  'Element',
  'Node',
  'SVGElement',
  'DocumentFragment',
  'ShadowRoot',
  'Event',
  'CustomEvent',
  'MutationObserver',
  'ResizeObserver',
  'CSSStyleSheet',
]) {
  globalThis[key] = window[key]
}
globalThis.window = window
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window)
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window)
globalThis.getComputedStyle = window.getComputedStyle.bind(window)

try {
  if (mode === 'classic') {
    const scripts = [...window.document.querySelectorAll('script[src]')]
    if (scripts.length !== 1)
      throw new Error(`expected exactly one classic script, found ${scripts.length}`)
    const script = scripts[0]
    const declaredUrl = new URL(script.getAttribute('src'), pageUrl)
    if (declaredUrl.protocol !== 'file:') {
      throw new Error(`classic script is not local: ${declaredUrl.href}`)
    }
    Object.defineProperty(window.document, 'currentScript', { configurable: true, value: script })
    window.eval(readFileSync(entry, 'utf8'))
  } else {
    await import(pathToFileURL(entry).href)
  }

  const constructor = window.customElements.get('play-captcha')
  if (!constructor) throw new Error('did not register play-captcha')

  const deadline = Date.now() + 5_000
  let element
  while (Date.now() < deadline) {
    const elements = window.document.querySelectorAll('play-captcha')
    if (elements.length === 1) {
      element = elements[0]
      if (element instanceof constructor && element.shadowRoot?.querySelector('.clawcap')) {
        break
      }
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5))
  }
  const elements = window.document.querySelectorAll('play-captcha')
  if (elements.length !== 1) {
    throw new Error(`did not render exactly one play-captcha (found ${elements.length})`)
  }
  element = elements[0]
  if (!(element instanceof constructor) || element.constructor !== constructor) {
    throw new Error('page play-captcha did not upgrade to the registered constructor')
  }
  if (!element.shadowRoot?.querySelector('.clawcap')) {
    throw new Error('page play-captcha did not render a stable .clawcap root')
  }
  const report = { componentRegistration: true, componentRendered: true }
  if (mode === 'classic') {
    const tile = element.shadowRoot.querySelector('.cc-mahjong')
    const script = window.document.querySelector('script[src]')
    const expectedAssets = new URL(
      '../assets/majiang_ui/',
      new URL(script.getAttribute('src'), pageUrl),
    ).href
    if (!tile?.src.startsWith(expectedAssets)) {
      throw new Error(`classic page resolved assets from the wrong base: ${tile?.src}`)
    }
    report.scriptRelativeAssets = true
  }
  process.stdout.write(`${JSON.stringify(report)}\n`)
} finally {
  await window.happyDOM.close()
}
