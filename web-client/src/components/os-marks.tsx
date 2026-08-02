/**
 * Marcas dos sistemas operacionais, em SVG.
 *
 * Antes eram os emojis 🪟 e 🍎. Emoji como logo tem três problemas: cada
 * sistema desenha o seu de um jeito (o "🪟" do Windows nem parece o logo atual
 * da Microsoft), não dá pra controlar cor nem peso, e o resultado destoa de
 * qualquer outro ícone da interface. Estes herdam `currentColor`, então
 * funcionam igual no tema claro e no escuro.
 */

export function WindowsMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      {/* Quatro painéis do logo moderno (Windows 11), levemente separados. */}
      <path d="M3 4.5 11.2 3.3v8.2H3V4.5Zm0 8.5h8.2v8.2L3 20V13Zm9.6-9.9L22 1.5v10h-9.4V3.1Zm0 9.9H22v10l-9.4-1.3V13Z" />
    </svg>
  )
}

export function AppleMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M16.36 12.72c-.02-2.3 1.88-3.4 1.96-3.46-1.07-1.56-2.73-1.78-3.32-1.8-1.41-.14-2.76.83-3.48.83-.72 0-1.83-.81-3-.79-1.55.02-2.97.9-3.77 2.28-1.6 2.79-.41 6.92 1.15 9.18.76 1.11 1.67 2.35 2.86 2.31 1.15-.05 1.58-.74 2.97-.74 1.39 0 1.78.74 3 .72 1.24-.02 2.02-1.13 2.78-2.24.87-1.29 1.23-2.54 1.25-2.6-.03-.01-2.4-.92-2.42-3.65ZM14.1 5.98c.63-.77 1.06-1.83.94-2.9-.91.04-2.01.61-2.67 1.37-.59.67-1.1 1.75-.96 2.79 1.01.08 2.05-.52 2.69-1.26Z" />
    </svg>
  )
}
