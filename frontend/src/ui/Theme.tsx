import logo from '../assets/prism-logo.png'

const themeKey = 'cyber-garden-theme'

export function ThemePicker() {
  return <label className="garden-theme-picker">
    <span>Тема</span>
    <select defaultValue={document.documentElement.dataset.theme ?? 'dark'} onChange={event => {
      const theme = event.currentTarget.value
      document.documentElement.dataset.theme = theme
      try { localStorage.setItem(themeKey, theme) } catch { /* The current choice still applies. */ }
    }}>
      <option value="dark">Тёмная</option>
      <option value="prism-light">Светлая</option>
    </select>
  </label>
}

export function WorkspaceBrand() {
  return <a className="garden-brand" href="./" title="Cyber Garden">
    <span className="garden-prism-mark"><img src={logo} alt="" width="60" height="60" /></span>
    <span className="garden-prism-name"><strong>PRISM</strong><small>Cyber Garden · Центр-инвест</small></span>
  </a>
}
