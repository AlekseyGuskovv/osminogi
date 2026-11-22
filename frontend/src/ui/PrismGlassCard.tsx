import type { ComponentPropsWithoutRef } from 'react'

type GlassProps = ComponentPropsWithoutRef<'div'> & {
  as?: 'div' | 'article' | 'section'
  variant?: 'subtle' | 'elevated' | 'featured'
  accent?: 'mint' | 'violet' | 'aqua' | 'neutral'
  interactive?: boolean
}

export function PrismGlassCard({
  as: Tag = 'div', variant = 'subtle', accent = 'neutral', interactive = false, className, ...props
}: GlassProps) {
  return <Tag {...props} className={className ? `prism-glass ${className}` : 'prism-glass'}
    data-glass={variant} data-glass-accent={accent} data-glass-interactive={interactive || undefined} />
}
