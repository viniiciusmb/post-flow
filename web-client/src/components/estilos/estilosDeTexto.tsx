import type { CSSProperties, ReactNode } from "react"
import { useT, type ChaveDeTraducao } from "@/i18n"
import { cn } from "@/lib/utils"
import type { VideoCaptionStyle } from "@/types/api"

// Prévia dos modelos de título e legenda, compartilhada pelo editor de estilo
// do YouTube (ClipStyleEditorCard) e pela tela de Lives.
//
// Cada modelo é DESCRITO em dados (cor, contorno, sombra, brilho, caixa), com
// os mesmos números do servidor (videoEditingService: CAPTION_STYLES e
// TITLE_STYLES), em vez de um desenho solto por modelo. Assim a prévia segue
// o vídeo de verdade, e um modelo novo entra com uma linha.
//
// Tamanhos em "em": quem desenha decide a escala (a miniatura da galeria usa
// uma fração da própria largura, via container query - texto proporcional à
// tela, como no vídeo).

type Modelo = {
  label: ChaveDeTraducao
  cor?: string
  contorno?: number // em "px do vídeo" (1080x1920), como no servidor
  corContorno?: string
  sombra?: number
  corSombra?: string
  brilho?: string // contorno colorido borrado
  caixa?: string // fundo atrás do texto
  maiusculas?: boolean
  tamanho?: number // relativo: 1 = tamanho normal
  espacado?: boolean
  especial?: "destaque" | "faixa" | "papel" | "cartao" | "nenhuma"
  destaque?: string
  letraNaCaixa?: string // cor da letra quando ela depende da caixa
}

const AMARELO = "#ffd700"
const ROSA = "#ff69b4"
const CIANO = "#00e1ff"
const VERDE = "#00e676"

// Cor da caixa escolhida pelo cliente entra por variável CSS (--cor-da-caixa).
const COR_ESCOLHIDA = "var(--cor-da-caixa, #D92323)"
const LETRA_NA_ESCOLHIDA = "var(--cor-da-letra-cartao, #fff)"

export const MODELOS: Record<VideoCaptionStyle, Modelo> = {
  classic: { label: "ce.classica", cor: "#fff", contorno: 7 },
  bold: { label: "ce.chamativa", cor: AMARELO, contorno: 8, tamanho: 1.12 },
  minimal: { label: "ce.minimalista", cor: "#fff", contorno: 3, tamanho: 0.75 },
  bubble_dark: { label: "ce.balaoEscuro", cor: "#fff", caixa: "rgba(0,0,0,.65)" },
  bubble_purple: { label: "ce.balaoRoxo", cor: "#fff", caixa: "rgba(178,110,242,.85)" },
  neon_verde: { label: "ce.neonVerde", cor: "#00ff7f", contorno: 8 },
  vermelho_forte: { label: "ce.vermelhoForte", cor: "#fff", caixa: "#d92323" },
  amarelo_caixa: { label: "ce.amareloCaixa", cor: "#000", caixa: AMARELO },
  branco_caixa: { label: "ce.brancoCaixa", cor: "#000", caixa: "#fff" },
  contorno_grosso: { label: "ce.contornoGrosso", cor: "#fff", contorno: 14, tamanho: 1.1 },
  caixa_colorida: { label: "ce.caixaColorida", cor: "#fff", caixa: COR_ESCOLHIDA },
  papel_rasgado: { label: "ce.papelRasgado", cor: "#fff", especial: "papel" },
  cartao: { label: "ce.cartao", especial: "cartao" },
  simples: { label: "ce.simples", cor: "#fff", sombra: 4, corSombra: "rgba(0,0,0,.6)" },
  sombra_dura: { label: "ce.sombraDura", cor: "#fff", sombra: 8, corSombra: "#000" },
  amarelo_fino: { label: "ce.amareloFino", cor: AMARELO, contorno: 4 },
  preto_borda_branca: { label: "ce.pretoBordaBranca", cor: "#000", contorno: 7, corContorno: "#fff" },
  espacado: { label: "ce.espacado", cor: "#fff", contorno: 2, maiusculas: true, espacado: true, tamanho: 0.8, sombra: 2, corSombra: "rgba(0,0,0,.6)" },
  brilho_rosa: { label: "ce.brilhoRosa", cor: "#fff", brilho: ROSA },
  brilho_azul: { label: "ce.brilhoAzul", cor: "#fff", brilho: CIANO },
  destaque_amarelo: { label: "ce.destaqueAmarelo", cor: "#fff", contorno: 6, maiusculas: true, especial: "destaque", destaque: AMARELO },
  destaque_verde: { label: "ce.destaqueVerde", cor: "#fff", contorno: 6, maiusculas: true, especial: "destaque", destaque: VERDE },
  faixa_preta: { label: "ce.faixaPreta", cor: "#fff", caixa: "rgba(0,0,0,.88)", especial: "faixa" },
  faixa_branca: { label: "ce.faixaBranca", cor: "#000", caixa: "#fff", especial: "faixa" },
  faixa_colorida: { label: "ce.faixaColorida", cor: LETRA_NA_ESCOLHIDA, caixa: COR_ESCOLHIDA, especial: "faixa" },
  // Só de legenda (07/10/2026).
  caixa_alta: { label: "ce.caixaAlta", cor: "#fff", contorno: 9, maiusculas: true },
  maiusculo_amarelo: { label: "ce.maiusculoAmarelo", cor: AMARELO, contorno: 9, maiusculas: true, tamanho: 1.05 },
  gigante: { label: "ce.gigante", cor: "#fff", contorno: 12, maiusculas: true, tamanho: 1.35 },
  verde_contorno: { label: "ce.verdeContorno", cor: VERDE, contorno: 9 },
  rosa_contorno: { label: "ce.rosaContorno", cor: ROSA, contorno: 9 },
  azul_contorno: { label: "ce.azulContorno", cor: "#4dc8ff", contorno: 9 },
  laranja_contorno: { label: "ce.laranjaContorno", cor: "#ff8c00", contorno: 9 },
  brilho_verde: { label: "ce.brilhoVerde", cor: "#fff", brilho: VERDE },
  roxo_caixa: { label: "ce.roxoCaixa", cor: "#fff", caixa: "#7c3fd4" },
  verde_caixa: { label: "ce.verdeCaixa", cor: "#000", caixa: VERDE },
  none: { label: "ce.semLegenda", especial: "nenhuma" },
}

// Mesma escolha do servidor (palavraDeDestaque): número primeiro, senão a
// palavra mais longa.
function indiceDoDestaque(palavras: string[]) {
  const comNumero = palavras.findIndex((p) => /\d/.test(p))
  if (comNumero >= 0) return comNumero
  let melhor = -1
  palavras.forEach((p, i) => {
    const n = p.replace(/[^\p{L}\p{N}]/gu, "").length
    if (n >= 4 && (melhor < 0 || n > palavras[melhor].replace(/[^\p{L}\p{N}]/gu, "").length)) melhor = i
  })
  return melhor
}

// O texto num modelo. Tamanho em "em" (quem chama define a escala).
export function TextoNoModelo({ modelo, texto, fonte }: { modelo: VideoCaptionStyle; texto: string; fonte?: string }) {
  const m = MODELOS[modelo] || MODELOS.classic
  if (m.especial === "nenhuma") return <span className="text-[0.7em] text-white/50">(sem legenda)</span>
  const conteudo = m.maiusculas ? texto.toLocaleUpperCase("pt-BR") : texto
  // Contorno do servidor (px num quadro de 1920 de altura, letra de ~80px)
  // convertido pra "em" da letra. O CSS pinta metade do traço pra fora com
  // paint-order, por isso o dobro.
  const traco = m.contorno ? `${((m.contorno * 2) / 80).toFixed(3)}em` : undefined
  const sombras: string[] = []
  if (m.sombra) sombras.push(`${(m.sombra / 80).toFixed(3)}em ${(m.sombra / 80).toFixed(3)}em ${m.corSombra === "#000" ? "0" : "0.06em"} ${m.corSombra}`)
  if (m.brilho) sombras.push(`0 0 0.08em ${m.brilho}`, `0 0 0.18em ${m.brilho}`, `0 0 0.32em ${m.brilho}`)
  const estilo: CSSProperties = {
    fontFamily: `${fonte ? `"${fonte}", ` : ""}Anton, "Arial Black", sans-serif`,
    color: m.cor,
    fontSize: `${m.tamanho ?? 1}em`,
    lineHeight: 1.15,
    letterSpacing: m.espacado ? "0.16em" : undefined,
    WebkitTextStroke: traco ? `${traco} ${m.corContorno ?? "#000"}` : undefined,
    paintOrder: "stroke fill",
    textShadow: sombras.length ? sombras.join(", ") : undefined,
  }
  if (m.especial === "cartao") {
    return (
      <span
        className="inline-block rounded-[0.3em] px-[0.7em] py-[0.35em] font-semibold"
        style={{
          ...estilo,
          fontFamily: `${fonte ? `"${fonte}", ` : ""}Poppins, Arial, sans-serif`,
          color: LETRA_NA_ESCOLHIDA,
          background: `linear-gradient(180deg, ${COR_ESCOLHIDA}, color-mix(in srgb, ${COR_ESCOLHIDA} 82%, #000))`,
          boxShadow: "0 0.12em 0.4em rgba(0,0,0,.35)",
        }}
      >
        {conteudo}
      </span>
    )
  }
  if (m.especial === "papel") {
    return (
      <span
        className="inline-block px-[0.8em] py-[0.45em]"
        style={{
          ...estilo,
          background: COR_ESCOLHIDA,
          clipPath:
            "polygon(0% 18%, 6% 4%, 14% 14%, 23% 2%, 33% 12%, 44% 3%, 55% 13%, 66% 2%, 77% 12%, 88% 3%, 96% 13%, 100% 6%, 100% 84%, 93% 97%, 84% 87%, 74% 98%, 63% 88%, 52% 98%, 41% 87%, 30% 97%, 19% 87%, 9% 98%, 0% 88%)",
        }}
      >
        {conteudo}
      </span>
    )
  }
  if (m.especial === "faixa") {
    return (
      <span className="block w-full px-[0.4em] py-[0.35em] text-center" style={{ ...estilo, background: m.caixa }}>
        {conteudo}
      </span>
    )
  }
  if (m.especial === "destaque") {
    const palavras = conteudo.split(" ")
    const alvo = indiceDoDestaque(palavras)
    return (
      <span style={estilo}>
        {palavras.map((p, i) => (
          <span key={i} style={i === alvo ? { color: m.destaque } : undefined}>
            {p}
            {i < palavras.length - 1 ? " " : ""}
          </span>
        ))}
      </span>
    )
  }
  if (m.caixa) {
    return (
      <span
        className="inline [box-decoration-break:clone] rounded-[0.15em] px-[0.3em] py-[0.08em]"
        style={{ ...estilo, background: m.caixa, WebkitTextStroke: undefined }}
      >
        {conteudo}
      </span>
    )
  }
  return <span style={estilo}>{conteudo}</span>
}

// Compatível com o formato antigo do editor ({ label, render }).
export const PREVIA_DE_ESTILO = Object.fromEntries(
  (Object.keys(MODELOS) as VideoCaptionStyle[]).map((k) => [
    k,
    { label: MODELOS[k].label, render: (texto: string) => <TextoNoModelo modelo={k} texto={texto} /> },
  ]),
) as Record<VideoCaptionStyle, { label: ChaveDeTraducao; render: (texto: string) => ReactNode }>

// Caixa clara pede letra escura (a mesma regra do servidor, letraPelaCaixa).
export function letraPelaCaixa(hex: string) {
  const limpo = String(hex || "").replace("#", "")
  if (!/^[0-9a-fA-F]{6}$/.test(limpo)) return "#fff"
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(limpo.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#000" : "#fff"
}

// Uma "cena" pra pôr atrás do texto: a prévia sobre fundo liso escuro engana
// (todo modelo fica bonito no preto). "live" imita o formato dos cortes de
// live - câmera do streamer em cima, o que ele assiste embaixo; "video" é um
// quadro colorido qualquer.
export function CenaDePrevia({ cena = "video", children, className, style }: { cena?: "live" | "video"; children?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={cn("relative overflow-hidden", className)} style={{ aspectRatio: "9 / 16", containerType: "inline-size", ...style }}>
      {cena === "live" ? (
        <div className="absolute inset-0 flex flex-col" aria-hidden>
          <div className="relative h-[32%] overflow-hidden bg-gradient-to-br from-[#2b1d4a] via-[#3d2a6b] to-[#1c2a52]">
            <div className="absolute bottom-0 left-1/2 h-[46%] w-[58%] -translate-x-1/2 rounded-t-[45%] bg-[#141018]" />
            <div className="absolute bottom-[38%] left-1/2 aspect-square w-[24%] -translate-x-1/2 rounded-full bg-[#c99a7c]" />
          </div>
          <div className="h-[9%] bg-[#0b0b0d]" />
          <div className="relative flex-1 overflow-hidden bg-gradient-to-b from-[#3f8f9a] via-[#c4a76a] to-[#6f5a3a]">
            <div className="absolute top-[18%] left-[12%] aspect-square w-[30%] rounded-full bg-white/25 blur-[2px]" />
            <div className="absolute right-[8%] bottom-[20%] h-[28%] w-[46%] rounded-[30%] bg-[#2d2018]/50" />
          </div>
          <div className="h-[12%] bg-[#0b0b0d]" />
        </div>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-[#3b4a6b] via-[#6b5a7a] to-[#2a2a35]" aria-hidden>
          <div className="absolute top-[22%] left-1/2 aspect-square w-[42%] -translate-x-1/2 rounded-full bg-[#c99a7c]/70 blur-[1px]" />
          <div className="absolute bottom-0 left-1/2 h-[42%] w-[80%] -translate-x-1/2 rounded-t-[40%] bg-[#1d1d25]/80" />
        </div>
      )}
      {children}
    </div>
  )
}

// Galeria de modelos: cada um numa mini tela 9:16, com o texto no lugar e no
// tamanho de verdade (proporcional à largura da miniatura).
export function GaleriaDeEstilos({
  options,
  value,
  onChange,
  sampleText,
  corDaCaixa = "#D92323",
  tipo = "legenda",
  cena = "video",
  fonte,
}: {
  options: VideoCaptionStyle[]
  value: VideoCaptionStyle
  onChange: (v: VideoCaptionStyle) => void
  sampleText: string
  corDaCaixa?: string
  tipo?: "titulo" | "legenda"
  cena?: "live" | "video"
  fonte?: string
}) {
  const t = useT()
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 xl:grid-cols-5">
      {options.map((estilo) => {
        const m = MODELOS[estilo]
        if (!m) return null
        const ativo = value === estilo
        return (
          <button
            key={estilo}
            type="button"
            onClick={() => onChange(estilo)}
            aria-pressed={ativo}
            className={cn(
              "group flex min-w-0 flex-col gap-1.5 rounded-xl p-1 text-left transition",
              ativo ? "bg-foreground/[0.06] ring-2 ring-foreground" : "hover:bg-muted",
            )}
          >
            <CenaDePrevia
              cena={cena}
              className="w-full rounded-lg"
              style={{ ["--cor-da-caixa" as string]: corDaCaixa, ["--cor-da-letra-cartao" as string]: letraPelaCaixa(corDaCaixa) }}
            >
              <div
                className="absolute inset-x-0 flex justify-center px-[6%] text-center"
                style={{
                  top: tipo === "titulo" ? (cena === "live" ? "32%" : "10%") : undefined,
                  bottom: tipo === "legenda" ? "24%" : undefined,
                  fontSize: tipo === "titulo" ? "11cqw" : "16cqw",
                }}
              >
                <TextoNoModelo modelo={estilo} texto={sampleText} fonte={fonte} />
              </div>
            </CenaDePrevia>
            <span className={cn("truncate px-0.5 text-[11px] font-medium", ativo ? "text-foreground" : "text-muted-foreground")}>
              {t(m.label)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
