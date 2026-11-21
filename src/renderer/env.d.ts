import type { AnemoApi } from '../shared/ipc'

declare global {
  interface Window {
    anemo: AnemoApi
  }
}

export {}
