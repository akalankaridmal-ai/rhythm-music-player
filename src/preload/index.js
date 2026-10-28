import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  scanFolder: (dir) => ipcRenderer.invoke('library:scan', dir),
  loadData: () => ipcRenderer.invoke('store:load'),
  saveData: (data) => ipcRenderer.invoke('store:save', data),
  getTags: (p) => ipcRenderer.invoke('track:tags', p),
  getCover: (p) => ipcRenderer.invoke('track:cover', p),
  onMediaKey: (callback) => {
    const handler = (_, action) => callback(action)
    ipcRenderer.on('media:key', handler)
    return () => ipcRenderer.removeListener('media:key', handler)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}