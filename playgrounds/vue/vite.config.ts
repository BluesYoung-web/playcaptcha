import vue from '@vitejs/plugin-vue'

export default {
  plugins: [
    vue({
      template: {
        compilerOptions: {
          isCustomElement: (tag) => tag === 'play-captcha',
        },
      },
    }),
  ],
  fmt: {
    semi: false,
    singleQuote: true,
  },
}
