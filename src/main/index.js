import { app, shell, BrowserWindow, ipcMain, dialog, protocol, globalShortcut } from 'electron'
import { join, extname } from 'path'
import { createReadStream } from 'fs'
import { Readable } from 'stream'
import { readdir, readFile, writeFile, stat } from 'fs/promises'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

// Must run before the app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

const AUDIO_EXT = ['.mp3', '.flac', '.wav', '.m4a', '.ogg']

const MIME = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg'
}

async function scanFolder(dir) {
  let results = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const e of entries) {
    const full = join(dir, e.name)
    if (e.isDirectory()) results = results.concat(await scanFolder(full))
    else if (AUDIO_EXT.includes(extname(e.name).toLowerCase())) results.push(full)
  }
  return results
}

const dataFile = () => join(app.getPath('userData'), 'rhythm-data.json')

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#121212',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0b0b0b', symbolColor: '#ffffff', height: 36 },
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.electron')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Serves local music files to the player as media:// (supports seeking)
  protocol.handle('media', async (request) => {
    try {
      const filePath = decodeURIComponent(new URL(request.url).pathname.slice(1))
      const { size } = await stat(filePath)
      const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
      const range = request.headers.get('range')
      const match = range && /bytes=(\d*)-(\d*)/.exec(range)

      if (match) {
        let start = match[1] ? parseInt(match[1], 10) : 0
        let end = match[2] ? parseInt(match[2], 10) : size - 1
        if (!match[1] && match[2]) {
          // "last N bytes" form
          start = Math.max(size - parseInt(match[2], 10), 0)
          end = size - 1
        }
        end = Math.min(end, size - 1)

        if (start > end || start >= size) {
          return new Response(null, {
            status: 416,
            headers: { 'Content-Range': `bytes */${size}` }
          })
        }

        return new Response(Readable.toWeb(createReadStream(filePath, { start, end })), {
          status: 206,
          headers: {
            'Content-Type': type,
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Content-Length': String(end - start + 1),
            'Accept-Ranges': 'bytes'
          }
        })
      }

      return new Response(Readable.toWeb(createReadStream(filePath)), {
        status: 200,
        headers: {
          'Content-Type': type,
          'Content-Length': String(size),
          'Accept-Ranges': 'bytes'
        }
      })
    } catch (err) {
      console.error('media protocol error:', err)
      return new Response('Not found', { status: 404 })
    }
  })

  ipcMain.handle('dialog:openFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle('library:scan', (_, dir) => scanFolder(dir))

  ipcMain.handle('store:load', async () => {
    try {
      return JSON.parse(await readFile(dataFile(), 'utf8'))
    } catch {
      return {}
    }
  })

  ipcMain.handle('store:save', async (_, data) => {
    await writeFile(dataFile(), JSON.stringify(data))
  })

  ipcMain.handle('track:tags', async (_, filePath) => {
    try {
      const { parseFile } = await import('music-metadata')
      const m = await parseFile(filePath, { skipCovers: true })
      return {
        title: m.common.title || '',
        artist: m.common.artist || '',
        album: m.common.album || ''
      }
    } catch (err) {
      return {}
    }
  })

  ipcMain.handle('track:cover', async (_, filePath) => {
    try {
      const { parseFile } = await import('music-metadata')
      const m = await parseFile(filePath)
      const pic = m.common.picture?.[0]
      if (!pic) return null
      return `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`
    } catch (err) {
      return null
    }
  })

  createWindow()

  // Keyboard media keys -> send to the player window
  const sendMedia = (action) => {
    BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('media:key', action))
  }
  globalShortcut.register('MediaPlayPause', () => sendMedia('toggle'))
  globalShortcut.register('MediaNextTrack', () => sendMedia('next'))
  globalShortcut.register('MediaPreviousTrack', () => sendMedia('prev'))
  globalShortcut.register('MediaStop', () => sendMedia('stop'))

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})