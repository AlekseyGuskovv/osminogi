import { useEffect, useRef, useState } from 'react'
import logo from '../assets/prism-logo.png'
import { Icon } from './Icon'

const themeKey = 'cyber-garden-theme'
const introKey = 'cyber-garden-prism-intro'

export function ThemePicker() {
  return <label className="garden-theme-picker">
    <span>Тема</span>
    <select defaultValue={document.documentElement.dataset.theme ?? 'dark'} onChange={event => {
      const theme = event.currentTarget.value
      document.documentElement.dataset.theme = theme
      try { localStorage.setItem(themeKey, theme) } catch { /* The current choice still applies. */ }
    }}>
      <option value="dark">Тёмная</option>
      <option value="prism-light">PRISM Light</option>
    </select>
  </label>
}

export function WorkspaceBrand() {
  return <a className="garden-brand" href="./" title="Cyber Garden">
    <span className="garden-dark-brand"><Icon name="brand" size={22} /></span>
    <b className="garden-dark-brand">Cyber<br />Garden</b>
    <span className="garden-prism-mark"><img src={logo} alt="" width="60" height="60" /></span>
    <span className="garden-prism-name"><strong>PRISM</strong><small>Cyber Garden · Центр-инвест</small></span>
  </a>
}

export function PrismIntro() {
  const [visible, setVisible] = useState(() => {
    if (document.documentElement.dataset.theme !== 'prism-light' ||
      matchMedia('(prefers-reduced-motion: reduce)').matches) return false
    try { return sessionStorage.getItem(introKey) !== 'seen' } catch { return false }
  })
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    if (!visible) return
    const element = dialog.current
    if (!element) return
    try { sessionStorage.setItem(introKey, 'seen') } catch { /* Storage can be restricted. */ }
    const motion = matchMedia('(prefers-reduced-motion: reduce)')
    const reduce = () => { if (motion.matches) setVisible(false) }
    motion.addEventListener('change', reduce)
    element.showModal()
    const timer = window.setTimeout(() => setVisible(false), 2450)
    return () => {
      motion.removeEventListener('change', reduce)
      window.clearTimeout(timer)
      element.close()
    }
  }, [visible])
  if (!visible) return null
  return <dialog ref={dialog} className="prism-intro" aria-label="Заставка PRISM" onCancel={event => {
    event.preventDefault()
    setVisible(false)
  }}>
    <div className="prism-intro-lockup"><img src={logo} alt="" /><strong>PRISM</strong></div>
    <button type="button" autoFocus onClick={() => setVisible(false)}>Пропустить</button>
  </dialog>
}
