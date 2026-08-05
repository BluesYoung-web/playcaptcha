import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { type PlayCaptcha, type PlayCaptchaVerifyEventDetail } from 'playcaptcha'
import 'playcaptcha'
import '../../shared/demo.css'

type ResultState = { state: 'pending' | 'success'; message: string }

const waitingResult: ResultState = {
  state: 'pending',
  message: 'Waiting for the local verify event.',
}

function App() {
  const [compact, setCompact] = useState(false)
  const [result, setResult] = useState<ResultState>(waitingResult)
  const captchaRef = useRef<PlayCaptcha | null>(null)

  useEffect(() => {
    const captcha = captchaRef.current
    if (!captcha) return
    const onClick = (event: Event) => {
      if (
        (event.composedPath()[0] as Element | undefined)?.classList?.contains('clawcap-refresh')
      ) {
        setResult(waitingResult)
      }
    }
    const onVerify = (event: Event) => {
      const detail = (event as CustomEvent<PlayCaptchaVerifyEventDetail>).detail
      setResult({ state: 'success', message: `verify · source=${detail.source}` })
    }
    captcha.addEventListener('click', onClick)
    captcha.addEventListener('verify', onVerify)
    return () => {
      captcha.removeEventListener('click', onClick)
      captcha.removeEventListener('verify', onVerify)
    }
  }, [])

  return (
    <main className="demo-page">
      <header className="demo-header">
        <p className="demo-kicker">React Web Component</p>
        <h1 className="demo-title">Find the winning Mahjong tile.</h1>
      </header>
      <div className="demo-controls">
        <button id="width-toggle" type="button" onClick={() => setCompact((value) => !value)}>
          Use {compact ? '440px' : '190px'} width
        </button>
      </div>
      <section className="demo-stage" aria-label="Captcha preview">
        <div id="captcha-shell" className={compact ? 'is-compact' : undefined}>
          <play-captcha ref={captchaRef} />
        </div>
        <p
          id="result"
          className="demo-result"
          data-state={result.state}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="demo-result-label">Consumer event</span>
          <span className="demo-result-message">{result.message}</span>
        </p>
      </section>
    </main>
  )
}

const root = document.querySelector<HTMLDivElement>('#root')
if (!root) throw new Error('Missing required element: #root')
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
