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
}) {
  const t = useT()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const comTemplate = Boolean(templateUrl)
  // Com template, quem manda na altura do vídeo é o controle de altura, não o
  // zoom: o zoom passa a controlar só o quanto se corta das laterais.
  const videoHeight = comTemplate
    ? (FRAME_HEIGHT * Math.max(10, Math.min(100, templateHeightPercent ?? 70))) / 100
    : videoHeightForZoom(value)
  const videoWidth = comTemplate ? FRAME_WIDTH : videoHeight * (16 / 9)
  const videoLeftInFrame = (FRAME_WIDTH - videoWidth) / 2
  const videoTop = comTemplate
    ? ((FRAME_HEIGHT - videoHeight) * Math.max(0, Math.min(100, templateOffsetPercent ?? 50))) / 100
    : (FRAME_HEIGHT - videoHeight) / 2

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
          <div
            className="absolute flex items-center justify-center bg-neutral-700/95 text-center text-[10px] text-white/70"
            style={{ width: videoWidth, height: videoHeight, left: videoLeftInFrame, top: videoTop }}
          >
            {comTemplate ? t("ce.seuVideo") : t("ce.videoOriginal")}
          </div>
        </div>

        {/* Alças de arrastar - fora da moldura (que tem overflow hidden), senao
            ficariam impossiveis de clicar quando o video passa das bordas.
            Com template a largura é travada na moldura, então não há o que
            arrastar: quem posiciona é o controle de altura/posição. */}
        {!comTemplate && (<><div
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
        {comTemplate
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
}: {
  options: VideoCaptionStyle[]
  value: VideoCaptionStyle
  onChange: (v: VideoCaptionStyle) => void
  sampleText: string
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
            <div className="flex h-16 w-full items-center justify-center rounded-md bg-neutral-900">
              {preview.render(sampleText)}
            </div>
            <span className="text-xs font-medium">{t(preview.label)}</span>
          </button>
        )
      })}
    </div>
  )
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
        <CardDescription>
          Automático usa nosso padrão (recorte central 9:16, legenda clássica, título clássico, sem numeração). Manual
          te dá controle total sobre enquadramento, legenda, título e numeração de parte.
        </CardDescription>
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

        <ToggleGroup
          type="single"
          variant="outline"
          value={settings.cropStyleMode}
          onValueChange={(next) => next && save({ ...settings, cropStyleMode: next as "auto" | "manual" })}
        >
          <ToggleGroupItem value="auto" className="text-xs">{t("ce.modoAutomatico")}</ToggleGroupItem>
          <ToggleGroupItem value="manual" className="text-xs">{t("ce.modoManual")}</ToggleGroupItem>
        </ToggleGroup>

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
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {(
                  [
                    { valor: "blur", titulo: t("ce.videoDesfocado"), amostra: "desfocado" },
                    { valor: "black", titulo: t("ce.preto"), amostra: "preto" },
                    { valor: "white", titulo: t("ce.branco"), amostra: "branco" },
                    { valor: "template", titulo: t("ce.minhaImagem"), amostra: "imagem" },
                    { valor: "thumbnail", titulo: t("ce.capaDoVideo"), amostra: "capa" },
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
            {settings.backgroundStyle === "thumbnail" && (
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
                    max={settings.backgroundStyle === "thumbnail" ? 90 : 100}
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
                      : settings.backgroundStyle === "thumbnail"
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

            <Field>
              <FieldLabel>{t("ce.enquadramentoArraste")}</FieldLabel>
              <CropZoomEditor
                value={zoomDraft}
                onChange={setZoomDraft}
                onCommit={(v) => save({ ...settings, cropZoomPercent: v })}
                templateUrl={urlTemplate}
                templateHeightPercent={settings.backgroundVideoHeightPercent}
                templateOffsetPercent={settings.backgroundVideoOffsetPercent}
              />
            </Field>

            <Field>
              <FieldLabel>{t("ce.estiloDaLegenda")}</FieldLabel>
              <StyleGallery
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
                    className="w-24"
                    value={settings.titleSeconds}
                    onChange={(e) => save({ ...settings, titleSeconds: Number(e.target.value) })}
                  />
                </Field>
                <Field>
                  <FieldLabel>{t("ce.estiloDoTitulo")}</FieldLabel>
                  <StyleGallery
                    options={settings.options.titleStyles}
                    value={settings.titleStyle}
                    onChange={(v) => save({ ...settings, titleStyle: v })}
                    sampleText={t("ce.tituloAqui")}
                  />
                </Field>
              </>
            )}

            <Field orientation="horizontal">
              <Checkbox
                id="showPartLabel"
                checked={settings.showPartLabel}
                onCheckedChange={(checked) => save({ ...settings, showPartLabel: checked === true })}
              />
              <FieldLabel htmlFor="showPartLabel" className="font-normal">{t("ce.numerarCortes")}</FieldLabel>
            </Field>
            {settings.showPartLabel && (
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

        <p className="text-xs text-muted-foreground">
          {saving ? "Salvando..." : savedFlash ? "Salvo ✓" : t("vs.mudancasValem")}
        </p>
      </CardContent>
    </Card>
  )
}
