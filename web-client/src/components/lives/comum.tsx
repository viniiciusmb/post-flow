import { useState } from "react"
import { IconBrandKick, IconBrandTwitch } from "@tabler/icons-react"

// Pedaços usados pelas duas telas de lives: "Lives Admin" (servidor, custos)
// e "Lives" (a que vai pros clientes).

export type Plataforma = "twitch" | "kick"

export type Nivel = { notaMinima: number; porHora: number; nome: string }

// Ícone de cada plataforma (as marcas vêm do conjunto de ícones que o painel já usa).
export function IconePlataforma({ plataforma, className }: { plataforma: Plataforma; className?: string }) {
  return plataforma === "kick" ? <IconBrandKick className={className} /> : <IconBrandTwitch className={className} />
}

// Cores da barra: da esquerda (muitos cortes, azul) pra direita (so os
// melhores, rosa/roxo). A cor do nivel escolhido pinta o resumo embaixo.
const CORES_NIVEL = ["#3b82f6", "#06b6d4", "#22c55e", "#f59e0b", "#ec4899"]

// Barra arrastavel de 1 a 5. Salva ao SOLTAR (nao a cada passo do arraste:
// arrastar do 1 ao 5 mandaria 4 salvamentos, e o mais lento podia vencer).
export function BarraDeQualidade({
  valor,
  niveis,
  onSalvar,
}: {
  valor: number
  niveis: Record<string, Nivel>
  onSalvar: (q: number) => void
}) {
  const [arrastando, setArrastando] = useState<number | null>(null)
  const atual = arrastando ?? valor
  const nivel = niveis[String(atual)]
  const cor = CORES_NIVEL[atual - 1]
  const soltar = () => {
    if (arrastando !== null && arrastando !== valor) onSalvar(arrastando)
    setArrastando(null)
  }
  return (
    <div className="flex flex-col gap-2">
      <input
        id="qualidade-cortes"
        type="range"
        min={1}
        max={5}
        step={1}
        value={atual}
        onChange={(e) => setArrastando(Number(e.target.value))}
        onPointerUp={soltar}
        onKeyUp={soltar}
        onBlur={soltar}
        aria-valuetext={nivel ? `${atual} - ${nivel.nome}` : String(atual)}
        className="h-3 w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-4 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-foreground [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-4 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-foreground [&::-webkit-slider-thumb]:shadow-md"
        style={{ background: `linear-gradient(90deg, ${CORES_NIVEL.join(", ")})` }}
      />
      <div className="flex justify-between text-xs font-medium text-muted-foreground">
        <span>← Mais cortes</span>
        <span>Mais chance de viralizar →</span>
      </div>
      {nivel && (
        <div className="flex items-center gap-2 rounded-lg border p-3 text-sm" style={{ borderColor: cor }}>
          <span className="size-3 shrink-0 rounded-full" style={{ background: cor }} />
          <span>
            <strong>{nivel.nome}</strong>
            <span className="text-muted-foreground"> · até {nivel.porHora} cortes por hora de live, só momentos com nota {nivel.notaMinima}+</span>
          </span>
        </div>
      )}
    </div>
  )
}
