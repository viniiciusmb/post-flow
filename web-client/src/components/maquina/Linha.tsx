import type { ComponentType, ReactNode } from "react"
import { IconBrain, IconBroadcast, IconDownload, IconScissors, IconWaveSine } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { useLargura, useMovimentoReduzido, type Maquina } from "./comum"
import { FonteLives, FonteYouTube } from "./Entrada"
import { LiveCortando, LiveGravando, LiveNaEtapa, VideoNaEtapa } from "./Processamento"

/**
 * A espinha da linha de produção.
 *
 * Um traço contínuo que o trabalho percorre de cima pra baixo. As duas
 * entradas descem em paralelo, cada uma pela própria primeira etapa - o
 * YouTube baixa, a live grava -, se fundem, e daí em diante é um caminho só:
 * transcrição, seleção, corte. Cada vídeo fica pendurado na etapa em que está.
 *
 * É o desenho de um funil (tudo converge e passa pelo mesmo lugar) sem a cara
 * de funil: nenhuma forma afunilando, só linhas que se encontram.
 */

export const ESPINHA_X = 19 // centro do nó (40 px) - onde passa o traço

type Estado = "trabalhando" | "parado"

function No({ estado, Icone }: { estado: Estado; Icone: ComponentType<{ className?: string }> }) {
  return (
    <div className="maq-no size-10 shrink-0" data-estado={estado}>
      <Icone className="size-[18px]" />
    </div>
  )
}

/** Um trecho reto do traço, do cartão de cima até o nó de baixo. */
function Trecho({ ativo, altura = 20 }: { ativo: boolean; altura?: number }) {
  return (
    <div className="relative" style={{ height: altura }} aria-hidden="true">
      <span className="maq-trilho w-[2px]" data-eixo="v" data-ativo={ativo} style={{ left: ESPINHA_X, top: 0, bottom: 0 }} />
    </div>
  )
}

function Estacao({
  nome,
  descricao,
  Icone,
  n,
  saidaAtiva,
  final = false,
  className,
  children,
}: {
  nome: string
  descricao: string
  Icone: ComponentType<{ className?: string }>
  n: number
  /** O traço que sai daqui acende quando a próxima etapa está trabalhando. */
  saidaAtiva: boolean
  final?: boolean
  className?: string
  children?: ReactNode
}) {
  const estado: Estado = n > 0 ? "trabalhando" : "parado"
  return (
    <div className={cn("relative pl-[50px] sm:pl-[56px]", !final && "pb-5", className)}>
      {!final && (
        <span className="maq-trilho w-[2px]" data-eixo="v" data-ativo={saidaAtiva} style={{ left: ESPINHA_X, top: 44, bottom: 0 }} aria-hidden="true" />
      )}
      <div className="absolute top-0 left-0">
        <No estado={estado} Icone={Icone} />
      </div>
      <div className="flex min-h-10 items-center justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-[13px] leading-tight font-semibold">{nome}</h4>
          <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{descricao}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
            n > 0 ? "bg-[var(--tone-indigo-wash)] text-[var(--maq-work)]" : "bg-muted text-muted-foreground"
          )}
        >
          {n > 0 ? <><span className="num">{n}</span> agora</> : "livre"}
        </span>
      </div>
      {children && <div className="mt-2.5 flex flex-col gap-2">{children}</div>}
    </div>
  )
}

/**
 * Onde as duas colunas viram uma: o traço da esquerda desce reto, o da direita
 * curva até encontrá-lo. Medido na largura real, com a mesma folga (gap) da
 * grade das colunas.
 */
function Fusao({ esquerda, direita, gap }: { esquerda: boolean; direita: boolean; gap: number }) {
  const [ref, w] = useLargura<HTMLDivElement>()
  const reduzido = useMovimentoReduzido()
  const h = 44
  const x2 = (w + gap) / 2 + ESPINHA_X
  const ramos = [
    { chave: "e", d: `M ${ESPINHA_X} 0 L ${ESPINHA_X} ${h}`, ativo: esquerda, cor: "var(--maq-yt)" },
    { chave: "d", d: `M ${x2} 0 C ${x2} ${h * 0.62}, ${ESPINHA_X} ${h * 0.38}, ${ESPINHA_X} ${h}`, ativo: direita, cor: "var(--maq-live)" },
  ]
  return (
    <div ref={ref} className="relative" style={{ height: h }} aria-hidden="true">
      {w > 0 && (
        <svg width={w} height={h} className="absolute inset-0 overflow-visible">
          {ramos.map((r) => (
            <g key={r.chave}>
              <path d={r.d} fill="none" strokeWidth={2} strokeLinecap="round" stroke={`color-mix(in oklab, ${r.cor} ${r.ativo ? 45 : 22}%, transparent)`} />
              {r.ativo && !reduzido && (
                <circle r={3.5} fill={r.cor} style={{ filter: `drop-shadow(0 0 4px ${r.cor})` }}>
                  <animateMotion dur="1.5s" repeatCount="indefinite" path={r.d} keyPoints="0;1" keyTimes="0;1" calcMode="spline" keySplines="0.45 0 0.3 1" />
                </circle>
              )}
            </g>
          ))}
        </svg>
      )}
    </div>
  )
}

const GAP_DAS_COLUNAS = 20

export function Linha({ d, agora, celular }: { d: Maquina; agora: number; celular: boolean }) {
  const vids = d.processando
  const naEtapa = (status: string) => vids.filter((v) => v.status === status)
  const cortando = vids.filter((v) => v.status === "cutting" || v.status === "ready")
  const lives = d.aoVivo
  const livesCortando = lives.filter((l) => l.cortesProduzindo > 0)

  const n = {
    download: d.etapas.baixando,
    gravacao: lives.length,
    transcricao: d.etapas.transcrevendo + lives.length,
    selecao: d.etapas.escolhendo + lives.length,
    corte: naEtapa("cutting").length + livesCortando.length,
  }

  const download = (
    <Estacao nome="Download" descricao="Baixa o vídeo original do YouTube" Icone={IconDownload} n={n.download} saidaAtiva={n.transcricao > 0} className="flex-1">
      {naEtapa("downloading").map((v) => (
        <VideoNaEtapa key={v.id} v={v} agora={agora} />
      ))}
    </Estacao>
  )

  const gravacao = (fonteDentro: boolean) => (
    <Estacao
      nome="Gravação ao vivo"
      descricao="Grava a live em pedaços enquanto ela acontece"
      Icone={IconBroadcast}
      n={n.gravacao}
      saidaAtiva={lives.length > 0}
      className="flex-1"
    >
      {fonteDentro ? <FonteLives d={d} agora={agora} /> : null}
      {lives.map((l) => (
        <LiveGravando key={l.id} l={l} agora={agora} />
      ))}
    </Estacao>
  )

  const resto = (
    <>
      <Estacao nome="Transcrição" descricao="Transforma a fala em texto" Icone={IconWaveSine} n={n.transcricao} saidaAtiva={n.selecao > 0}>
        {naEtapa("transcribing").map((v) => (
          <VideoNaEtapa key={v.id} v={v} agora={agora} />
        ))}
        {lives.map((l) => (
          <LiveNaEtapa key={l.id} l={l} etapa="transcricao" />
        ))}
      </Estacao>
      <Estacao nome="Seleção dos cortes" descricao="A IA escolhe os melhores trechos" Icone={IconBrain} n={n.selecao} saidaAtiva={n.corte > 0}>
        {naEtapa("selecting_clips").map((v) => (
          <VideoNaEtapa key={v.id} v={v} agora={agora} />
        ))}
        {lives.map((l) => (
          <LiveNaEtapa key={l.id} l={l} etapa="selecao" />
        ))}
      </Estacao>
      <Estacao
        nome="Corte e legenda"
        descricao="Recorta em vertical, põe legenda e título"
        Icone={IconScissors}
        n={n.corte}
        saidaAtiva={cortando.length > 0 || livesCortando.length > 0}
      >
        {cortando.map((v) => (
          <VideoNaEtapa key={v.id} v={v} agora={agora} />
        ))}
        {lives.map((l) => (
          <LiveCortando key={l.id} l={l} />
        ))}
      </Estacao>
    </>
  )

  if (celular) {
    // Celular: uma coluna só. A live entra como uma etapa a mais logo depois
    // do download, com o cartão das lives dentro dela - cada trecho na cor da
    // sua origem.
    return (
      <div>
        <div className="maq-origem-yt">
          <FonteYouTube d={d} agora={agora} />
          <Trecho ativo={n.download > 0} />
          {download}
        </div>
        <div className="maq-origem-live">{gravacao(true)}</div>
        {resto}
      </div>
    )
  }

  return (
    <div>
      <div className="grid grid-cols-2" style={{ columnGap: GAP_DAS_COLUNAS }}>
        <div className="maq-origem-yt flex min-w-0 flex-col">
          <FonteYouTube d={d} agora={agora} />
          <Trecho ativo={n.download > 0} />
          {download}
        </div>
        <div className="maq-origem-live flex min-w-0 flex-col">
          <FonteLives d={d} agora={agora} />
          <Trecho ativo={lives.length > 0} />
          {gravacao(false)}
        </div>
      </div>
      <Fusao esquerda={n.transcricao - lives.length > 0 || n.download > 0} direita={lives.length > 0} gap={GAP_DAS_COLUNAS} />
      {resto}
    </div>
  )
}
