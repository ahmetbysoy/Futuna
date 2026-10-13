import { ChartLineUp, Lightning, MagnifyingGlass, Brain, ChartBar, Star, GearSix } from '@phosphor-icons/react'
import type { ViewId } from '@/app/AppContext'

export const NAV_ITEMS = [
  { id: 'dashboard', label: 'Piyasa', icon: ChartLineUp, group: 'GÖZETİM' },
  { id: 'signals', label: 'Sinyaller', icon: Lightning, group: 'GÖZETİM' },
  { id: 'scanner', label: 'Tarayıcı', icon: MagnifyingGlass, group: 'ANALİZ' },
  { id: 'pool', label: 'Desen havuzu', icon: Brain, group: 'ANALİZ' },
  { id: 'backtest', label: 'Backtest', icon: ChartBar, group: 'ANALİZ' },
  { id: 'favorites', label: 'Favoriler', icon: Star, group: 'KİŞİSEL' },
  { id: 'settings', label: 'Ayarlar', icon: GearSix, group: 'KİŞİSEL' },
] satisfies Array<{ id: ViewId; label: string; icon: typeof ChartLineUp; group: string }>

export const MOBILE_ITEMS = NAV_ITEMS.filter((item) => ['dashboard', 'signals', 'scanner', 'pool'].includes(item.id))
export const MORE_ITEMS = NAV_ITEMS.filter((item) => ['backtest', 'favorites', 'settings'].includes(item.id))
