const prisms = ['prism-center', 'prism-upper-right', 'prism-lower-right', 'prism-upper-left'] as const

export function PrismHeroDecoration() {
  return <div className="garden-hero-prisms" aria-hidden="true">
    {prisms.map(prism => <span className={prism} key={prism}>
      <span className="prism-reflection" />
      <svg className="prism-sparkle" viewBox="0 0 24 24" focusable="false">
        <path d="M12 0 14 9 22 12 14 15 12 24 10 15 2 12 10 9Z" />
      </svg>
    </span>)}
  </div>
}
