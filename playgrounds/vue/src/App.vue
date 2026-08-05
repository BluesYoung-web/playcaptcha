<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { type PlayCaptcha, type PlayCaptchaVerifyEventDetail } from '@bluesyoung/playcaptcha'

type ResultState = 'pending' | 'success' | 'inactive'

const compact = ref(false)
const mounted = ref(true)
const resultState = ref<ResultState>('pending')
const result = ref('Waiting for the local verify event.')
const captcha = ref<PlayCaptcha | null>(null)

function resetResult() {
  resultState.value = mounted.value ? 'pending' : 'inactive'
  result.value = mounted.value
    ? 'Waiting for the local verify event.'
    : 'Captcha is unmounted; no verification is active.'
}

function onClick(event: Event) {
  if ((event.composedPath()[0] as Element | undefined)?.classList?.contains('clawcap-refresh')) {
    resetResult()
  }
}

function onVerify(event: Event) {
  const detail = (event as CustomEvent<PlayCaptchaVerifyEventDetail>).detail
  resultState.value = 'success'
  result.value = `verify · source=${detail.source}`
}

function toggleMounted() {
  mounted.value = !mounted.value
  resetResult()
}

watch(captcha, (current, previous) => {
  previous?.removeEventListener('click', onClick)
  previous?.removeEventListener('verify', onVerify)
  current?.addEventListener('click', onClick)
  current?.addEventListener('verify', onVerify)
})

onBeforeUnmount(() => {
  captcha.value?.removeEventListener('click', onClick)
  captcha.value?.removeEventListener('verify', onVerify)
})
</script>

<template>
  <main class="demo-page">
    <header class="demo-header">
      <p class="demo-kicker">Vue Web Component</p>
      <h1 class="demo-title">Find the winning Mahjong tile.</h1>
    </header>
    <div class="demo-controls">
      <button id="width-toggle" type="button" @click="compact = !compact">
        Use {{ compact ? '440px' : '190px' }} width
      </button>
      <button id="mount-toggle" type="button" @click="toggleMounted">
        {{ mounted ? 'Unmount captcha' : 'Mount captcha' }}
      </button>
    </div>
    <section class="demo-stage" aria-label="Captcha preview">
      <div id="captcha-shell" :class="{ 'is-compact': compact }">
        <play-captcha v-if="mounted" ref="captcha" />
      </div>
      <p
        id="result"
        class="demo-result"
        :data-state="resultState"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span class="demo-result-label">{{ mounted ? 'Consumer event' : 'Component state' }}</span>
        <span class="demo-result-message">{{ result }}</span>
      </p>
    </section>
  </main>
</template>
