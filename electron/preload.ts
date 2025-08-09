import { ipcRenderer, contextBridge } from 'electron'

// --------- Expose some API to the Renderer process ---------
contextBridge.exposeInMainWorld('ipcRenderer', {
  on(...args: Parameters<typeof ipcRenderer.on>) {
    const [channel, listener] = args
    return ipcRenderer.on(channel, (event, ...args) => listener(event, ...args))
  },
  off(...args: Parameters<typeof ipcRenderer.off>) {
    const [channel, ...omit] = args
    return ipcRenderer.off(channel, ...omit)
  },
  send(...args: Parameters<typeof ipcRenderer.send>) {
    const [channel, ...omit] = args
    return ipcRenderer.send(channel, ...omit)
  },
  invoke(...args: Parameters<typeof ipcRenderer.invoke>) {
    const [channel, ...omit] = args
    return ipcRenderer.invoke(channel, ...omit)
  },

  // You can expose other APTs you need here.
  // ...
})

type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

contextBridge.exposeInMainWorld('ai', {
  chat(messages: ChatMessage[]) {
    return ipcRenderer.invoke('ai:chat', messages)
  },
  mood(note: string) {
    return ipcRenderer.invoke('ai:mood', note)
  },
  breakdown(goal: string, context?: string, type?: 'dev' | 'custom') {
    return ipcRenderer.invoke('ai:breakdown', goal, context, type)
  },
  clarify(goal: string, context?: string, note?: string, type?: 'dev' | 'custom', userProfile?: string, previousQA?: { q: string; a?: string }[]) {
    return ipcRenderer.invoke('ai:clarify', goal, context, note, type, userProfile, previousQA)
  },
})

contextBridge.exposeInMainWorld('db', {
  saveMood(payload: { note: string; mood: string; motivation: number; suggestion: string }) {
    return ipcRenderer.invoke('db:saveMood', payload)
  },
})