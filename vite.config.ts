import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts'],
  },
  lint: {
    ignorePatterns: ['dist/**'],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {
    semi: false,
    singleQuote: true,
  },
  pack: [
    {
      name: 'esm',
      entry: { index: 'src/index.ts' },
      format: ['esm'],
      target: 'es2018',
      dts: true,
      clean: true,
    },
    {
      name: 'umd',
      entry: { playcaptcha: 'src/umd.ts' },
      format: ['iife'],
      target: 'es2018',
      platform: 'browser',
      clean: false,
      dts: false,
      deps: {
        alwaysBundle: [/^lit(?:\/|$)/, /^lit-html(?:\/|$)/, /^@lit(?:\/|$)/],
        onlyBundle: false,
      },
      define: {
        'import.meta.url':
          '(document.currentScript && document.currentScript.src) || document.baseURI',
      },
      outputOptions: {
        entryFileNames: 'playcaptcha.umd.js',
        exports: 'none',
      },
    },
  ],
  server: {
    host: true,
  },
})
