import { mkdir, rm } from 'node:fs/promises'
import { build } from 'esbuild'
import { build as viteBuild } from 'vite'

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"production"' },
}

await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })

await build({
  ...shared,
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist/main/index.js',
})

await build({
  ...shared,
  entryPoints: ['src/preload/index.ts'],
  outfile: 'dist/preload/index.js',
})

await viteBuild({ configFile: 'vite.config.mts', mode: 'production' })

console.log('[anemo] build complete: dist/main, dist/preload, dist/renderer')
