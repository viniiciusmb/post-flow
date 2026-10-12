import type { ReactNode } from "react"
import { IconCheck, IconPlayerPlayFilled } from "@tabler/icons-react"
import { cn } from "@/lib/utils"
import { duracaoCurta, hhmmss, MarcaDaRede, Origem, plural, useFaixas, type Maquina, type VideoNaLinhaT } from "./comum"

/**
 * O que cada etapa está fazendo, desenhado. Estas peças ficam penduradas na
 * etapa em que o vídeo (ou a live) está - ver Linha.tsx.
 */

type Live = Maquina["aoVivo"][number]
type StatusDoQuadro = "pending" | "rendering" | "ready" | "error"

const STATUS_DO_CORTE_DE_LIVE: Record<string, StatusDoQuadro> = {
  na_fila: "pending",
  renderizando: "rendering",
  pronto: "ready",
  erro: "error",
}

// ------------------------------------------------------------------ o corte sendo montado

/**
 * Um corte vertical (9:16) sendo montado: a imagem aparece de baixo pra cima
 * conforme o progresso REAL do render, com a linha de varredura e a legenda
 * sendo "digitada". `chave` é o que o voo pra fila usa pra achar o quadro.
 */
export function Quadro({
  chave,
  status,
  progresso,
  imagem,
  numero,
  titulo,
}: {
  chave: string
  status: StatusDoQuadro
  progresso: number
  imagem: string | null
  /** Posição na sequência (vídeo do YouTube). Corte de live não tem ordem: null. */
  numero: number | null
  titulo?: string | null
}) {
  const p = status === "ready" ? 100 : status === "rendering" ? Math.max(4, progresso) : 0
  return (
    <li className="flex flex-col items-center gap-1">
      <div className="maq-quadro w-full" data-s={status} data-corte={chave} style={{ ["--p" as string]: `${p}%` }} title={titulo ?? undefined}>
        {status !== "pending" && imagem && <img src={imagem} alt="" loading="lazy" />}
        {status === "ready" && !imagem && (
          <span className="absolute inset-0 grid place-items-center bg-gradient-to-b from-muted to-[var(--tone-success-wash)] text-[var(--maq-ok)]">
            <IconPlayerPlayFilled className="size-4 opacity-70" />
          </span>
        )}
        {status === "rendering" && (
          <>
            <span className="maq-scan" />
            {p > 18 && (
              <span className="maq-legenda" aria-hidden="true">
                <span style={{ ["--w" as string]: "100%" }} />
                <span style={{ ["--w" as string]: "64%" }} />
              </span>
            )}
          </>
        )}
        {status === "pending" && numero !== null && <span className="num absolute inset-0 grid place-items-center text-[11px] text-muted-foreground/70">{numero}</span>}
        {status === "ready" && (
          <span className="absolute right-1 bottom-1 grid size-4 place-items-center rounded-full bg-[var(--maq-ok)] text-white shadow">
            <IconCheck className="size-2.5" stroke={3} />
          </span>
        )}
      </div>
      <span
        className={cn(
          "num text-[10px] leading-none",
          status === "ready" ? "text-[var(--maq-ok)]" : status === "rendering" ? "text-[var(--maq-work)]" : status === "error" ? "text-destructive" : "text-muted-foreground/60"
        )}
      >
        {status === "ready" ? "pronto" : status === "rendering" ? `${p}%` : status === "error" ? "falhou" : "na vez"}
      </span>
    </li>
  )
}

export function GradeDeQuadros({ children }: { children: ReactNode }) {
  return <ol className="grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(50px,1fr))]">{children}</ol>
}

// ------------------------------------------------------------------ vídeo do YouTube

const ALTURAS_DA_ONDA = Array.from({ length: 64 }, (_, i) => 0.35 + 0.65 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6)))

export function Onda({ barras = 64, altura = "h-8" }: { barras?: number; altura?: string }) {
  return (
    <div className={cn("maq-onda flex items-center gap-[3px] overflow-hidden", altura)} aria-hidden="true">
      {ALTURAS_DA_ONDA.slice(0, barras).map((a, i) => (
        <span key={i} style={{ height: `${Math.round(a * 100)}%`, animationDelay: `${(i % 9) * 0.09}s` }} />
      ))}
    </div>
  )
}

export function Varredura() {
  return (
    <div className="relative h-2.5 rounded-full bg-muted" aria-hidden="true">
      <div className="absolute inset-y-[3px] right-2 left-2 rounded-full bg-[repeating-linear-gradient(90deg,var(--border)_0_10px,transparent_10px_14px)]" />
      <span className="maq-cursor" />
    </div>
  )
}

const MAX_QUADROS = 14
// Uma live longa gera dezenas de cortes: aqui só os mais recentes (o resto
// está no Feed). A linha do tempo da gravação continua marcando todos.
const MAX_QUADROS_LIVE = 10

function CortesDoVideo({ v }: { v: VideoNaLinhaT }) {
  const prontos = v.cortes.filter((c) => c.status === "ready").length
  const renderizando = v.cortes.find((c) => c.status === "rendering")
  const concluido = v.status === "ready"
  if (v.cortes.length === 0) return <p className="text-[11.5px] text-muted-foreground">Preparando os cortes…</p>
  return (
    <div>
      <GradeDeQuadros>
        {v.cortes.slice(0, MAX_QUADROS).map((c, i) => (
          <Quadro key={c.id} chave={`yt-${c.id}`} status={c.status} progresso={c.progresso} imagem={c.capaUrl ?? v.thumbnailUrl} numero={i + 1} titulo={c.titulo} />
        ))}
      </GradeDeQuadros>
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-[11.5px] text-muted-foreground">
        <span>
          {concluido ? (
            <span className="font-medium text-[var(--maq-ok)]">Concluído · {plural(prontos, "corte enviado", "cortes enviados")} pra fila</span>
          ) : (
            <>
              <span className="num font-semibold text-foreground">{prontos}</span> de {plural(v.cortes.length, "corte pronto", "cortes prontos")}
              {renderizando && <> · montando o corte {v.cortes.indexOf(renderizando) + 1}</>}
              {v.cortes.length > MAX_QUADROS && <> · +{v.cortes.length - MAX_QUADROS} na sequência</>}
            </>
          )}
        </span>
        <Destinos chaves={v.destinos} />
      </div>
    </div>
  )
}

/** Pra quais contas os cortes deste vídeo vão - com o @ de cada uma. */
function Destinos({ chaves }: { chaves: string[] }) {
  const faixas = useFaixas()
  if (chaves.length === 0) {
    return <span className="text-[var(--maq-hold)]">nenhuma conta ligada a este canal</span>
  }
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      vai para
      {chaves.map((chave) => {
        const f = faixas.get(chave)
        const rede = chave.split(":")[0]
        const nome = chave.includes(":") && f?.nomesDasContas[0] ? `@${f.nomesDasContas[0].replace(/^@/, "")}` : null
        return (
          <span key={chave} className="inline-flex items-center gap-1 text-foreground/80">
            <MarcaDaRede rede={rede} tamanho="sm" />
            {nome}
          </span>
        )
      })}
    </span>
  )
}

function PassosDoVideo({ v }: { v: VideoNaLinhaT }) {
  const marcos: [string, string | null, string | null][] = [
    ["Download", v.iniciadoEm, v.baixadoEm],
    ["Transcrição", v.baixadoEm, v.transcritoEm],
    ["Seleção", v.transcritoEm, v.escolhidoEm],
  ]
  const feitos = marcos.filter(([, a, b]) => a && b)
  if (feitos.length === 0) return null
  return (
    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
      {feitos.map(([nome, a, b]) => (
        <span key={nome} className="inline-flex items-center gap-1">
          <IconCheck className="size-3 text-[var(--maq-ok)]" />
          {nome} <span className="num">{duracaoCurta(new Date(b!).getTime() - new Date(a!).getTime())}</span>
        </span>
      ))}
    </p>
  )
}

/** Um vídeo do YouTube na etapa em que está. */
const ACENTO_YT = "border-l-[3px] border-l-[var(--maq-yt)]"
const ACENTO_LIVE = "border-l-[3px] border-l-[var(--maq-live)]"

export function VideoNaEtapa({ v, agora }: { v: VideoNaLinhaT; agora: number }) {
  return (
    <article className={cn("rounded-lg border border-border bg-background/50 p-2.5 sm:p-3 dark:bg-muted/30", ACENTO_YT)}>
      <div className="flex gap-3">
        <div className="relative hidden aspect-video w-[104px] shrink-0 overflow-hidden rounded-md bg-muted sm:block">
          {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" />}
          {v.duracaoSegundos ? (
            <span className="num absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[10px] text-white">{hhmmss(v.duracaoSegundos)}</span>
          ) : null}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h4 className="line-clamp-2 text-[13px] leading-snug font-medium" title={v.titulo}>
              {v.titulo}
            </h4>
            {v.iniciadoEm && v.status !== "ready" && (
              <span className="num shrink-0 pt-px text-[11px] text-muted-foreground" title="Tempo desde que entrou na linha">
                {hhmmss((agora - new Date(v.iniciadoEm).getTime()) / 1000)}
              </span>
            )}
          </div>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <Origem tipo="yt" />
            <span className="min-w-0 truncate">
              {v.cliente && <span className="font-medium text-foreground/80">{v.cliente} · </span>}
              {v.avulso ? (v.cliente ? "envio avulso" : "enviado por você") : v.canal}
            </span>
          </p>
          <PassosDoVideo v={v} />
        </div>
      </div>
      <div className="mt-3">
        {v.status === "downloading" && (
          <>
            <div className="maq-baixando h-2 overflow-hidden rounded-full" />
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
              Baixando o vídeo original{v.duracaoSegundos ? ` · ${hhmmss(v.duracaoSegundos)} de vídeo` : ""}
            </p>
          </>
        )}
        {v.status === "transcribing" && (
          <>
            <Onda />
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">Transformando a fala em texto, palavra por palavra</p>
          </>
        )}
        {v.status === "selecting_clips" && (
          <>
            <Varredura />
            <p className="mt-2 text-[11.5px] text-muted-foreground">A IA está lendo a transcrição e escolhendo os melhores trechos</p>
          </>
        )}
        {(v.status === "cutting" || v.status === "ready") && <CortesDoVideo v={v} />}
      </div>
    </article>
  )
}

// ------------------------------------------------------------------ live da Twitch

function Avatar({ l, tamanho }: { l: Live; tamanho: "g" | "p" }) {
  return (
    <div
      className={cn(
        "shrink-0 overflow-hidden rounded-full bg-muted ring-2 ring-[var(--maq-live)] ring-offset-2 ring-offset-card",
        tamanho === "g" ? "size-9 sm:size-11" : "size-7"
      )}
    >
      {l.avatarUrl ? (
        <img src={l.avatarUrl} alt="" className="size-full object-cover" />
      ) : (
        <span className={cn("grid size-full place-items-center font-semibold", tamanho === "g" ? "text-sm" : "text-[11px]")}>{l.nome.slice(0, 1).toUpperCase()}</span>
      )}
    </div>
  )
}

function Rec({ desde, agora }: { desde: string; agora: number }) {
  return (
    <span className="num flex shrink-0 items-center gap-1.5 text-[11.5px] font-medium text-[var(--maq-rec)]">
      <span className="maq-rec size-2 rounded-full bg-[var(--maq-rec)]" aria-hidden="true" />
      {hhmmss((agora - new Date(desde).getTime()) / 1000)}
    </span>
  )
}

/**
 * A linha do tempo da gravação: o que já virou texto, até onde a IA já
 * analisou, e uma marca no ponto exato de onde cada corte foi tirado. A
 * cabeça vermelha é o "agora" da live.
 */
function LinhaDoTempoDaLive({ l }: { l: Live }) {
  // O fim da barra é o que FOI gravado (não o relógio): a gravação pode ter
  // começado com atraso ou ter tido um buraco, e a barra mente se esticar.
  const gravado = Math.max(l.segundosGravados, l.segundosTranscritos, l.segundosAnalisados, 1)
  const pct = (s: number) => `${Math.min(100, Math.max(0, (s / gravado) * 100))}%`
  const transcrito = Math.max(l.segundosTranscritos, l.segundosAnalisados)
  return (
    <div>
      <div className="relative h-9" aria-label={`Gravação de ${hhmmss(gravado)}, analisada até ${hhmmss(l.segundosAnalisados)}`}>
        <div className="absolute inset-x-0 top-[13px] h-2.5 overflow-hidden rounded-full bg-muted">
          <div className="absolute inset-y-0 left-0 bg-[var(--tone-indigo-wash)] transition-[width] duration-700" style={{ width: pct(transcrito) }} />
          <div className="absolute inset-y-0 left-0 bg-[color-mix(in_oklab,var(--maq-work)_45%,transparent)] transition-[width] duration-700" style={{ width: pct(l.segundosAnalisados) }} />
        </div>
        {l.cortes.map((c) => {
          const s = STATUS_DO_CORTE_DE_LIVE[c.status] ?? "pending"
          return (
            <span
              key={c.id}
              title={c.titulo ?? undefined}
              className={cn(
                "absolute top-[7px] h-[22px] min-w-[4px] rounded-[3px] ring-2 ring-card",
                s === "ready" && "bg-[var(--maq-ok)]",
                s === "rendering" && "maq-lampada bg-[var(--maq-work)]",
                s === "pending" && "bg-[var(--maq-hold)]",
                s === "error" && "bg-destructive"
              )}
              data-viva={s === "rendering" ? "true" : undefined}
              style={{ left: pct(c.inicio), width: `max(4px, ${pct(c.fim - c.inicio)})`, color: "var(--maq-work)", borderRadius: 3, height: 22 }}
            />
          )
        })}
        <span className="absolute top-[11px] right-0 size-3.5 translate-x-1/2 rounded-full bg-[var(--maq-rec)] ring-3 ring-card" aria-hidden="true">
          <span className="maq-lampada absolute inset-0 m-auto" data-viva="true" style={{ color: "var(--maq-rec)", width: 14, height: 14, background: "transparent" }} />
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 text-[10.5px] text-muted-foreground">
        <span className="num">início</span>
        <span className="num text-[var(--maq-rec)]">agora · {hhmmss(gravado)} gravados</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[10.5px] text-muted-foreground">
        <Legenda cor="var(--tone-indigo-wash)" borda>transcrito</Legenda>
        <Legenda cor="color-mix(in oklab, var(--maq-work) 45%, transparent)">analisado pela IA</Legenda>
        <Legenda cor="var(--maq-ok)">virou corte</Legenda>
        <Legenda cor="var(--maq-work)">sendo cortado</Legenda>
      </div>
    </div>
  )
}

function Legenda({ cor, borda, children }: { cor: string; borda?: boolean; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={cn("inline-block size-2 rounded-[2px]", borda && "ring-1 ring-border")} style={{ background: cor }} />
      {children}
    </span>
  )
}

/** Etapa "Gravação ao vivo": a live inteira, com a linha do tempo. */
export function LiveGravando({ l, agora }: { l: Live; agora: number }) {
  return (
    <article className={cn("rounded-lg border border-border bg-background/50 p-2.5 sm:p-3 dark:bg-muted/30", ACENTO_LIVE)}>
      <div className="flex gap-3">
        <Avatar l={l} tamanho="g" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0">
              <h4 className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
                <Origem tipo="live" />
                <span className="truncate">
                  {l.nome} <span className="font-normal text-muted-foreground">· {l.plataforma === "kick" ? "Kick" : "Twitch"}</span>
                </span>
              </h4>
              {l.titulo && <p className="truncate text-[11.5px] text-muted-foreground">{l.titulo}</p>}
            </div>
            <Rec desde={l.gravandoDesde} agora={agora} />
          </div>
        </div>
      </div>
      <div className="mt-3">
        <LinhaDoTempoDaLive l={l} />
      </div>
      <p className="mt-2 text-[11.5px] text-muted-foreground">
        <span className="text-[var(--maq-ok)]">{plural(l.cortesProntos, "corte pronto", "cortes prontos")}</span>
        {l.cortesProduzindo > 0 && <span className="text-[var(--maq-work)]"> · {plural(l.cortesProduzindo, "sendo cortado", "sendo cortados")}</span>}
        {l.trechosEmAvaliacao > 0 && <> · {plural(l.trechosEmAvaliacao, "trecho em avaliação", "trechos em avaliação")}</>}
      </p>
    </article>
  )
}

/** A live numa etapa do meio (transcrição/seleção): uma linha só, com o que está acontecendo. */
export function LiveNaEtapa({ l, etapa }: { l: Live; etapa: "transcricao" | "selecao" }) {
  return (
    <article className={cn("flex items-center gap-3 rounded-lg border border-border bg-background/50 px-3 py-2.5 dark:bg-muted/30", ACENTO_LIVE)}>
      <Avatar l={l} tamanho="p" />
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
          <Origem tipo="live" />
          <span className="min-w-0 truncate">
          <span className="font-medium">{l.nome}</span>
          <span className="text-muted-foreground">
            {etapa === "transcricao"
              ? ` · ao vivo, já transcrito até ${hhmmss(Math.max(l.segundosTranscritos, l.segundosAnalisados))}`
              : l.trechosEmAvaliacao > 0
                ? ` · a IA está julgando ${plural(l.trechosEmAvaliacao, "trecho", "trechos")}`
                : ` · a IA já analisou até ${hhmmss(l.segundosAnalisados)}`}
          </span>
          </span>
        </p>
        <div className="mt-1.5">{etapa === "transcricao" ? <Onda barras={56} altura="h-6" /> : <Varredura />}</div>
      </div>
    </article>
  )
}

/** Etapa "Corte e legenda": os cortes desta live sendo montados. */
export function LiveCortando({ l }: { l: Live }) {
  const cortes = [...l.cortes].sort((a, b) => a.inicio - b.inicio)
  return (
    <article className={cn("rounded-lg border border-border bg-background/50 p-2.5 sm:p-3 dark:bg-muted/30", ACENTO_LIVE)}>
      <div className="flex items-center gap-2.5">
        <Avatar l={l} tamanho="p" />
        <p className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
          <Origem tipo="live" />
          <span className="min-w-0 truncate">
            <span className="font-medium">Cortes da live de {l.nome}</span>
            <span className="text-muted-foreground"> · tirados enquanto ela acontece</span>
          </span>
        </p>
      </div>
      <div className="mt-3">
        {cortes.length === 0 ? (
          <p className="text-[11.5px] text-muted-foreground">Nenhum corte ainda. A IA marca um trecho assim que acontece um bom momento.</p>
        ) : (
          <GradeDeQuadros>
            {cortes.slice(-MAX_QUADROS_LIVE).map((c) => (
              <Quadro
                key={c.id}
                chave={`live-${c.id}`}
                status={STATUS_DO_CORTE_DE_LIVE[c.status] ?? "pending"}
                progresso={c.progresso}
                imagem={c.capaUrl ?? l.avatarUrl}
                numero={null}
                titulo={c.titulo ? `${hhmmss(c.inicio)} · ${c.titulo}` : hhmmss(c.inicio)}
              />
            ))}
          </GradeDeQuadros>
        )}
      </div>
      <p className="mt-2.5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
        <span>
          <span className="num font-semibold text-foreground">{l.cortesProntos}</span> {l.cortesProntos === 1 ? "pronto" : "prontos"}
          {l.cortesProduzindo > 0 && <> · {plural(l.cortesProduzindo, "sendo montado", "sendo montados")}</>}
          {l.cortesProntos + l.cortesProduzindo > MAX_QUADROS_LIVE && <> · mostrando os {MAX_QUADROS_LIVE} mais recentes</>}
        </span>
        <span>vai para o Feed de cortes</span>
      </p>
    </article>
  )
}
