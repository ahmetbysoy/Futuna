import { CheckCircle, Info, WarningCircle, X } from '@phosphor-icons/react'
import { useApp } from '@/app/AppContext'

const icons = { neutral: Info, success: CheckCircle, warning: WarningCircle, error: WarningCircle }

export function ToastStack() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="toast-stack" aria-live="polite" aria-relevant="additions text">
      {toasts.map((toast) => {
        const Icon = icons[toast.tone]
        return (
          <div className={`toast toast--${toast.tone}`} key={toast.id} role="status">
            <Icon size={17} aria-hidden="true" />
            <span>{toast.message}</span>
            <button type="button" className="toast__close" aria-label="Bildirimi kapat" onClick={() => dismissToast(toast.id)}><X size={15} aria-hidden="true" /></button>
          </div>
        )
      })}
    </div>
  )
}
