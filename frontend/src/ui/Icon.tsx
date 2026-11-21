import type { SVGProps } from 'react'

import { prismIcons } from './prismIcons'
import type { PrismIconName } from './prismIcons'

type IconProps = Pick<SVGProps<SVGSVGElement>, 'className'> & {
  name: PrismIconName
  size?: number
}

export function PrismIcon({ name, size = 18, className }: IconProps) {
  return <svg className={className ? `prism-icon ${className}` : 'prism-icon'} width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false">
    <path d={prismIcons[name]} />
  </svg>
}

export { PrismIcon as Icon }
