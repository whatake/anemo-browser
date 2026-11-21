import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { context } from 'esbuild'
import electronPath from 'electron'
import { createServer } from 'vite'

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
  define: { 'process.env.NODE_ENV': '"development"' },
}

let child = null
let stopping = false
let restartEnabled = false
let restartTimer = null

await mkdir('dist/main', { recursive: true })
await mkdir('dist/preload', { recursive: true })

const restartPlugin = {
  name: 'anemo-restart',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return
      scheduleRestart()
    })
  },
}

const mainContext = await context({
  ...shared,
  entryPoints: ['src/main/index.ts'],
  outfile: 'dist/main/index.js',
  plugins: [restartPlugin],
})
const preloadContext = await context({
  ...shared,
  entryPoints: ['src/preload/index.ts'],
  outfile: 'dist/preload/index.js',
  plugins: [restartPlugin],
})

// Initial builds happen while restarts are disabled, so watching the config
// cannot fire the plugin before the dev server exists.
await Promise.all([preloadContext.rebuild(), mainContext.rebuild()])
await Promise.all([mainContext.watch(), preloadContext.watch()])

const server = await createServer({ configFile: 'vite.config.mts', mode: 'development' })
await server.listen()
const devUrl = server.resolvedUrls?.local[0] ?? 'http://localhost:5173'
console.log(`[anemo] renderer: ${devUrl}`)

function launch() {
  const proc = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: { ...process.env, ANEMO_DEV_SERVER_URL: devUrl },
  })
  child = proc

  proc.on('exit', (code) => {
    // Ignore exits from an Electron instance that was replaced by a restart.
    if (child !== proc || stopping) return
    stopping = true
    void shutdown(code ?? 0)
  })
}

function scheduleRestart() {
  if (!restartEnabled || stopping) return
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restartTimer = null
    if (!restartEnabled || stopping) return

    const previous = child
    child = null
    if (!previous || previous.exitCode !== null) {
      launch()
      return
    }

    previous.once('exit', () => {
      if (!stopping && restartEnabled) launch()
    })
    previous.kill()
  }, 250)
}

async function shutdown(code) {
  stopping = true
  restartEnabled = false
  clearTimeout(restartTimer)
  if (child && child.exitCode === null) child.kill()
  await Promise.allSettled([mainContext.dispose(), preloadContext.dispose(), server.close()])
  process.exit(code)
}

process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))

restartEnabled = true
launch()
