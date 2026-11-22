import { ThemePicker, WorkspaceBrand } from './Theme'
import { runsUrl } from '../runs/navigation'
import { Icon } from './Icon'

export function WorkspaceNav({ workflowId, section }: { workflowId?: string; section: 'editor' | 'runs' | 'templates' }) {
  const id = workflowId ?? 'new'
  const links = [
    { key: 'editor', label: 'Конструктор', icon: 'graph', href: `?workflow=${encodeURIComponent(id)}` },
    { key: 'runs', label: 'Запуски', icon: 'runs', href: runsUrl(id) },
    { key: 'templates', label: 'Шаблоны', icon: 'templates', href: `?view=templates&workflow=${encodeURIComponent(id)}` },
  ] as const

  return <aside className="garden-rail">
    <WorkspaceBrand />
    <nav aria-label="Разделы рабочего пространства">
      {links.map(link => <a key={link.key} href={link.href} title={link.label} aria-current={section === link.key ? 'page' : undefined}>
        <Icon name={link.icon} /><span>{link.label}</span>
      </a>)}
    </nav>
    <ThemePicker />
  </aside>
}
