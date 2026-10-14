import { afterEach, describe, expect, it, vi } from 'vitest'
import { readStorage, removeStorage, writeStorage } from './storage'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('browser storage helpers', () => {
  it('reads, writes, and removes JSON values', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value) },
        removeItem: (key: string) => { values.delete(key) },
      },
    })

    writeStorage('settings', { theme: 'dark' })
    expect(readStorage('settings', { theme: 'light' })).toEqual({ theme: 'dark' })
    removeStorage('settings')
    expect(readStorage('settings', { theme: 'light' })).toEqual({ theme: 'light' })
  })

  it('falls back and keeps the app usable when storage throws', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => { throw new Error('storage unavailable') },
        setItem: () => { throw new Error('storage quota exceeded') },
        removeItem: () => { throw new Error('storage unavailable') },
      },
    })

    expect(readStorage('settings', { alertsEnabled: false })).toEqual({ alertsEnabled: false })
    expect(() => writeStorage('settings', { alertsEnabled: true })).not.toThrow()
    expect(() => removeStorage('settings')).not.toThrow()
  })
})
