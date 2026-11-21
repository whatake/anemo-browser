import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BaseWindow, dialog, Menu, WebContentsView } from 'electron'
import { IPC } from '../shared/ipc'
import { LocalBridge } from './ai/LocalBridge'
import { ConfigStore } from './config/ConfigStore'
import { registerIpc } from './ipc'
import { PrivacyEngine } from './network/PrivacyEngine'
import { Database } from './storage/Database'
import { TabManager } from './tabs/TabManager'

const devServerUrl = process.env.ANEMO_DEV_SERVER_URL
const isDev = Boolean(devServerUrl)

app.setName('Anemo')
if (process.platform === 'win32') app.setAppUserModelId('com.anemo.browser')

let mainWindow: BaseWindow | null = null

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  app.whenReady().then(bootstrap).catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error)
    console.error('[anemo] fatal startup error', error)
    dialog.showErrorBox('Anemo failed to start', message)
    app.quit()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}

async function bootstrap(): Promise<void> {
  const dataDir = join(homedir(), '.anemo')
  mkdirSync(dataDir, { recursive: true })

  const db = new Database(join(dataDir, 'anemo.db'))
  const config = new ConfigStore(join(dataDir, 'config.json'))
  config.watch()

  const privacy = new PrivacyEngine(() => config.get())
  await privacy.init()
  const ai = new LocalBridge(() => config.get())

  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { role: 'viewMenu' },
        { role: 'windowMenu' },
      ]),
    )
  } else {
    Menu.setApplicationMenu(null)
  }

  const window = new BaseWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: '#070a0d',
    title: 'Anemo',
  })
  mainWindow = window

  const chromeView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: isDev,
    },
  })
  chromeView.setBackgroundColor('#070a0d')
  window.contentView.addChildView(chromeView)

  const syncChromeBounds = () => {
    const { width, height } = window.getContentBounds()
    chromeView.setBounds({ x: 0, y: 0, width: Math.max(0, width), height: Math.max(0, height) })
  }
  syncChromeBounds()
  window.on('resize', syncChromeBounds)

  const chromeFile = join(__dirname, '../renderer/index.html')
  const chromeFileUrl = pathToFileURL(chromeFile).href

  chromeView.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  chromeView.webContents.on('will-navigate', (event, url) => {
    const allowed = devServerUrl ? url.startsWith(devServerUrl) : url.startsWith(chromeFileUrl)
    if (!allowed) event.preventDefault()
  })
  chromeView.webContents.on('did-fail-load', (_event, code, description, url) => {
    if (code === -3) return
    console.error('[anemo] chrome UI failed to load', code, description, url)
  })

  const tabs = new TabManager({
    window,
    chrome: chromeView.webContents,
    db,
    privacy,
    config,
  })

  registerIpc({ db, config, tabs, privacy, ai })

  const sendToChrome = (channel: string, payload: unknown) => {
    if (!chromeView.webContents.isDestroyed()) chromeView.webContents.send(channel, payload)
  }

  tabs.onStateChanged((state) => sendToChrome(IPC.stateChanged, state))
  config.onChange((updated) => {
    privacy.syncPrivacyConfig()
    sendToChrome(IPC.configChanged, updated)
  })

  await tabs.init()

  try {
    if (devServerUrl) {
      await chromeView.webContents.loadURL(devServerUrl)
    } else {
      await chromeView.webContents.loadFile(chromeFile)
    }
  } catch (error) {
    console.error('[anemo] could not load the browser chrome', error)
  }

  window.show()
  console.log(`[anemo] ready — data: ${dataDir}`)

  if (process.env.ANEMO_SMOKE_TEST === '1') {
    setTimeout(() => {
      void (async () => {
        let failed = false
        try {
          const probe = (await chromeView.webContents.executeJavaScript(
            `({ mounted: (document.getElementById('root')?.childElementCount ?? 0) > 0, bridge: typeof window.anemo })`,
          )) as { mounted: boolean; bridge: string }
          console.log('[anemo] smoke probe', JSON.stringify(probe))
          failed = !probe.mounted || probe.bridge !== 'object'
        } catch (error) {
          console.error('[anemo] smoke probe failed', error)
          failed = true
        } finally {
          process.exitCode = failed ? 1 : 0
          app.quit()
        }
      })()
    }, 3000)
  }

  let cleanedUp = false
  app.on('will-quit', () => {
    if (cleanedUp) return
    cleanedUp = true
    tabs.dispose()
    config.dispose()
    db.close()
  })

  window.on('closed', () => {
    mainWindow = null
    tabs.dispose()
  })
}
