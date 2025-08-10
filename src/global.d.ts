export {}

declare global {
  interface Window {
    ipcRenderer: {
      on: typeof import('electron')['ipcRenderer']['on']
      off: typeof import('electron')['ipcRenderer']['off']
      send: typeof import('electron')['ipcRenderer']['send']
      invoke: typeof import('electron')['ipcRenderer']['invoke']
    }
    ai: {
      chat(messages: { role: 'system' | 'user' | 'assistant'; content: string }[]): Promise<string>
      mood(note: string): Promise<{ mood: string; motivation: number; suggestion: string }>
      breakdown(goal: string, context?: string, type?: 'dev' | 'custom'): Promise<string[]>
      clarify(
        goal: string,
        context?: string,
        note?: string,
        type?: 'dev' | 'custom',
        userProfile?: string,
        previousQA?: { q: string; a?: string }[],
      ): Promise<string[]>
      clarifyRaw(
        goal: string,
        context?: string,
        note?: string,
        type?: 'dev' | 'custom',
        userProfile?: string,
        previousQA?: { q: string; a?: string }[],
      ): Promise<string>
    }
    db: {
      saveMood(payload: { note: string; mood: string; motivation: number; suggestion: string }): Promise<boolean>
    }
  }
}


