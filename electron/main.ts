import { app, BrowserWindow, ipcMain } from 'electron'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import dotenv from 'dotenv'
import { chatWithAssistant, assessMood, breakdownTasks, clarifyTasks } from './ai'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')
dotenv.config({ path: path.join(process.env.APP_ROOT, '.env') })

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

// IPC handlers for AI features
ipcMain.handle('ai:chat', async (_event, messages) => {
  return await chatWithAssistant(messages)
})

ipcMain.handle('ai:mood', async (_event, note: string) => {
  return await assessMood(note)
})

ipcMain.handle('ai:breakdown', async (_event, goal: string, context?: string, type?: 'dev' | 'custom') => {
  return await breakdownTasks(goal, context, type)
})

ipcMain.handle('ai:clarify', async (
  _event,
  goal: string,
  context?: string,
  note?: string,
  type?: 'dev' | 'custom',
  userProfile?: string,
  previousQA?: { q: string; a?: string }[],
) => {
  return await clarifyTasks(goal, context, note, type, userProfile, previousQA)
})

// Lightweight JSON persistence for mood updates
ipcMain.handle('db:saveMood', async (_event, payload: { note: string; mood: string; motivation: number; suggestion: string }) => {
  try {
    const userDataDir = app.getPath('userData')
    const file = path.join(userDataDir, 'mood_log.json')
    const record = { ...payload, timestamp: new Date().toISOString() }
    let current: any[] = []
    try {
      const buf = await fs.readFile(file, 'utf-8')
      current = JSON.parse(buf)
      if (!Array.isArray(current)) current = []
    } catch {
      current = []
    }
    current.push(record)
    await fs.writeFile(file, JSON.stringify(current, null, 2), 'utf-8')
    return true
  } catch (err) {
    console.error('Failed to save mood record', err)
    return false
  }
})

app.whenReady().then(createWindow)
