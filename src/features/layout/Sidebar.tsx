import { ChartLineUp } from '@phosphor-icons/react'
import { useApp } from '@/app/AppContext'
import { NAV_ITEMS } from './navigation'

export function Sidebar() {
  const { activeView, setActiveView } = useApp()
  const groups = [...new Set(NAV_ITEMS.map((item) => item.group))]
  return (
    <aside className="sidebar">
      <a className="brand-lockup" href="#main-content" aria-label="Futures Scanner ana içeriğe git">
        <span className="brand-mark" aria-hidden="true"><ChartLineUp size={21} weight="bold" /></span>
        <span className="brand-type"><strong>Futures</strong><small>SCANNER</small></span>
      </a>
      <div className="workspace-label"><span className="workspace-label__dot" />Kişisel çalışma alanı</div>
      <nav className="side-nav" aria-label="Ana gezinme">
        {groups.map((group) => (
          <div className="side-nav__group" key={group}>
            <h2 className="side-nav__heading">{group}</h2>
            <ul>
              {NAV_ITEMS.filter((item) => item.group === group).map(({ id, label, icon: Icon }) => (
                <li key={id}>
                  <button type="button" className={`side-nav__item${activeView === id ? ' is-active' : ''}`} onClick={() => setActiveView(id)} aria-current={activeView === id ? 'page' : undefined}>
                    <Icon size={18} weight={activeView === id ? 'fill' : 'regular'} aria-hidden="true" />
                    <span>{label}</span>
                    {activeView === id && <span className="side-nav__active-mark" aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="sidebar-foot">
        <div className="sidebar-foot__rule" />
        <span className="sidebar-foot__label">PUBLIC MARKET DATA</span>
        <p>Salt-okuma modu<br />İşlem gönderimi kapalıdır.</p>
        <span className="sidebar-foot__version">Stage 5 · 0.1.0</span>
      </div>
    </aside>
  )
}
