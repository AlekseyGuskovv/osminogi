import diamond from '../assets/prism-diamond.png'
import signature from '../assets/prism-signature.png'
import signatureDark from '../assets/prism-signature-dark.png'
import './prism-brand.css'

const description = 'PRISM — Конструктор сценариев проверки кода'
const signatureLines = [
  { x: 0, width: 238 },
  { x: 248, width: 165 },
  { x: 424, width: 235 },
]

export function PrismBrand({ variant = 'full' }: { variant?: 'full' | 'sidebar' | 'compact' }) {
  return <span className={`prism-brand prism-brand--${variant}`} role="img" aria-label={description}>
    <img className="prism-brand-diamond" src={diamond} alt="" width={290} height={282} />
    {variant !== 'compact' && <span className="prism-brand-wordmark" aria-hidden="true" />}
    {variant === 'full' && <span className="prism-brand-signature" aria-hidden="true" />}
    {variant === 'sidebar' && <span className="prism-brand-lines" aria-hidden="true">
      {signatureLines.map(({ x, width }) => <svg key={x}
        viewBox={`${x} 0 ${width} 27`} width={width / 2} height={13.5} focusable="false">
        <image className="prism-brand-ink-light" href={signature} width={663} height={27} />
        <image className="prism-brand-ink-dark" href={signatureDark} width={663} height={27} />
      </svg>)}
    </span>}
  </span>
}
