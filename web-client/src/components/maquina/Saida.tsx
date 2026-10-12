import { useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { IconArrowRight, IconCarouselVertical } from "@tabler/icons-react"
import { ESPINHA_X } from "./Linha"
import { cn } from "@/lib/utils"
import { emQuanto, horaCurta, MarcaDaRede, nomeDaRede, plural, useMovimentoReduzido, type FilaT, type Maquina } from "./comum"

/**
 * Camada 3: uma fila por rede. É pra cá que cada corte pronto "voa" - o
 * alvo é o elemento com data-lane-alvo da rede (ver SalaDeMaquinas).
 */
export function Saida({
  filas,
  agora,
  ativas,
  feed,
  linkDaFila,
  titulo,
}: {
  filas: FilaT[]
  agora: number
  /** Faixas (chave) recebendo corte agora: o pulso corre só até elas. */
  ativas: Set<string>
  /** Cortes de live prontos: a faixa do Feed, pra onde eles vão. */
  feed: Maquina["feed"] | null
  linkDaFila: string
  /** Monta a camada (título + traçado + conteúdo); ver Camada em comum.tsx. */
  titulo: (conector: ReactNode, conteudo: ReactNode) => ReactNode
}) {
  const caixa = useRef<HTMLDivElement>(null)
  const [centros, setCentros] = useState<{ chave: string; x: number }[]>([])
  const [largura, setLargura] = useState(0)
  const reduzido = useMovimentoReduzido()

  const quantasFaixas = filas.length + (feed ? 1 : 0)
  // Mede onde fica cada fila pra desenhar a ramificação até o centro dela.
  useLayoutEffect(() => {
    const el = caixa.current
    if (!el) return
    const medir = () => {
      const base = el.getBoundingClientRect()
      setLargura(base.width)
      setCentros(
        [...el.querySelectorAll<HTMLElement>("[data-lane]")].map((f) => {
          const r = f.getBoundingClientRect()
          return { chave: f.dataset.lane!, x: r.left - base.left + r.width / 2 }
        })
      )
    }
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    medir()
    return () => ro.disconnect()
  }, [quantasFaixas])

  if (filas.length === 0 && !feed) {
    return titulo(<div className="h-[52px]" />,
      <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center">
        <p className="text-[13px] font-medium">Nenhuma rede conectada</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          Os cortes ficam prontos, mas sem uma rede não têm pra onde ir.{" "}
          <a href="/client/social" className="text-[var(--signal)] hover:underline">
            Conectar uma rede
          </a>
        </p>
      </div>
    )
  }

  const h = 52
  // A divisão continua a espinha: sai do mesmo x e abre até o centro de cada
  // fila. No celular as filas ficam empilhadas e o centro é o mesmo pra todas.
  const x0 = ESPINHA_X
  // Faixas empilhadas (mesmo centro) viram uma linha só - a não ser que
  // alguma delas esteja recebendo, aí o pulso precisa do caminho dela.
  const pontos = centros.filter((c, i) => centros.findIndex((o) => Math.abs(o.x - c.x) < 2) === i || ativas.has(c.chave))

  const conector = (
    <div className="relative h-[52px]" aria-hidden="true">
      {largura > 0 && (
        <svg width={largura} height={h} className="absolute inset-0 overflow-visible">
          <circle cx={x0} cy={1} r={3} fill={ativas.size > 0 ? "var(--maq-work)" : "var(--maq-trilho)"} />
          {pontos.map((c) => {
            const d = `M ${x0} 0 C ${x0} ${h * 0.55}, ${c.x} ${h * 0.45}, ${c.x} ${h}`
            const ativo = ativas.has(c.chave)
            return (
              <g key={c.chave}>
                <path d={d} fill="none" strokeWidth={2} strokeLinecap="round" stroke={ativo ? "color-mix(in oklab, var(--maq-ok) 45%, transparent)" : "var(--maq-trilho)"} />
                {ativo && !reduzido && (
                  <circle r={3.5} fill="var(--maq-ok)" style={{ filter: "drop-shadow(0 0 4px var(--maq-ok))" }}>
                    <animateMotion dur="1.9s" repeatCount="indefinite" path={d} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.3 1" />
                  </circle>
                )}
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )

  const conteudo = (
    <>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,250px),1fr))] gap-3">
        {filas.map((f) => (
          <FilaDaRede key={f.chave} f={f} agora={agora} />
        ))}
        {feed && <FaixaDoFeed feed={feed} />}
      </div>
      <div className="mt-3 flex justify-end">
        <a href={linkDaFila} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--signal)] hover:underline">
          Gerenciar filas e horários <IconArrowRight className="size-3.5" />
        </a>
      </div>
    </>
  )

  return <div ref={caixa}>{titulo(conector, conteudo)}</div>
}

function FilaDaRede({ f, agora }: { f: FilaT; agora: number }) {
  const proxima = f.proximas[0]
  const ms = proxima?.quando ? new Date(proxima.quando).getTime() - agora : null
  // Faixa de uma conta: o @ é o título (com duas contas na mesma rede, é o
  // que diferencia uma faixa da outra). Faixa de rede (admin): o nome da rede.
  const umaConta = f.chave.includes(":")
  const arroba = f.nomesDasContas[0] ? `@${f.nomesDasContas[0].replace(/^@/, "")}` : null
  const titulo = umaConta ? (arroba ?? nomeDaRede(f.rede)) : nomeDaRede(f.rede)
  const sub = umaConta
    ? nomeDaRede(f.rede)
    : f.contas === 0
      ? "conta desconectada"
      : plural(f.contas, "conta conectada", "contas conectadas")

  return (
    <article data-lane={f.chave} className="flex min-w-0 flex-col rounded-lg border border-border bg-background/50 p-3 dark:bg-muted/30">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="relative shrink-0">
            {umaConta && f.avatarUrl ? (
              <img src={f.avatarUrl} alt="" className="size-8 rounded-full object-cover" />
            ) : (
              <MarcaDaRede rede={f.rede} />
            )}
            {umaConta && f.avatarUrl && (
              <span className="absolute -right-1 -bottom-1">
                <MarcaDaRede rede={f.rede} tamanho="sm" />
              </span>
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] leading-tight font-medium" title={titulo}>{titulo}</p>
            <p className="truncate text-[11.5px] text-muted-foreground">{sub}</p>
          </div>
        </div>
        <div className="shrink-0 text-right leading-none">
          <span className="num text-[20px] font-semibold">{f.naFila}</span>
          <span className="mt-1 block text-[10.5px] text-muted-foreground">na fila</span>
        </div>
      </header>

      <div data-lane-alvo={f.chave} className="mt-3 rounded-md">
        {f.proximas.length > 0 ? (
          <ol className="-m-1 flex gap-1.5 overflow-hidden p-1">
            {f.proximas.map((p, i) => (
              <li key={p.id} className="flex w-[38px] shrink-0 flex-col items-center gap-1" title={p.titulo ?? undefined}>
                <span
                  className={cn("maq-quadro w-full", i === 0 && "ring-2 ring-[var(--signal)] ring-offset-1 ring-offset-card")}
                  data-s="ready"
                >
                  {p.capaUrl ? <img src={p.capaUrl} alt="" loading="lazy" /> : <span className="absolute inset-0 grid place-items-center opacity-60"><MarcaDaRede rede={f.rede} tamanho="sm" /></span>}
                </span>
                <span className={cn("num text-[9.5px] leading-none", i === 0 ? "font-semibold text-foreground" : "text-muted-foreground")}>
                  {p.quando ? horaCurta(p.quando) : "--:--"}
                </span>
              </li>
            ))}
            {f.naFila > f.proximas.length && (
              <li className="flex w-[38px] shrink-0 flex-col items-center gap-1">
                <span className="maq-quadro grid w-full place-items-center" data-s="pending">
                  <span className="num absolute inset-0 grid place-items-center text-[10.5px] text-muted-foreground">+{f.naFila - f.proximas.length}</span>
                </span>
              </li>
            )}
          </ol>
        ) : (
          <div className="flex h-[78px] items-center justify-center rounded-md border border-dashed border-border text-[11.5px] text-muted-foreground">
            Fila vazia
          </div>
        )}
      </div>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border/70 pt-2.5 text-[11.5px]">
        <span className="text-muted-foreground">
          {ms === null ? (
            "Nada agendado"
          ) : (
            <>
              Próxima <span className="num font-semibold text-foreground">{emQuanto(ms)}</span>
            </>
          )}
        </span>
        <span className="flex items-center gap-2.5">
          {f.publicandoAgora > 0 && (
            <span className="flex items-center gap-1 text-[var(--maq-work)]">
              <span className="maq-lampada" data-viva="true" style={{ color: "var(--maq-work)", width: 6, height: 6 }} aria-hidden="true" />
              enviando
            </span>
          )}
          <span className="text-[var(--maq-ok)]">{f.publicadosHoje} hoje</span>
        </span>
      </footer>
    </article>
  )
}

/** Onde os cortes de live esperam: no Feed, até a pessoa escolher o que postar. */
function FaixaDoFeed({ feed }: { feed: Maquina["feed"] }) {
  return (
    <article data-lane="feed" className="flex min-w-0 flex-col rounded-lg border border-border bg-background/50 p-3 dark:bg-muted/30">
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-foreground text-background">
            <IconCarouselVertical className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] leading-tight font-medium">Feed de cortes</p>
            <p className="truncate text-[11.5px] text-muted-foreground">cortes de live pra você escolher</p>
          </div>
        </div>
        <div className="shrink-0 text-right leading-none">
          <span className="num text-[20px] font-semibold">{feed.prontos}</span>
          <span className="mt-1 block text-[10.5px] text-muted-foreground">prontos</span>
        </div>
      </header>
      <div data-lane-alvo="feed" className="mt-3 rounded-md">
        {feed.ultimos.length > 0 ? (
          <ol className="-m-1 flex gap-1.5 overflow-hidden p-1">
            {feed.ultimos.map((c) => (
              <li key={c.id} className="flex w-[38px] shrink-0 flex-col items-center gap-1" title={c.titulo ?? undefined}>
                <span className="maq-quadro w-full" data-s="ready">
                  {c.capaUrl ? <img src={c.capaUrl} alt="" loading="lazy" /> : <span className="absolute inset-0 grid place-items-center text-muted-foreground/60"><IconCarouselVertical className="size-3.5" /></span>}
                </span>
                <span className="num text-[9.5px] leading-none text-muted-foreground">{horaCurta(c.prontoEm)}</span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="flex h-[78px] items-center justify-center rounded-md border border-dashed border-border text-[11.5px] text-muted-foreground">
            Nenhum corte de live ainda
          </div>
        )}
      </div>
      <footer className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-2.5 text-[11.5px]">
        <span className="text-muted-foreground">Ficam 3 dias no feed</span>
        <a href="/client/feed" className="inline-flex items-center gap-1 font-medium text-[var(--signal)] hover:underline">
          Abrir o feed <IconArrowRight className="size-3.5" />
        </a>
      </footer>
    </article>
  )
}
