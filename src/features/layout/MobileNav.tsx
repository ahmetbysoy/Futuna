import { useApp } from '@/app/AppContext'
import { MOBILE_ITEMS } from './navigation'
import { MoreSheet } from './MoreSheet'

export function MobileNav() {
  const { activeView, setActiveView } = useApp()
  return (
    <nav className="mobile-nav" aria-label="Alt gezinme">
      {MOBILE_ITEMS.map(({ id, label, icon: Icon }) => (
        <button key={id} type="button" className={`mobile-nav__item${activeView === id ? ' is-active' : ''}`} onClick={() => setActiveView(id)} aria-current={activeView === id ? 'page' : undefined}>
          <Icon size={20} weight={activeView === id ? 'fill' : 'regular'} aria-hidden="true" />
          <span>{label}</span>
        </button>
      ))}
      <MoreSheet />
    </nav>
  )
}
