import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { type PlayCaptcha, type PlayCaptchaVerifyEventDetail } from 'playcaptcha'
import 'playcaptcha'
import '../../shared/demo.css'

function App() {
  const [compact, setCompact] = useState(false)
  const [result, setResult] = useState('Waiting')
  const captchaRef = useRef<PlayCaptcha | null>(null)

  useEffect(() => {
    const captcha = captchaRef.current
    if (!captcha) return
    const onVerify = (event: Event) => {
      const detail = (event as CustomEvent<PlayCaptchaVerifyEventDetail>).detail
      setResult(`Verified: ${detail.source}`)
    }
    captcha.addEventListener('verify', onVerify)
    return () => captcha.removeEventListener('verify', onVerify)
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
        <p id="result" aria-live="polite">
          {result}
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
