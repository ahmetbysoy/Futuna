import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { readStorage, writeStorage } from '@/lib/storage'

export type ViewId = 'dashboard' | 'signals' | 'scanner' | 'pool' | 'backtest' | 'favorites' | 'settings'
export type ThemeMode = 'dark' | 'light'
export type ToastTone = 'neutral' | 'success' | 'warning' | 'error'

export interface AppSettings {
  showEma: boolean
  showVolume: boolean
  showFlow: boolean
  showBollinger: boolean
  showVwap: boolean
  showRsi: boolean
  showMacd: boolean
  showSar: boolean
  fastEma: number
  slowEma: number
  bbPeriod: number
  bbStd: number
  rsiPeriod: number
  macdFast: number
  macdSlow: number
  macdSignal: number
  minSignalEdge: number
  feeBps: number
  dailyLossLimit: number
  dailyLossEnabled: boolean
  alertsEnabled: boolean
  alertVolume: number
  notificationsEnabled: boolean
  vibrationEnabled: boolean
  alertOnSignal: boolean
  alertOnHighFlow: boolean
  alertOnLimit: boolean
  scannerLimit: 20 | 50
  sessionMaxMinutes: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  showEma: true,
  showVolume: true,
  showFlow: true,
  showBollinger: true,
  showVwap: true,
  showRsi: true,
  showMacd: true,
  showSar: true,
  fastEma: 9,
  slowEma: 21,
  bbPeriod: 20,
  bbStd: 2,
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  minSignalEdge: 8,
  feeBps: 5,
  dailyLossLimit: 200,
  dailyLossEnabled: false,
  alertsEnabled: false,
  alertVolume: 0.6,
  notificationsEnabled: false,
  vibrationEnabled: true,
  alertOnSignal: true,
  alertOnHighFlow: true,
  alertOnLimit: true,
  scannerLimit: 20,
  sessionMaxMinutes: 15,
}

export interface ToastMessage {
  id: number
  tone: ToastTone
  message: string
}

interface AppContextValue {
  activeView: ViewId
  theme: ThemeMode
  settings: AppSettings
  favorites: string[]
  recentSymbols: string[]
  toasts: ToastMessage[]
  setActiveView: (view: ViewId) => void
  setTheme: (theme: ThemeMode) => void
  toggleTheme: () => void
  updateSettings: (changes: Partial<AppSettings>) => void
  resetSettings: () => void
  toggleFavorite: (symbol: string) => void
  isFavorite: (symbol: string) => boolean
  addRecent: (symbol: string) => void
  showToast: (message: string, tone?: ToastTone) => void
  dismissToast: (id: number) => void
}

const AppContext = createContext<AppContextValue | null>(null)

function getInitialTheme(): ThemeMode {
  const saved = readStorage<ThemeMode | null>('fs.theme.v2', null)
  if (saved === 'light' || saved === 'dark') return saved
  if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light'
  return 'dark'
}

function getInitialSettings(): AppSettings {
  const saved = readStorage<Partial<AppSettings>>('fs.settings.v2', {})
  return { ...DEFAULT_SETTINGS, ...saved }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [activeView, setActiveView] = useState<ViewId>('dashboard')
  const [theme, setThemeState] = useState<ThemeMode>(getInitialTheme)
  const [settings, setSettings] = useState<AppSettings>(getInitialSettings)
  const [favorites, setFavorites] = useState<string[]>(() => readStorage('fs.favorites.v2', ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']))
  const [recentSymbols, setRecentSymbols] = useState<string[]>(() => readStorage('fs.recents.v2', ['BTCUSDT', 'ETHUSDT', 'SOLUSDT']))
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    writeStorage('fs.theme.v2', theme)
  }, [theme])

  useEffect(() => writeStorage('fs.settings.v2', settings), [settings])
  useEffect(() => writeStorage('fs.favorites.v2', favorites), [favorites])
  useEffect(() => writeStorage('fs.recents.v2', recentSymbols), [recentSymbols])

  const setTheme = useCallback((next: ThemeMode) => setThemeState(next), [])
  const toggleTheme = useCallback(() => setThemeState((value) => value === 'dark' ? 'light' : 'dark'), [])
  const updateSettings = useCallback((changes: Partial<AppSettings>) => {
    setSettings((current) => ({ ...current, ...changes }))
  }, [])
  const resetSettings = useCallback(() => setSettings(DEFAULT_SETTINGS), [])
  const toggleFavorite = useCallback((symbol: string) => {
    setFavorites((current) => current.includes(symbol)
      ? current.filter((item) => item !== symbol)
      : [symbol, ...current])
  }, [])
  const isFavorite = useCallback((symbol: string) => favorites.includes(symbol), [favorites])
  const addRecent = useCallback((symbol: string) => {
    setRecentSymbols((current) => [symbol, ...current.filter((item) => item !== symbol)].slice(0, 12))
  }, [])
  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])
  const showToast = useCallback((message: string, tone: ToastTone = 'neutral') => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts((current) => [...current, { id, message, tone }].slice(-4))
    window.setTimeout(() => dismissToast(id), 4_000)
  }, [dismissToast])

  const value = useMemo<AppContextValue>(() => ({
    activeView,
    theme,
    settings,
    favorites,
    recentSymbols,
    toasts,
    setActiveView,
    setTheme,
    toggleTheme,
    updateSettings,
    resetSettings,
    toggleFavorite,
    isFavorite,
    addRecent,
    showToast,
    dismissToast,
  }), [activeView, theme, settings, favorites, recentSymbols, toasts, setTheme, toggleTheme, updateSettings, resetSettings, toggleFavorite, isFavorite, addRecent, showToast, dismissToast])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
