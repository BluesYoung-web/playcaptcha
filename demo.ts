import './src/index.ts'

const captcha = document.querySelector('play-captcha')
const result = document.querySelector('#result')

captcha?.addEventListener('verify', () => {
  if (result) result.textContent = 'Verified'
})
