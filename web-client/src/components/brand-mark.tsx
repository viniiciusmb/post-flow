import { cn } from "@/lib/utils"

/**
 * Marca do Post Flow.
 *
 * Antes era um quadrado com gradiente roxo→ciano e duas barras inclinadas.
 * Gradiente diagonal é o clichê visual mais reconhecível de produto feito às
 * pressas, e não dizia nada sobre o que o sistema faz.
 *
 * Esta versão codifica a única coisa que o produto realmente faz: pega um
 * quadro deitado (16:9, o vídeo do YouTube) e devolve um quadro em pé (9:16,
 * o corte do TikTok). O retângulo vertical atravessando é essa saída.
 *
 * Monocromática de propósito: herda `currentColor`, então funciona sobre
 * qualquer fundo, no tema claro e no escuro, e não briga com as capas de vídeo
 * coloridas que aparecem ao lado dela na interface.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("shrink-0", className)} aria-hidden="true">
      {/* quadro deitado, com um vão no meio pra barra vertical passar limpa */}
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M5.5 4.5h13A4.5 4.5 0 0 1 23 9v6a4.5 4.5 0 0 1-4.5 4.5h-13A4.5 4.5 0 0 1 1 15V9a4.5 4.5 0 0 1 4.5-4.5Zm0 2A2.5 2.5 0 0 0 3 9v6a2.5 2.5 0 0 0 2.5 2.5h13A2.5 2.5 0 0 0 21 15V9a2.5 2.5 0 0 0-2.5-2.5h-13Z"
      />
      {/* o corte vertical (9:16) atravessando o quadro */}
      <rect x="9.5" y="1.5" width="5" height="21" rx="2.5" fill="currentColor" />
    </svg>
  )
}
