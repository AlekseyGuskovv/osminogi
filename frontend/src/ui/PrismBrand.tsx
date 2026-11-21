import diamond from '../assets/prism-diamond.png'
import './prism-brand.css'

const description = 'PRISM — Конструктор сценариев проверки кода'
export function PrismBrand({ variant = 'full' }: { variant?: 'full' | 'sidebar' | 'compact' }) {
  return <span className={`prism-brand prism-brand--${variant}`} role="img" aria-label={description}>
    <img className="prism-brand-diamond" src={diamond} alt="" width={290} height={282} />
    {variant !== 'compact' && <span className="prism-brand-wordmark" aria-hidden="true" />}
    {variant === 'full' && <span className="prism-brand-signature" aria-hidden="true" />}
    {variant === 'sidebar' && <span className="prism-brand-lines" aria-hidden="true">
      <span>Конструктор сценариев</span>
      <span>проверки кода</span>
    </span>}
  </span>
}
