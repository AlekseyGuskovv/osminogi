import { useState } from 'react'
import { PrismIcon } from './Icon'
import { prismIcons } from './prismIcons'
import type { PrismIconName } from './prismIcons'

const sizes = [16, 20, 24, 32] as const
const names = Object.keys(prismIcons) as PrismIconName[]
const themes = [
  { id: 'prism-light', title: 'PRISM Light' },
  { id: 'dark', title: 'Cyber Garden Dark' },
] as const

export function IconGallery() {
  const [selected, setSelected] = useState<PrismIconName>('secrets')
  return <main className="prism-gallery">
    <header><h1>PRISM Line Icons</h1><a href="./">Вернуться в Cyber Garden</a></header>
    <p>Выберите иконку, чтобы сравнить активное состояние в двух темах.</p>
    <div className="prism-gallery-themes">
      {themes.map(theme => <section key={theme.id} className="prism-gallery-panel" data-icon-theme={theme.id}>
        <h2>{theme.title}</h2>
        <div className="prism-gallery-grid">
          {names.map(name => <button key={name} type="button" aria-pressed={selected === name} onClick={() => setSelected(name)}>
            <span>{sizes.map(size => <PrismIcon key={size} name={name} size={size} />)}</span>
            <code>{name}</code>
          </button>)}
        </div>
      </section>)}
    </div>
  </main>
}
