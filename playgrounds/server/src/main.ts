import { type PlayCaptcha, type PlayCaptchaVerifyEventDetail } from 'playcaptcha'
import 'playcaptcha'
import '../../shared/demo.css'
import './server.css'

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing required element: ${selector}`)
  return element
}

const app = requireElement<HTMLDivElement>('#app')
app.innerHTML = `
  <main class="demo-page server-page">
    <header class="demo-header">
      <p class="demo-kicker">Non-normative Node server adapter</p>
      <h1 class="demo-title">The answer stays on the server.</h1>
      <p class="server-lede">
        The browser receives only randomized raster images and opaque candidate IDs.
        This Node + Sharp + in-memory teaching adapter is one possible v3 implementation, not a runtime requirement.
      </p>
    </header>
    <div class="demo-controls server-controls">
      <p class="server-protocol">Opaque Mahjong v3 · custom transports or built-in endpoint</p>
      <button id="new-challenge" type="button">Issue new challenge</button>
    </div>
    <section class="server-grid">
      <section class="demo-stage" aria-label="Server-backed captcha preview">
        <div id="captcha-shell"></div>
        <p id="result" class="demo-result" data-state="pending" role="status" aria-live="polite" aria-atomic="true">
          <span class="demo-result-label">Consumer event</span>
          <span class="demo-result-message">Waiting for a server verify or verification-error event.</span>
        </p>
      </section>
      <aside class="server-contract" aria-label="Protocol activity">
        <h2>Protocol activity</h2>
        <ol id="protocol-log" aria-live="polite"></ol>
        <p class="server-note">
          Teaching example: in-memory state is intentionally simple. Production needs shared storage,
          rate limiting, secure transport, and a business-bound result token.
        </p>
      </aside>
    </section>
  </main>
`

const shell = requireElement<HTMLDivElement>('#captcha-shell')
const result = requireElement<HTMLParagraphElement>('#result')
const resultMessage = requireElement<HTMLSpanElement>('.demo-result-message')
const log = requireElement<HTMLOListElement>('#protocol-log')
const newChallenge = requireElement<HTMLButtonElement>('#new-challenge')
const captcha = document.createElement('play-captcha') as PlayCaptcha
captcha.locale = 'zh-CN'
captcha.verifyEndpoint = '/api/captcha'
captcha.verificationData = JSON.stringify({ playground: 'server' })
captcha.verificationCredentials = 'same-origin'
shell.append(captcha)

function addLog(message: string): void {
  const item = document.createElement('li')
  item.textContent = message
  log.prepend(item)
  while (log.children.length > 6) log.lastElementChild?.remove()
}

captcha.addEventListener('verification-error', (event) => {
  const detail = (event as CustomEvent<{ kind: string }>).detail
  result.dataset.state = 'error'
  resultMessage.textContent = `verification-error · kind=${detail.kind}`
  addLog(`verification-error · ${detail.kind}`)
})

captcha.addEventListener('verify', (event) => {
  const detail = (event as CustomEvent<PlayCaptchaVerifyEventDetail>).detail
  result.dataset.state = 'success'
  resultMessage.textContent = `verify · source=${detail.source} · token=${detail.token ?? '(none)'}`
  addLog(`verify · source=${detail.source} · token=${detail.token ?? '(none)'}`)
})

newChallenge.addEventListener('click', () => {
  captcha.shadowRoot?.querySelector<HTMLButtonElement>('.clawcap-refresh')?.click()
  result.dataset.state = 'pending'
  resultMessage.textContent = 'Challenge refreshed; waiting for the next consumer event.'
  addLog('create · refreshed mahjong')
})

addLog('create · mode=mahjong')
