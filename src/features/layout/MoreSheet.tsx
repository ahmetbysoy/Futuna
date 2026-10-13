import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { DotsThree, X } from '@phosphor-icons/react'
import { useApp, type ViewId } from '@/app/AppContext'
import { MORE_ITEMS } from './navigation'

export function MoreSheet() {
  const { activeView, setActiveView } = useApp()
  const [open, setOpen] = useState(false)
  const select = (view: ViewId) => { setActiveView(view); setOpen(false) }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={`mobile-nav__item${MORE_ITEMS.some((item) => item.id === activeView) ? ' is-active' : ''}`} aria-label="Diğer ekranlar">
        <DotsThree size={21} weight="bold" aria-hidden="true" /><span>Daha</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="sheet-overlay" />
        <Dialog.Content className="more-sheet" aria-describedby="more-sheet-description">
          <div className="more-sheet__handle" aria-hidden="true" />
          <div className="more-sheet__header">
            <div><Dialog.Title>Diğer ekranlar</Dialog.Title><Dialog.Description id="more-sheet-description">Analiz ve kişisel ayarlarına geç.</Dialog.Description></div>
            <Dialog.Close className="icon-button" aria-label="Menüyü kapat"><X size={18} aria-hidden="true" /></Dialog.Close>
          </div>
          <ul className="more-sheet__list">
            {MORE_ITEMS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <button type="button" className={`more-sheet__link${activeView === id ? ' is-active' : ''}`} onClick={() => select(id)} aria-current={activeView === id ? 'page' : undefined}>
                  <Icon size={19} aria-hidden="true" /><span>{label}</span>
                </button>
              </li>
            ))}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
