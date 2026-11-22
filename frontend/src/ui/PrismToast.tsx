import { useState } from 'react'
import { Icon } from './Icon'

export type ToastMessage = { text: string; tone: 'success' | 'error' | 'warning' | 'info' }

export function PrismToast({ message, onDismiss }: { message?: ToastMessage; onDismiss: () => void }) {
  const [previous, setPrevious] = useState(message)
  if (message && message !== previous) setPrevious(message)

  return <div className="garden-notice prism-toast" data-tone={(message ?? previous)?.tone} hidden={!message}
    inert={!message}>
    <span aria-atomic="true" role={message?.tone === 'error' ? 'alert' : message ? 'status' : undefined}>{(message ?? previous)?.text}</span>
    {previous && <button type="button" aria-label="Закрыть уведомление" onClick={onDismiss}><Icon name="close" size={14} /></button>}
  </div>
}
