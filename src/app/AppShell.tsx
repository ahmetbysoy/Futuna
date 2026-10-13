import { lazy, Suspense, useEffect, type ComponentType } from 'react'
import { useApp } from './AppContext'
import { AppHeader } from '@/features/layout/AppHeader'
import { MobileNav } from '@/features/layout/MobileNav'
import { Sidebar } from '@/features/layout/Sidebar'
import { ToastStack } from '@/features/layout/ToastStack'
import type { ViewId } from './AppContext'

const DashboardPage = lazy(() => import('@/features/dashboard/DashboardPage').then((module) => ({ default: module.DashboardPage })))
const SignalsPage = lazy(() => import('@/features/signals/SignalsPage').then((module) => ({ default: module.SignalsPage })))
const ScannerPage = lazy(() => import('@/features/scanner/ScannerPage').then((module) => ({ default: module.ScannerPage })))
const PatternPoolPage = lazy(() => import('@/features/pattern-pool/PatternPoolPage').then((module) => ({ default: module.PatternPoolPage })))
const BacktestPage = lazy(() => import('@/features/backtest/BacktestPage').then((module) => ({ default: module.BacktestPage })))
const FavoritesPage = lazy(() => import('@/features/favorites/FavoritesPage').then((module) => ({ default: module.FavoritesPage })))
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((module) => ({ default: module.SettingsPage })))

const pages: Record<ViewId, ComponentType> = {
  dashboard: DashboardPage,
  signals: SignalsPage,
  scanner: ScannerPage,
  pool: PatternPoolPage,
  backtest: BacktestPage,
  favorites: FavoritesPage,
  settings: SettingsPage,
}

const pageTitles: Record<ViewId, string> = {
  dashboard: 'Canlı terminal',
  signals: 'Sinyal merkezi',
  scanner: 'Piyasa tarayıcı',
  pool: 'Desen havuzu',
  backtest: 'Walk-forward backtest',
  favorites: 'Favoriler',
  settings: 'Ayarlar',
}

function PageFallback() {
  return <div className="page-fallback" role="status"><span className="spinner" aria-hidden="true" /> Ekran yükleniyor…</div>
}

export function AppShell() {
  const { activeView } = useApp()
  const ActivePage = pages[activeView]
  useEffect(() => { document.title = `${pageTitles[activeView]} · Futures Scanner` }, [activeView])
  return (
    <div className="app-frame">
      <a href="#main-content" className="skip-link">Ana içeriğe atla</a>
      <Sidebar />
      <div className="app-main">
        <AppHeader />
        <main id="main-content" className="page-scroll" tabIndex={-1}>
          <Suspense fallback={<PageFallback />}><ActivePage /></Suspense>
        </main>
      </div>
      <MobileNav />
      <ToastStack />
    </div>
  )
}
