import { useT, type ChaveDeTraducao } from "@/i18n"
import { useEffect, useRef, useState } from "react"
import { IconAdjustmentsHorizontal } from "@tabler/icons-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, csrfToken } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { ClientVideoSettingsResponse, PartLabelPosition, VideoCaptionStyle } from "@/types/api"

// A moldura 9:16 (o recorte final) é FIXA - nunca muda de tamanho. O que o
// cliente redimensiona é o retângulo do vídeo original (16:9) por dentro
// dela: maior = mais cortado nas bordas (preenche a moldura), menor = vídeo
// inteiro visível com sobra em cima/embaixo (preenchida com fundo desfocado
// no render de verdade).
const FRAME_WIDTH = 180
const FRAME_HEIGHT = 320
const MIN_VIDEO_HEIGHT = FRAME_WIDTH * (9 / 16) // zoom=0: largura do vídeo = largura da moldura
const MAX_VIDEO_HEIGHT = FRAME_HEIGHT // zoom=100: altura do vídeo = altura da moldura (ultrapassa a largura)
const WRAPPER_WIDTH = Math.ceil(MAX_VIDEO_HEIGHT * (16 / 9)) + 40
const FRAME_LEFT = (WRAPPER_WIDTH - FRAME_WIDTH) / 2

function videoHeightForZoom(zoom: number) {
  return MIN_VIDEO_HEIGHT + (MAX_VIDEO_HEIGHT - MIN_VIDEO_HEIGHT) * (zoom / 100)
}
function zoomForVideoHeight(height: number) {
  const z = (height - MIN_VIDEO_HEIGHT) / (MAX_VIDEO_HEIGHT - MIN_VIDEO_HEIGHT)
  return Math.round(Math.min(100, Math.max(0, z * 100)))
}

function CropZoomEditor({
  value,
  onChange,
  onCommit,
  templateUrl,
  templateHeightPercent,
  templateOffsetPercent,
  modoCapa,
  capaPosition,
}: {
  value: number
  onChange: (v: number) => void
  onCommit: (v: number) => void
  /** Imagem de fundo enviada pelo cliente. Quando existe, o vídeo é composto
      por cima dela e o editor precisa mostrar exatamente isso, senão a pessoa
      posiciona no escuro e só descobre o resultado depois de renderizar. */
  templateUrl?: string | null
  templateHeightPercent?: number
  templateOffsetPercent?: number
  /** Estilo "capa do vídeo": a capa vira uma faixa colada ao vídeo. Aqui não
      há imagem pra mostrar (ela muda a cada vídeo), então a prévia desenha a
      faixa como um bloco — o que importa é ver o ENCAIXE e de que lado ela
      fica. Sem isso, escolher a capa não mudava nada na prévia e a pessoa
      posicionava no escuro. */
  modoCapa?: boolean
  capaPosition?: "top" | "bottom"
}) {
  const t = useT()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const comCapa = Boolean(modoCapa)
  // A imagem enviada só entra quando NÃO é o modo capa (são estilos distintos).
  const comTemplate = Boolean(templateUrl) && !comCapa
  // Com template, quem manda na altura do vídeo é o controle de altura, não o
  // zoom: o zoom passa a controlar só o quanto se corta das laterais.
  const alturaEmPercent = Math.max(10, Math.min(100, templateHeightPercent ?? 70))
  const videoHeight = comTemplate || comCapa
    ? (FRAME_HEIGHT * alturaEmPercent) / 100
    : videoHeightForZoom(value)
  const videoWidth = comTemplate || comCapa ? FRAME_WIDTH : videoHeight * (16 / 9)
  const videoLeftInFrame = (FRAME_WIDTH - videoWidth) / 2
  // No modo capa a posição não é livre: o vídeo encosta no lado oposto ao da
  // faixa, sem sobra entre os dois (é o que o corte faz de verdade).
  const videoTop = comCapa
    ? (capaPosition === 'bottom' ? 0 : FRAME_HEIGHT - videoHeight)
    : comTemplate
      ? ((FRAME_HEIGHT - videoHeight) * Math.max(0, Math.min(100, templateOffsetPercent ?? 50))) / 100
      : (FRAME_HEIGHT - videoHeight) / 2
  const alturaDaCapa = FRAME_HEIGHT - videoHeight

  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault()
    setDragging(true)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging || !wrapperRef.current) return
    const rect = wrapperRef.current.getBoundingClientRect()
    const frameCenterX = rect.left + FRAME_LEFT + FRAME_WIDTH / 2
    const halfWidth = Math.abs(e.clientX - frameCenterX)
    const maxVideoWidth = MAX_VIDEO_HEIGHT * (16 / 9)
    const newWidth = Math.min(maxVideoWidth, Math.max(FRAME_WIDTH, halfWidth * 2))
    const newHeight = newWidth * (9 / 16)
    onChange(zoomForVideoHeight(newHeight))
  }

  function handlePointerUp() {
    if (!dragging) return
    setDragging(false)
    onCommit(value)
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={wrapperRef} className="relative select-none" style={{ width: WRAPPER_WIDTH, height: FRAME_HEIGHT }}>
        {/* moldura 9:16 fixa - isso e o resultado final, nunca muda de tamanho */}
        <div
          className="absolute overflow-hidden rounded-md border-2 border-white bg-black bg-cover bg-center"
          style={{
            left: FRAME_LEFT,
            width: FRAME_WIDTH,
            height: FRAME_HEIGHT,
            ...(templateUrl ? { backgroundImage: `url(${templateUrl})` } : {}),
          }}
        >
          {/* Faixa da capa: encostada na borda oposta ao vídeo. As duas somam
              exatamente a altura da moldura, igual ao corte final. */}
          {comCapa && alturaDaCapa > 0 && (
            <div
              className="absolute flex items-center justify-center bg-gradient-to-br from-amber-300 to-rose-300 text-center text-[10px] font-medium text-black/70"
              style={{
                width: FRAME_WIDTH,
                height: alturaDaCapa,
                left: 0,
                top: capaPosition === 'bottom' ? videoHeight : 0,
              }}
            >
              {t("ce.capaDoVideo")}
            </div>
          )}
          <div
            className="absolute flex items-center justify-center bg-neutral-700/95 text-center text-[10px] text-white/70"
            style={{ width: videoWidth, height: videoHeight, left: videoLeftInFrame, top: videoTop }}
          >
            {comTemplate || comCapa ? t("ce.seuVideo") : t("ce.videoOriginal")}
          </div>
        </div>

        {/* Alças de arrastar - fora da moldura (que tem overflow hidden), senao
            ficariam impossiveis de clicar quando o video passa das bordas.
            Com template a largura é travada na moldura, então não há o que
            arrastar: quem posiciona é o controle de altura/posição. */}
        {!comTemplate && !comCapa && (<><div
          className="absolute top-1/2 h-10 w-3 -translate-y-1/2 cursor-ew-resize rounded bg-primary shadow"
          style={{ left: FRAME_LEFT + videoLeftInFrame - 6 }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
        <div
          className="absolute top-1/2 h-10 w-3 -translate-y-1/2 cursor-ew-resize rounded bg-primary shadow"
          style={{ left: FRAME_LEFT + videoLeftInFrame + videoWidth - 6 }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        /></>)}
      </div>
      <p className="max-w-[220px] text-center text-xs text-muted-foreground">
        {comCapa
          ? t("ce.capaColadaAoVideo", { n: alturaEmPercent })
          : comTemplate
          ? t("ce.templateAoFundo")
          : value >= 90
          ? t("ce.bemApertado")
          : value <= 10
            ? t("ce.bemAmplo")
            : `Zoom em ${value}%. Arraste as alças pra ajustar.`}
      </p>
    </div>
  )
}

const STYLE_PREVIEW: Record<VideoCaptionStyle, { label: ChaveDeTraducao; render: (text: string) => React.ReactNode }> = {
  classic: {
    label: "ce.classica",
    render: (text) => (
      <span style={{ fontFamily: "Arial Black, sans-serif", fontWeight: 900, color: "#fff", WebkitTextStroke: "1.5px #000", fontSize: 15 }}>
        {text}
      </span>
    ),
  },
  bold: {
    label: "ce.chamativa",
    render: (text) => (
      <span style={{ fontFamily: "Arial Black, sans-serif", fontWeight: 900, color: "#ffd700", WebkitTextStroke: "1.5px #000", fontSize: 17 }}>
        {text}
      </span>
    ),
  },
  minimal: {
    label: "ce.minimalista",
    render: (text) => (
      <span style={{ fontFamily: "Arial, sans-serif", color: "#fff", WebkitTextStroke: "0.5px #000", fontSize: 13 }}>{text}</span>
    ),
  },
  bubble_dark: {
    label: "ce.balaoEscuro",
    render: (text) => (
      <span
        style={{
          fontFamily: "Arial Black, sans-serif",
          fontWeight: 900,
          color: "#fff",
          fontSize: 14,
          background: "rgba(0,0,0,0.65)",
          padding: "3px 8px",
          borderRadius: 6,
        }}
      >
        {text}
      </span>
    ),
  },
  bubble_purple: {
    label: "ce.balaoRoxo",
    render: (text) => (
      <span
        style={{
          fontFamily: "Arial Black, sans-serif",
          fontWeight: 900,
          color: "#fff",
          fontSize: 14,
          background: "rgba(178,110,242,0.75)",
          padding: "3px 8px",
          borderRadius: 6,
        }}
      >
        {text}
      </span>
    ),
  },
  neon_verde: {
    label: "ce.neonVerde",
    render: (text) => (
      <span
        style={{
          fontFamily: "Anton, Arial Black, sans-serif",
          color: "#00ff7f",
          fontSize: 15,
          WebkitTextStroke: "2px #000",
          paintOrder: "stroke fill",
        }}
      >
        {text}
      </span>
    ),
  },
  vermelho_forte: {
    label: "ce.vermelhoForte",
    render: (text) => (
      <span
        style={{
          fontFamily: "Anton, Arial Black, sans-serif",
          color: "#fff",
          fontSize: 14,
          background: "#d92323",
          padding: "3px 8px",
          borderRadius: 4,
        }}
      >
        {text}
      </span>
    ),
  },
  amarelo_caixa: {
    label: "ce.amareloCaixa",
    render: (text) => (
      <span
        style={{
          fontFamily: "Anton, Arial Black, sans-serif",
          color: "#000",
          fontSize: 14,
          background: "#ffd700",
          padding: "3px 8px",
          borderRadius: 4,
        }}
      >
        {text}
      </span>
    ),
  },
  branco_caixa: {
    label: "ce.brancoCaixa",
    render: (text) => (
      <span
        style={{
          fontFamily: "Anton, Arial Black, sans-serif",
          color: "#000",
          fontSize: 14,
          background: "#ffffff",
          padding: "3px 8px",
          borderRadius: 4,
        }}
      >
        {text}
      </span>
    ),
  },
  contorno_grosso: {
    label: "ce.contornoGrosso",
    render: (text) => (
      <span
        style={{
          fontFamily: "Anton, Arial Black, sans-serif",
          color: "#fff",
          fontSize: 15,
          WebkitTextStroke: "3px #000",
          paintOrder: "stroke fill",
        }}
      >
        {text}
      </span>
    ),
  },
  caixa_colorida: {
    label: "ce.caixaColorida",
    render: (text) => (
      <span
        style={{
          fontFamily: "Anton, Arial Black, sans-serif",
          color: "#fff",
          fontSize: 14,
          background: "var(--cor-da-caixa, #D92323)",
          padding: "3px 8px",
          borderRadius: 4,
        }}
      >
        {text}
      </span>
    ),
  },
  papel_rasgado: {
    label: "ce.papelRasgado",
    render: (text) => (
      <span
        style={{
          fontFamily: "Anton, Arial Black, sans-serif",
          color: "#fff",
          fontSize: 13,
          background: "var(--cor-da-caixa, #D92323)",
          padding: "4px 10px",
          // Borda recortada: é a mesma ideia do papel de verdade, aproximada
          // em CSS só para a miniatura. O arquivo final usa a imagem PNG.
          clipPath:
            "polygon(0% 18%, 6% 4%, 14% 14%, 23% 2%, 33% 12%, 44% 3%, 55% 13%, 66% 2%, 77% 12%, 88% 3%, 96% 13%, 100% 6%, 100% 84%, 93% 97%, 84% 87%, 74% 98%, 63% 88%, 52% 98%, 41% 87%, 30% 97%, 19% 87%, 9% 98%, 0% 88%)",
        }}
      >
        {text}
      </span>
    ),
  },
  none: {
    label: "ce.semLegenda",
    render: () => <span className="text-xs text-white/40">(nenhuma)</span>,
  },
}

function StyleGallery({
  options,
  value,
  onChange,
  sampleText,
  corDaCaixa = "#D92323",
}: {
  options: VideoCaptionStyle[]
  value: VideoCaptionStyle
  onChange: (v: VideoCaptionStyle) => void
  sampleText: string
  corDaCaixa?: string
}) {
  const t = useT()
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {options.map((style) => {
        const preview = STYLE_PREVIEW[style]
        if (!preview) return null
        return (
          <button
            key={style}
            type="button"
            onClick={() => onChange(style)}
            className={cn(
              "flex flex-col items-center gap-2 rounded-lg border p-2 transition",
              value === style ? "border-primary ring-1 ring-primary" : "border-border hover:bg-accent"
            )}
          >
            {/* A cor escolhida entra por variável CSS: assim a miniatura do
                modelo colorido mostra a cor de verdade, em vez de uma cor de
                exemplo que não corresponde ao que vai sair. */}
            <div
              className="flex h-16 w-full items-center justify-center rounded-md bg-neutral-900"
              style={{ ["--cor-da-caixa" as string]: corDaCaixa }}
            >
              {preview.render(sampleText)}
            </div>
            <span className="text-xs font-medium">{t(preview.label)}</span>
          </button>
        )
      })}
    </div>
  )
}

// Barra de arrastar para altura. O número que ela controla é a distância até
// a borda MAIS PRÓXIMA (legenda sobe de baixo, título desce de cima), então
// arrastar para a direita sempre afasta o texto da sua borda - o mesmo gesto
// tem o mesmo efeito nos dois.
// Fonte num dropdown, e não numa galeria: o que muda entre elas é o desenho
// da letra, e isso se lê melhor na mesma palavra escrita em cada uma do que em
// miniaturas lado a lado. Cada opção aparece escrita na própria fonte.
// Seletor de cor. Só aparece quando o modelo escolhido usa cor - mostrar um
// seletor que não muda nada é pior do que não mostrar.
function CorSelect({
  label,
  valor,
  onChange,
}: {
  label: string
  valor: string
  onChange: (v: string) => void
}) {
  const [rascunho, setRascunho] = useState(valor)
  useEffect(() => setRascunho(valor), [valor])
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          // Salva ao soltar, não a cada tom percorrido: o seletor dispara
          // enquanto se arrasta, e salvar em cada passo repetiria o problema
          // das gravações fora de ordem.
          onBlur={() => onChange(rascunho.toUpperCase())}
          className="h-9 w-16 cursor-pointer rounded border border-border bg-transparent p-1"
        />
        <span className="font-mono text-xs text-muted-foreground">{rascunho.toUpperCase()}</span>
      </div>
    </Field>
  )
}

function FonteSelect({
  label,
  valor,
  opcoes,
  onChange,
}: {
  label: string
  valor: string
  opcoes: string[]
  onChange: (v: string) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <Select value={valor} onValueChange={onChange}>
        <SelectTrigger className="w-56">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {opcoes.map((f) => (
            <SelectItem key={f} value={f}>
              <span style={{ fontFamily: f }}>{f}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function AlturaSlider({
  label,
  valor,
  onChange,
}: {
  label: string
  valor: number
  onChange: (v: number) => void
}) {
  const [rascunho, setRascunho] = useState(valor)
  useEffect(() => setRascunho(valor), [valor])
  return (
    <Field>
      <FieldLabel>
        {label} <span className="font-normal text-muted-foreground">({rascunho}%)</span>
      </FieldLabel>
      <input
        type="range"
        min={0}
        max={80}
        step={1}
        value={rascunho}
        onChange={(e) => setRascunho(Number(e.target.value))}
        // Salva só ao soltar: salvar a cada pixel arrastado dispararia dezenas
        // de gravações, e a mais lenta poderia terminar por último e vencer
        // com um valor antigo - foi exatamente o bug dos horários de postagem.
        onMouseUp={() => onChange(rascunho)}
        onTouchEnd={() => onChange(rascunho)}
        onKeyUp={() => onChange(rascunho)}
        className="w-full accent-primary"
      />
    </Field>
  )
}

// Prévia do corte. Aproximação em HTML, não o vídeo real — mas usa as MESMAS
// fontes que o servidor queima no arquivo (ver globals.css) e as mesmas
// alturas em porcentagem, então o que aparece aqui é o que sai lá.
//
// Precisa cobrir TODOS os fundos. Quando cobria só parte deles, escolher "capa
// do vídeo" não mudava nada na prévia e ela virava uma promessa falsa - pior
// do que não existir, porque a pessoa confia no que vê.
function ClipPreview({
  settings,
  urlTemplate,
}: {
  settings: ClientVideoSettingsResponse
  urlTemplate: string | null
}) {
  const t = useT()

  // Três estilos colam uma FAIXA de imagem ao vídeo, e o vídeo ocupa o resto.
  // Os outros preenchem o quadro inteiro com o vídeo.
  const temFaixa = ["thumbnail", "frame", "template"].includes(settings.backgroundStyle)
  const alturaVideo = temFaixa ? settings.backgroundVideoHeightPercent : 100
  const faixaEmCima = (settings.thumbnailPosition || "top") === "top"

  const corDoQuadro =
    settings.backgroundStyle === "black" ? "#000" : settings.backgroundStyle === "white" ? "#fff" : "#111"

  const estiloLegenda = STYLE_PREVIEW[settings.captionStyle]
  const estiloTitulo = STYLE_PREVIEW[settings.titleStyle as VideoCaptionStyle]

  // A faixa de imagem: a arte enviada tem imagem de verdade; capa e frame são
  // representados, porque só existem na hora de cortar.
  function Faixa({ altura }: { altura: number }) {
    if (settings.backgroundStyle === "template" && urlTemplate) {
      return <img src={urlTemplate} alt="" className="w-full object-cover" style={{ height: `${altura}%` }} />
    }
    return (
      <div
        className="flex w-full items-center justify-center bg-gradient-to-br from-amber-300 to-rose-300 text-[10px] font-medium text-neutral-800"
        style={{ height: `${altura}%` }}
      >
        {settings.backgroundStyle === "frame" ? t("ce.frameDoVideo") : t("ce.capaDoVideo")}
      </div>
    )
  }

  return (
    <Field>
      <FieldLabel>{t("ce.previa")}</FieldLabel>
      {/* Largura por porcentagem com teto: em telas grandes fica com 234px,
          no celular encolhe junto com a coluna em vez de furar a tela. */}
      <div
        className="relative mx-auto w-full max-w-[234px] overflow-hidden rounded-lg border border-border"
        style={{ aspectRatio: "9 / 16", background: corDoQuadro }}
      >
        {/* Camada do conteúdo: faixa + vídeo, ou só vídeo. */}
        <div className="absolute inset-0 flex flex-col">
          {temFaixa && faixaEmCima && <Faixa altura={100 - alturaVideo} />}
          <div
            className="flex w-full items-center justify-center bg-neutral-700/70 text-[10px] text-white/50"
            style={{ height: `${alturaVideo}%` }}
          >
            {t("ce.seuVideo")}
          </div>
          {temFaixa && !faixaEmCima && <Faixa altura={100 - alturaVideo} />}
        </div>

        {/* Título e legenda ficam POR CIMA de tudo, posicionados em relação ao
            quadro inteiro - é assim que o servidor desenha. */}
        {settings.showTitle && estiloTitulo && (
          <div
            className="absolute inset-x-0 flex justify-center px-2 text-center"
            style={{ top: `${settings.titleHeightPercent}%` }}
          >
            <span style={{ fontFamily: settings.titleFont }}>{estiloTitulo.render("SEU TÍTULO")}</span>
          </div>
        )}

        {settings.captionStyle !== "none" && estiloLegenda && (
          <div
            className="absolute inset-x-0 flex justify-center px-2 text-center"
            style={{ bottom: `${settings.captionHeightPercent}%` }}
          >
            <span style={{ fontFamily: settings.captionFont }}>{estiloLegenda.render("legenda")}</span>
          </div>
        )}
      </div>
      <p className="text-center text-xs text-muted-foreground">{t("ce.previaTexto")}</p>
    </Field>
  )
}

// Rotulos do bloco "como funcionam os cortes". Vieram do VideoSettingsCard,
// que era um cartao separado ate 23/08/2026 - decidir a QUANTIDADE de cortes
// num cartao e o ESTILO deles noutro obrigava a abrir dois paineis pra montar
// uma configuracao so.
//
// Guardam a CHAVE de traducao, nao o texto: sao montados quando o modulo
// carrega, antes de existir idioma escolhido.
const CLIP_LENGTH_LABELS: Record<string, ChaveDeTraducao> = {
  short: "vs.curtos",
  balanced: "vs.equilibrados",
  long: "vs.longos",
  extra_long: "vs.duracaoExtraLonga",
}
const CLIP_MODE_LABELS: Record<string, ChaveDeTraducao> = {
  ai_choice: "vs.melhoresPartes",
  full_parts: "vs.videoEmPartes",
  fixed_count: "vs.escolherQuantidade",
}
const CLIP_MODE_DESCRIPTIONS: Record<string, ChaveDeTraducao> = {
  ai_choice: "vs.iaDecide",
  full_parts: "vs.videoEmPartesTexto",
  fixed_count: "vs.quantidadeFixaTexto",
}
const DESCRIPTION_MODE_LABELS: Record<string, ChaveDeTraducao> = {
  auto: "vs.iaEscreve",
  fixed: "vs.sempreAMesma",
  none: "vs.semDescricao",
}

const POSITIONS: PartLabelPosition[] = ["top_left", "top_center", "top_right", "bottom_left", "bottom_center", "bottom_right"]
const POSITION_STYLE: Record<PartLabelPosition, React.CSSProperties> = {
  top_left: { top: 8, left: 8 },
  top_center: { top: 8, left: "50%", transform: "translateX(-50%)" },
  top_right: { top: 8, right: 8 },
  bottom_left: { bottom: 8, left: 8 },
  bottom_center: { bottom: 8, left: "50%", transform: "translateX(-50%)" },
  bottom_right: { bottom: 8, right: 8 },
}

function PartLabelPositionPicker({ value, onChange }: { value: PartLabelPosition; onChange: (v: PartLabelPosition) => void }) {
  const t = useT()
  return (
    <div className="relative rounded-md bg-neutral-900" style={{ width: 240, height: 180 }}>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white/25">{t("ce.corte916")}</span>
      {POSITIONS.map((pos) => (
        <button
          key={pos}
          type="button"
          onClick={() => onChange(pos)}
          style={POSITION_STYLE[pos]}
          className={cn(
            "absolute rounded px-2 py-1 text-[10px] font-bold whitespace-nowrap",
            value === pos ? "bg-primary text-primary-foreground" : "bg-white/15 text-white hover:bg-white/25"
          )}
        >{t("ce.parteUm")}</button>
      ))}
    </div>
  )
}

export function ClipStyleEditorCard() {
  const t = useT()
  const [settings, setSettings] = useState<ClientVideoSettingsResponse | null>(null)
  const [zoomDraft, setZoomDraft] = useState(100)
  // Rascunho local do texto fixo: salvar a cada tecla dispararia uma
  // requisicao por letra digitada.
  const [descriptionDraft, setDescriptionDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  // "all" = a configuração que vale pra todos os canais. Um id = o estilo
  // daquele canal só.
  const [alvo, setAlvo] = useState<string>("all")
  // Muda a cada upload/remoção pra forçar o navegador a buscar a imagem de
  // novo (a URL é sempre a mesma, senão ficaria mostrando a antiga do cache).
  const [versaoTemplate, setVersaoTemplate] = useState(0)
  const [enviandoTemplate, setEnviandoTemplate] = useState(false)
  const [erroTemplate, setErroTemplate] = useState<string | null>(null)

  const queryAlvo = alvo === "all" ? "" : `?channelId=${alvo}`

  useEffect(() => {
    api.get<ClientVideoSettingsResponse>(`/api/client/video-settings${queryAlvo}`).then((data) => {
      setSettings(data)
      setZoomDraft(data.cropZoomPercent)
      setDescriptionDraft(data.descriptionTemplate ?? "")
      setVersaoTemplate((v) => v + 1)
    })
  }, [queryAlvo])

  async function save(next: ClientVideoSettingsResponse) {
    setSettings(next)
    setSaving(true)
    setSavedFlash(false)
    try {
      const corpo = alvo === "all" ? next : { ...next, channelId: Number(alvo) }
      const updated = await api.put<ClientVideoSettingsResponse>("/api/client/video-settings", corpo)
      // O PUT devolve só o que foi salvo; a lista de canais e o alvo vêm do
      // GET, então preservamos pra tela não perder o seletor depois de salvar.
      setSettings({ ...updated, channels: next.channels, channelId: next.channelId, usesDefault: false })
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  async function enviarTemplate(arquivo: File) {
    setEnviandoTemplate(true)
    setErroTemplate(null)
    try {
      const form = new FormData()
      form.append("image", arquivo)
      const resposta = await fetch(`/api/client/video-settings/background-template${queryAlvo}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": csrfToken() },
        body: form,
      })
      const dados = await resposta.json().catch(() => ({}))
      if (!resposta.ok) throw new Error(dados.error || t("ce.naoFoiPossivelEnviarImagem"))
      const atualizado = await api.get<ClientVideoSettingsResponse>(`/api/client/video-settings${queryAlvo}`)
      setSettings(atualizado)
      setVersaoTemplate((v) => v + 1)
    } catch (e) {
      setErroTemplate(e instanceof Error ? e.message : t("ce.naoFoiPossivelEnviarImagem"))
    } finally {
      setEnviandoTemplate(false)
    }
  }

  async function removerTemplate() {
    await api.delete(`/api/client/video-settings/background-template${queryAlvo}`)
    const atualizado = await api.get<ClientVideoSettingsResponse>(`/api/client/video-settings${queryAlvo}`)
    setSettings(atualizado)
    setVersaoTemplate((v) => v + 1)
  }

  async function voltarAoPadrao() {
    await api.delete(`/api/client/video-settings/channel/${alvo}`)
    const atualizado = await api.get<ClientVideoSettingsResponse>(`/api/client/video-settings${queryAlvo}`)
    setSettings(atualizado)
    setZoomDraft(atualizado.cropZoomPercent)
    setVersaoTemplate((v) => v + 1)
  }

  if (!settings) return <Skeleton className="h-96" />

  const urlTemplate = settings.hasBackgroundTemplate
    ? `/api/client/video-settings/background-template${queryAlvo}${queryAlvo ? "&" : "?"}v=${versaoTemplate}`
    : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconAdjustmentsHorizontal className="size-4 text-muted-foreground" />{t("ce.titulo")}</CardTitle>
        <CardDescription>{t("ce.descricao")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {/* Onde este estilo se aplica. Fica no topo porque muda o significado
            de tudo que vem abaixo: sem isso a pessoa edita achando que mexe em
            um canal e na verdade mexe em todos. */}
        <Field>
          <FieldLabel>{t("ce.aplicarEm")}</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={alvo} onValueChange={setAlvo}>
              <SelectTrigger className="w-[19rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("ce.todosOsCanais")}</SelectItem>
                {settings.channels.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                    {c.hasOwnStyle ? t("ce.estiloProprio") : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {alvo !== "all" && !settings.usesDefault && (
              <Button variant="outline" size="sm" onClick={voltarAoPadrao}>{t("ce.voltarASeguirTodos")}</Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {alvo === "all"
              ? t("ce.valeParaTodoCanal")
              : settings.usesDefault
                ? t("ce.canalSegueConfig")
                : t("ce.canalTemProprio")}
          </p>
        </Field>

        {/* ----------------------------------------------------------------
            COMO FUNCIONAM OS CORTES

            Era um cartao separado ("qualidade e estilo dos cortes"). Decidir
            quantos cortes sair num painel e como eles aparecem noutro obrigava
            a abrir os dois pra montar uma configuracao so - e os dois gravavam
            a MESMA linha do banco, cada um mandando metade dos campos, o que
            ja causou o bug de "configuracao que nao salva".
            ---------------------------------------------------------------- */}
        <div className="flex flex-col gap-4 rounded-lg border border-border bg-muted/20 p-4">
          <Field>
            <FieldLabel>{t("vs.comoEscolher")}</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              value={settings.clipMode}
              onValueChange={(next) => next && save({ ...settings, clipMode: next as never })}
              className="flex-wrap"
            >
              {settings.options.clipModes.map((m) => (
                <ToggleGroupItem key={m} value={m} className="text-xs">
                  {CLIP_MODE_LABELS[m] ? t(CLIP_MODE_LABELS[m]) : m}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">{t(CLIP_MODE_DESCRIPTIONS[settings.clipMode])}</p>
          </Field>

          {settings.clipMode === "full_parts" ? (
            /* No modo de partes nao ha "quantos cortes": quantos saem depende
               da duracao do video. O que o cliente escolhe e o tamanho medio
               de cada parte. */
            <Field>
              <FieldLabel htmlFor="fullPartsMinutes">{t("vs.duracaoDeCadaParte")}</FieldLabel>
              <Input
                id="fullPartsMinutes"
                type="number"
                min={settings.options.fullPartsMinMinutes}
                max={settings.options.fullPartsMaxMinutes}
                className="max-w-28"
                value={settings.fullPartsMinutes}
                onChange={(e) => setSettings({ ...settings, fullPartsMinutes: Number(e.target.value) })}
                /* Salva ao SAIR do campo, nao a cada tecla: digitar "10"
                   passa por "1", e um save por tecla mandaria duas
                   requisicoes que podem chegar fora de ordem (foi exatamente
                   o bug dos horarios de postagem). */
                onBlur={() => {
                  const n = Math.round(Number(settings.fullPartsMinutes))
                  const limitado = Math.min(
                    settings.options.fullPartsMaxMinutes,
                    Math.max(settings.options.fullPartsMinMinutes, Number.isFinite(n) ? n : 3)
                  )
                  save({ ...settings, fullPartsMinutes: limitado })
                }}
              />
              <p className="text-xs text-muted-foreground">{t("vs.duracaoDeCadaParteTexto")}</p>
            </Field>
          ) : (
            <>
              {/* A quantidade vale tambem no modo "melhores partes": ali ela e
                  o TETO de cortes que a IA pode gerar. */}
              <Field>
                <FieldLabel htmlFor="maxClips">{t("vs.quantidadeCortes")}</FieldLabel>
                <Input
                  id="maxClips"
                  type="number"
                  min={1}
                  max={30}
                  className="max-w-28"
                  value={settings.maxClips}
                  onChange={(e) => setSettings({ ...settings, maxClips: Number(e.target.value) })}
                  onBlur={() => {
                    const n = Math.round(Number(settings.maxClips))
                    save({ ...settings, maxClips: Math.min(30, Math.max(1, Number.isFinite(n) ? n : 4)) })
                  }}
                />
              </Field>

              <Field>
                <FieldLabel>{t("vs.duracaoCadaCorte")}</FieldLabel>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={settings.clipLength}
                  onValueChange={(next) => next && save({ ...settings, clipLength: next as never })}
                  className="flex-wrap"
                >
                  {settings.options.clipLengths.map((o) => (
                    <ToggleGroupItem key={o} value={o} className="text-xs">
                      {CLIP_LENGTH_LABELS[o] ? t(CLIP_LENGTH_LABELS[o]) : o}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </Field>
            </>
          )}

          <Field>
            <FieldLabel>{t("vs.descricaoDoCorte")}</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              value={settings.descriptionMode}
              onValueChange={(next) => next && save({ ...settings, descriptionMode: next as never })}
              className="flex-wrap"
            >
              {settings.options.descriptionModes.map((m) => (
                <ToggleGroupItem key={m} value={m} className="text-xs">
                  {DESCRIPTION_MODE_LABELS[m] ? t(DESCRIPTION_MODE_LABELS[m]) : m}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          {settings.descriptionMode === "fixed" && (
            <Field>
              <FieldLabel htmlFor="descriptionTemplate">{t("vs.textoFixo")}</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="descriptionTemplate"
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  placeholder={t("vs.exemploDescricao")}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="shrink-0"
                  onClick={() => save({ ...settings, descriptionTemplate: descriptionDraft })}
                >
                  {t("comum.salvar")}
                </Button>
              </div>
            </Field>
          )}
        </div>

        <Field>
          <FieldLabel>{t("ce.estiloVisualDoCorte")}</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={settings.cropStyleMode}
            onValueChange={(next) => next && save({ ...settings, cropStyleMode: next as "auto" | "manual" })}
          >
            <ToggleGroupItem value="auto" className="text-xs">{t("ce.modoAutomatico")}</ToggleGroupItem>
            <ToggleGroupItem value="manual" className="text-xs">{t("ce.modoManual")}</ToggleGroupItem>
          </ToggleGroup>
        </Field>

        {/* Duas colunas: configurações à esquerda, prévia à direita grudada
            na tela enquanto a pessoa rola. No celular vira uma coluna só e a
            prévia aparece PRIMEIRO - mexer numa configuração sem ver o efeito
            obriga a rolar pra cima e pra baixo a cada ajuste.

            A prévia vem antes no HTML (por isso fica em cima no celular) e o
            `order` a joga pra direita nas telas grandes. */}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <aside className="lg:order-2">
            <div className="lg:sticky lg:top-4">
              <ClipPreview settings={settings} urlTemplate={urlTemplate} />
            </div>
          </aside>

          <div className="flex min-w-0 flex-col gap-6 lg:order-1">
        {settings.cropStyleMode === "manual" && (
          <>
            <Field>
              <FieldLabel>{t("ce.fundoDoCorte")}</FieldLabel>
              <p className="text-xs text-muted-foreground">{t("ce.fundoTexto")}</p>

              {/* Quatro escolhas. Antes só havia duas, e uma delas era implícita:
                  ou você enviava uma imagem, ou ficava o vídeo desfocado. Quem
                  quisesse fundo liso tinha que criar uma imagem de 1080x1920
                  preenchida de uma cor só - trabalho por algo que o sistema
                  gera sozinho. */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                {(
                  [
                    { valor: "blur", titulo: t("ce.videoDesfocado"), amostra: "desfocado" },
                    { valor: "black", titulo: t("ce.preto"), amostra: "preto" },
                    { valor: "white", titulo: t("ce.branco"), amostra: "branco" },
                    { valor: "template", titulo: t("ce.minhaImagem"), amostra: "imagem" },
                    { valor: "thumbnail", titulo: t("ce.capaDoVideo"), amostra: "capa" },
                    { valor: "frame", titulo: t("ce.frameDoVideo"), amostra: "capa" },
                  ] as const
                ).map((op) => {
                  const escolhido = settings.backgroundStyle === op.valor
                  // Escolher "minha imagem" sem ter enviado nada renderizaria
                  // com o desfocado sem explicar por quê - o servidor recusa, e
                  // aqui a opção fica desabilitada com o motivo.
                  const bloqueado = op.valor === "template" && !settings.hasBackgroundTemplate
                  return (
                    <button
                      key={op.valor}
                      type="button"
                      disabled={bloqueado}
                      title={bloqueado ? t("ce.envieImagemPrimeiro") : undefined}
                      onClick={() => {
                        // Com o vídeo em 100% não sobra espaço pra faixa da
                        // capa: a escolha ficaria selecionada sem mudar nada
                        // no corte. Abre espaço junto, pra escolher já valer.
                        const precisaAbrirEspaco =
                          op.valor === "thumbnail" && settings.backgroundVideoHeightPercent >= 100
                        save({
                          ...settings,
                          backgroundStyle: op.valor,
                          ...(precisaAbrirEspaco ? { backgroundVideoHeightPercent: 65 } : {}),
                        })
                      }}
                      className={`rounded-lg border p-2 text-left transition-colors disabled:opacity-45 ${
                        escolhido ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60"
                      }`}
                    >
                      <span
                        className={`mb-1.5 block h-10 w-full rounded ${
                          op.amostra === "preto"
                            ? "bg-[#08090a]"
                            : op.amostra === "branco"
                              ? "border border-border bg-white"
                              : op.amostra === "desfocado"
                                ? "bg-gradient-to-br from-indigo-300 via-fuchsia-200 to-cyan-200 blur-[2px]"
                                : op.amostra === "capa"
                                  ? ""
                                  : "bg-[repeating-linear-gradient(45deg,#e7e7ea_0_6px,#f6f6f7_6px_12px)]"
                        }`}
                      >
                        {/* A amostra da capa mostra a ideia: duas faixas
                            encostadas, imagem e vídeo, sem nada entre elas. */}
                        {op.amostra === "capa" && (
                          <span className="flex h-full w-full flex-col overflow-hidden rounded">
                            <span className="h-2/5 w-full bg-gradient-to-br from-amber-300 to-rose-300" />
                            <span className="h-3/5 w-full bg-gradient-to-br from-slate-500 to-slate-700" />
                          </span>
                        )}
                      </span>
                      <span className="text-[11.5px] leading-tight font-medium">{op.titulo}</span>
                    </button>
                  )
                })}
              </div>
            </Field>

            {/* Seletor de lado da capa. Só aparece com "capa do vídeo"
                escolhida: aqui as duas peças ficam coladas, então escolher
                "em cima" já determina que o vídeo fica embaixo, encostado. */}
            {["thumbnail", "frame"].includes(settings.backgroundStyle) && (
              <Field>
                <FieldLabel>{t("ce.ondeFicaACapa")}</FieldLabel>
                <p className="text-xs text-muted-foreground">{t("ce.ondeFicaACapaTexto")}</p>
                <div className="grid grid-cols-2 gap-2 sm:max-w-xs">
                  {(
                    [
                      { valor: "top", titulo: t("ce.capaEmCima") },
                      { valor: "bottom", titulo: t("ce.capaEmBaixo") },
                    ] as const
                  ).map((op) => {
                    const escolhido = (settings.thumbnailPosition || "top") === op.valor
                    return (
                      <button
                        key={op.valor}
                        type="button"
                        onClick={() => save({ ...settings, thumbnailPosition: op.valor })}
                        className={`rounded-lg border p-2 transition-colors ${
                          escolhido ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60"
                        }`}
                      >
                        <span className="mx-auto mb-1.5 flex h-14 w-8 flex-col overflow-hidden rounded border border-border">
                          {op.valor === "top" ? (
                            <>
                              <span className="h-2/5 w-full bg-gradient-to-br from-amber-300 to-rose-300" />
                              <span className="h-3/5 w-full bg-gradient-to-br from-slate-500 to-slate-700" />
                            </>
                          ) : (
                            <>
                              <span className="h-3/5 w-full bg-gradient-to-br from-slate-500 to-slate-700" />
                              <span className="h-2/5 w-full bg-gradient-to-br from-amber-300 to-rose-300" />
                            </>
                          )}
                        </span>
                        <span className="block text-center text-[11.5px] font-medium">{op.titulo}</span>
                      </button>
                    )
                  })}
                </div>
              </Field>
            )}

            {/* Enviar imagem só faz sentido pro fundo "minha imagem" - a capa
                do vídeo o sistema pega sozinho. */}
            {settings.backgroundStyle !== "thumbnail" && (
            <Field>
              <FieldLabel>{t("ce.suaImagemDeFundo")}</FieldLabel>
              <p className="text-xs text-muted-foreground">
                Uma imagem 9:16 (1080x1920) com a sua arte: moldura, marca, publicidade. O vídeo é
                encaixado por cima dela, na altura e na posição que você escolher.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <label>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const arquivo = e.target.files?.[0]
                      if (arquivo) enviarTemplate(arquivo)
                      e.target.value = ""
                    }}
                  />
                  <Button asChild variant="outline" size="sm" disabled={enviandoTemplate}>
                    <span>{enviandoTemplate ? "Enviando..." : settings.hasBackgroundTemplate ? t("ce.trocarImagem") : t("ce.enviarImagem")}</span>
                  </Button>
                </label>
                {settings.hasBackgroundTemplate && (
                  <Button variant="ghost" size="sm" onClick={removerTemplate}>{t("comum.remover")}</Button>
                )}
              </div>
              {erroTemplate && <p className="text-xs text-destructive">{erroTemplate}</p>}
            </Field>
            )}

            {/* Valem pros quatro fundos: definem onde o vídeo fica no quadro, e
                o fundo escolhido preenche o resto. Com 100% não sobra fundo
                visível, e o corte sai igual ao de sempre. */}
            <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>{t("ce.alturaDoVideo")}</FieldLabel>
                  <Input
                    type="range"
                    min={10}
                    /* No modo capa o teto é 90%: em 100% não sobraria faixa
                       nenhuma e a capa sumiria sem explicação. */
                    max={["thumbnail", "frame"].includes(settings.backgroundStyle) ? 90 : 100}
                    value={settings.backgroundVideoHeightPercent}
                    onChange={(e) =>
                      setSettings({ ...settings, backgroundVideoHeightPercent: Number(e.target.value) })
                    }
                    onMouseUp={() => save(settings)}
                    onTouchEnd={() => save(settings)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {settings.backgroundVideoHeightPercent === 100
                      ? t("ce.telaInteira")
                      : ["thumbnail", "frame"].includes(settings.backgroundStyle)
                        ? t("ce.restoEhACapa", { n: settings.backgroundVideoHeightPercent })
                        : `${settings.backgroundVideoHeightPercent}% da altura. O resto fica sendo o fundo.`}
                  </p>
                </Field>
                {/* No modo capa a posição do vídeo não é livre: ele fica
                    encostado do lado oposto à faixa da capa. Um slider que
                    não muda nada seria pior que não ter slider. */}
                {settings.backgroundStyle !== "thumbnail" && (
                <Field>
                  <FieldLabel>{t("ce.posicaoDoVideo")}</FieldLabel>
                  <Input
                    type="range"
                    min={0}
                    max={100}
                    value={settings.backgroundVideoOffsetPercent}
                    onChange={(e) =>
                      setSettings({ ...settings, backgroundVideoOffsetPercent: Number(e.target.value) })
                    }
                    onMouseUp={() => save(settings)}
                    onTouchEnd={() => save(settings)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {settings.backgroundVideoOffsetPercent <= 15
                      ? t("ce.coladoNoTopo")
                      : settings.backgroundVideoOffsetPercent >= 85
                        ? t("ce.coladoNaBase")
                        : t("ce.noMeio")}
                  </p>
                </Field>
                )}
            </div>

            {/* O enquadramento por arraste só entra quando o vídeo ocupa o
                quadro INTEIRO. Com uma faixa de imagem colada (capa, frame ou
                arte enviada), quem decide o recorte são as barras de altura e
                posição acima - o servidor ignora o zoom nesse caminho.
                Mostrar as alças ali era pedir um gesto que não mudava nada no
                corte, e ainda repetia a prévia que agora fica fixa ao lado. */}
            {settings.backgroundVideoHeightPercent >= 100 && (
              <Field>
                <FieldLabel>{t("ce.enquadramentoArraste")}</FieldLabel>
                {/* A moldura tem largura fixa (o vídeo original precisa caber
                    esticado ao lado dela) e não cabe num celular: sem esta
                    caixa, a PÁGINA INTEIRA rolava de lado. Rola só o editor. */}
                <div className="-mx-1 overflow-x-auto px-1">
                <CropZoomEditor
                  value={zoomDraft}
                  onChange={setZoomDraft}
                  onCommit={(v) => save({ ...settings, cropZoomPercent: v })}
                  templateUrl={urlTemplate}
                  templateHeightPercent={settings.backgroundVideoHeightPercent}
                  templateOffsetPercent={settings.backgroundVideoOffsetPercent}
                  modoCapa={["thumbnail", "frame"].includes(settings.backgroundStyle)}
                  capaPosition={settings.thumbnailPosition || "top"}
                />
                </div>
              </Field>
            )}

            <Field>
              <FieldLabel>{t("ce.estiloDaLegenda")}</FieldLabel>
              <FonteSelect
                label={t("ce.fonte")}
                valor={settings.captionFont}
                opcoes={settings.options.fonts}
                onChange={(v) => save({ ...settings, captionFont: v })}
              />
              {settings.captionStyle === "caixa_colorida" && (
                <CorSelect
                  label={t("ce.corDaCaixa")}
                  valor={settings.captionBoxColor}
                  onChange={(v) => save({ ...settings, captionBoxColor: v })}
                />
              )}
              <AlturaSlider
                label={t("ce.alturaDaLegenda")}
                valor={settings.captionHeightPercent}
                onChange={(v) => save({ ...settings, captionHeightPercent: v })}
              />
              <StyleGallery
                corDaCaixa={settings.captionBoxColor}
                options={settings.options.captionStyles}
                value={settings.captionStyle}
                onChange={(v) => save({ ...settings, captionStyle: v })}
                sampleText="Exemplo"
              />
            </Field>

            <Field orientation="horizontal">
              <Checkbox
                id="showTitle"
                checked={settings.showTitle}
                onCheckedChange={(checked) => save({ ...settings, showTitle: checked === true })}
              />
              <FieldLabel htmlFor="showTitle" className="font-normal">{t("ce.mostrarTitulo")}</FieldLabel>
            </Field>

            {settings.showTitle && (
              <>
                <Field>
                  <FieldLabel htmlFor="titleSeconds">{t("ce.porQuantosSegundos")}</FieldLabel>
                  <Input
                    id="titleSeconds"
                    type="number"
                    min={1}
                    max={15}
                    className="max-w-28"
                    value={settings.titleSeconds}
                    onChange={(e) => save({ ...settings, titleSeconds: Number(e.target.value) })}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t("ce.estiloDoTitulo")}</FieldLabel>
                  <FonteSelect
                    label={t("ce.fonte")}
                    valor={settings.titleFont}
                    opcoes={settings.options.fonts}
                    onChange={(v) => save({ ...settings, titleFont: v })}
                  />
                  {["caixa_colorida", "papel_rasgado"].includes(settings.titleStyle) && (
                    <CorSelect
                      label={settings.titleStyle === "papel_rasgado" ? t("ce.corDoPapel") : t("ce.corDaCaixa")}
                      valor={settings.titleBoxColor}
                      onChange={(v) => save({ ...settings, titleBoxColor: v })}
                    />
                  )}
                  <AlturaSlider
                    label={t("ce.alturaDoTitulo")}
                    valor={settings.titleHeightPercent}
                    onChange={(v) => save({ ...settings, titleHeightPercent: v })}
                  />
                  <StyleGallery
                    corDaCaixa={settings.titleBoxColor}
                    options={settings.options.titleStyles}
                    value={settings.titleStyle}
                    onChange={(v) => save({ ...settings, titleStyle: v })}
                    sampleText={t("ce.tituloAqui")}
                  />
                </Field>
              </>
            )}

            {/* No modo de partes a numeracao nao e escolha: sem "Parte 1 /
                Parte 2" as fatias chegam no TikTok sem ordem nenhuma. O
                servidor forca o mesmo (um PUT direto nao burla), aqui a
                caixa so fica marcada e travada, com o motivo do lado. */}
            <Field orientation="horizontal">
              <Checkbox
                id="showPartLabel"
                checked={settings.clipMode === "full_parts" ? true : settings.showPartLabel}
                disabled={settings.clipMode === "full_parts"}
                onCheckedChange={(checked) => save({ ...settings, showPartLabel: checked === true })}
              />
              <FieldLabel htmlFor="showPartLabel" className="font-normal">{t("ce.numerarCortes")}</FieldLabel>
            </Field>
            {settings.clipMode === "full_parts" && (
              <p className="-mt-3 text-xs text-muted-foreground">{t("ce.numeracaoObrigatoria")}</p>
            )}
            {(settings.showPartLabel || settings.clipMode === "full_parts") && (
              <Field>
                <FieldLabel>{t("ce.ondeMostrarNumeracao")}</FieldLabel>
                <PartLabelPositionPicker
                  value={settings.partLabelPosition}
                  onChange={(v) => save({ ...settings, partLabelPosition: v })}
                />
              </Field>
            )}
          </>
        )}
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {saving ? "Salvando..." : savedFlash ? "Salvo ✓" : t("vs.mudancasValem")}
        </p>
      </CardContent>
    </Card>
  )
}
