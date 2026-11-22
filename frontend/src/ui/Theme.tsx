const themeKey = 'cyber-garden-theme'

export function ThemePicker() {
  return <label className="garden-theme-picker">
    <span>Тема</span>
    <select defaultValue={document.documentElement.dataset.theme ?? 'prism-light'} onChange={event => {
      const theme = event.currentTarget.value
      document.documentElement.dataset.theme = theme
      try { localStorage.setItem(themeKey, theme) } catch { /* The current choice still applies. */ }
    }}>
      <option value="dark">Тёмная</option>
      <option value="prism-light">Светлая</option>
    </select>
  </label>
}
