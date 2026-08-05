import { type PlayCaptcha, type PlayCaptchaVerifyEventDetail } from 'playcaptcha'
import 'playcaptcha'
import '../../shared/demo.css'

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing required element: ${selector}`)
  return element
}

const app = requireElement<HTMLDivElement>('#app')
const page = document.createElement('main')
page.className = 'demo-page'

const header = document.createElement('header')
header.className = 'demo-header'
const kicker = document.createElement('p')
kicker.className = 'demo-kicker'
kicker.textContent = 'Vanilla Web Component'
const title = document.createElement('h1')
title.className = 'demo-title'
title.textContent = 'Find the winning Mahjong tile.'
header.append(kicker, title)

const controls = document.createElement('div')
controls.className = 'demo-controls'
const widthToggle = document.createElement('button')
widthToggle.id = 'width-toggle'
widthToggle.type = 'button'
widthToggle.textContent = 'Use 190px width'
controls.append(widthToggle)

const stage = document.createElement('section')
stage.className = 'demo-stage'
stage.setAttribute('aria-label', 'Captcha preview')
const captchaShell = document.createElement('div')
captchaShell.id = 'captcha-shell'
const captcha = document.createElement('play-captcha') as PlayCaptcha
captchaShell.append(captcha)
const result = document.createElement('p')
result.id = 'result'
result.className = 'demo-result'
result.dataset.state = 'pending'
result.setAttribute('role', 'status')
result.setAttribute('aria-live', 'polite')
result.setAttribute('aria-atomic', 'true')
const resultLabel = document.createElement('span')
resultLabel.className = 'demo-result-label'
resultLabel.textContent = 'Consumer event'
const resultMessage = document.createElement('span')
resultMessage.className = 'demo-result-message'
resultMessage.textContent = 'Waiting for the local verify event.'
result.append(resultLabel, resultMessage)
stage.append(captchaShell, result)
page.append(header, controls, stage)
app.append(page)

widthToggle.addEventListener('click', () => {
  const compact = captchaShell.classList.toggle('is-compact')
  captchaShell.style.width = compact ? '190px' : '440px'
  widthToggle.textContent = compact ? 'Use 440px width' : 'Use 190px width'
})

captcha.addEventListener('click', (event) => {
  if ((event.composedPath()[0] as Element | undefined)?.classList?.contains('clawcap-refresh')) {
    result.dataset.state = 'pending'
    resultMessage.textContent = 'Waiting for the local verify event.'
  }
})

captcha.addEventListener('verify', (event) => {
  const detail = (event as CustomEvent<PlayCaptchaVerifyEventDetail>).detail
  result.dataset.state = 'success'
  resultMessage.textContent = `verify · source=${detail.source}`
})
