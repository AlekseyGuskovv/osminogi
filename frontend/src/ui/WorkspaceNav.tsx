import { ThemePicker } from './Theme'
import { PrismBrand } from './PrismBrand'
import { runsUrl } from '../runs/navigation'
import { Icon } from './Icon'

export function WorkspaceNav({ workflowId, section }: { workflowId?: string; section: 'editor' | 'runs' | 'findings' | 'snapshots' | 'templates' | 'settings' }) {
  const id = workflowId ?? 'new'
  const links = [
    { key: 'editor', label: 'Конструктор', icon: 'graph', href: `?workflow=${encodeURIComponent(id)}` },
    { key: 'runs', label: 'Запуски', icon: 'runs', href: runsUrl(id) },
    { key: 'findings', label: 'Находки', icon: 'findings', href: `?view=findings&workflow=${encodeURIComponent(id)}` },
    { key: 'snapshots', label: 'Снимки', icon: 'snapshots', href: `?view=snapshots&workflow=${encodeURIComponent(id)}` },
    { key: 'templates', label: 'Шаблоны', icon: 'templates', href: `?view=templates&workflow=${encodeURIComponent(id)}` },
    { key: 'settings', label: 'Настройки', icon: 'settings', href: `?view=settings&workflow=${encodeURIComponent(id)}` },
  ] as const

  return <aside className="garden-rail">
    <a className="garden-brand" href="./"><PrismBrand variant="sidebar" /></a>
    <nav aria-label="Разделы рабочего пространства">
      {links.map(link => <a key={link.key} href={link.href} title={link.label} aria-current={section === link.key ? 'page' : undefined}>
        <Icon name={link.icon} /><span>{link.label}</span>
      </a>)}
    </nav>
    <ThemePicker />
  </aside>
}
