import { createRoot } from 'react-dom/client'
import '../index.css'
import '../theme.css'
import { PrismBrand } from './PrismBrand'
import './brand-preview.css'

createRoot(document.getElementById('root')!).render(
  <main className="brand-preview">
    <h1>Логотип PRISM</h1>
    {(['prism-light', 'dark'] as const).map(theme => <section key={theme}
      className="brand-preview-panel" data-theme={theme} aria-label={theme === 'prism-light' ? 'Светлая тема' : 'Тёмная тема'}>
      <div><h2>{theme === 'prism-light' ? 'Светлая тема' : 'Тёмная тема'}</h2><PrismBrand /></div>
      <aside aria-label="Боковая панель"><PrismBrand variant="sidebar" /></aside>
    </section>)}
  </main>,
)
