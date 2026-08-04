<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { type PlayCaptcha, type PlayCaptchaVerifyEventDetail } from 'playcaptcha'

const compact = ref(false)
const mounted = ref(true)
const result = ref('Waiting')
const captcha = ref<PlayCaptcha | null>(null)

function onVerify(event: Event) {
  const detail = (event as CustomEvent<PlayCaptchaVerifyEventDetail>).detail
  result.value = `Verified: ${detail.source}`
}

watch(captcha, (current, previous) => {
  previous?.removeEventListener('verify', onVerify)
  current?.addEventListener('verify', onVerify)
})

onBeforeUnmount(() => captcha.value?.removeEventListener('verify', onVerify))
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
      <button id="mount-toggle" type="button" @click="mounted = !mounted">
        {{ mounted ? 'Unmount captcha' : 'Mount captcha' }}
      </button>
    </div>
    <section class="demo-stage" aria-label="Captcha preview">
      <div id="captcha-shell" :class="{ 'is-compact': compact }">
        <play-captcha v-if="mounted" ref="captcha" />
      </div>
      <p id="result" aria-live="polite">{{ result }}</p>
    </section>
  </main>
</template>
