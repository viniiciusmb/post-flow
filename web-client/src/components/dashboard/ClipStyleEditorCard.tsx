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
            {comTemplate ? "seu vídeo" : "vídeo original (16:9)"}
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
          ? "Seu template ao fundo. Ajuste a altura e a posição do vídeo nos controles abaixo."
          : value >= 90
          ? "Bem apertado. Preenche a moldura toda e mostra menos do vídeo original."
          : value <= 10
            ? "Bem amplo. Mostra o vídeo quase inteiro, com fundo desfocado preenchendo a sobra."
            : `Zoom em ${value}%. Arraste as alças pra ajustar.`}
      </p>
    </div>
  )
}

const STYLE_PREVIEW: Record<VideoCaptionStyle, { label: string; render: (text: string) => React.ReactNode }> = {
  classic: {
    label: "Clássica",
    render: (text) => (
      <span style={{ fontFamily: "Arial Black, sans-serif", fontWeight: 900, color: "#fff", WebkitTextStroke: "1.5px #000", fontSize: 15 }}>
        {text}
      </span>
    ),
  },
  bold: {
    label: "Chamativa",
    render: (text) => (
      <span style={{ fontFamily: "Arial Black, sans-serif", fontWeight: 900, color: "#ffd700", WebkitTextStroke: "1.5px #000", fontSize: 17 }}>
        {text}
      </span>
    ),
  },
  minimal: {
    label: "Minimalista",
    render: (text) => (
      <span style={{ fontFamily: "Arial, sans-serif", color: "#fff", WebkitTextStroke: "0.5px #000", fontSize: 13 }}>{text}</span>
    ),
  },
  bubble_dark: {
    label: "Balão escuro",
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
    label: "Balão roxo",
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
    label: "Sem legenda",
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
            <span className="text-xs font-medium">{preview.label}</span>
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
  return (
    <div className="relative rounded-md bg-neutral-900" style={{ width: 240, height: 180 }}>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white/25">corte 9:16</span>
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
        >
          Parte 1
        </button>
      ))}
    </div>
  )
}

export function ClipStyleEditorCard() {
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
      if (!resposta.ok) throw new Error(dados.error || "Não foi possível enviar a imagem.")
      const atualizado = await api.get<ClientVideoSettingsResponse>(`/api/client/video-settings${queryAlvo}`)
      setSettings(atualizado)
      setVersaoTemplate((v) => v + 1)
    } catch (e) {
      setErroTemplate(e instanceof Error ? e.message : "Não foi possível enviar a imagem.")
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
          <IconAdjustmentsHorizontal className="size-4 text-muted-foreground" />
          Estilo visual do corte
        </CardTitle>
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
          <FieldLabel>Aplicar em</FieldLabel>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={alvo} onValueChange={setAlvo}>
              <SelectTrigger className="w-[19rem]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os canais</SelectItem>
                {settings.channels.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {c.name}
                    {c.hasOwnStyle ? " (estilo próprio)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {alvo !== "all" && !settings.usesDefault && (
              <Button variant="outline" size="sm" onClick={voltarAoPadrao}>
                Voltar a seguir todos os canais
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {alvo === "all"
              ? "Vale para todo canal que não tenha um estilo próprio, e para vídeos enviados avulsos."
              : settings.usesDefault
                ? "Este canal segue a configuração de todos os canais. Mexer em qualquer coisa aqui cria um estilo só dele."
                : "Este canal tem estilo próprio e ignora a configuração de todos os canais."}
          </p>
        </Field>

        <ToggleGroup
          type="single"
          variant="outline"
          value={settings.cropStyleMode}
          onValueChange={(next) => next && save({ ...settings, cropStyleMode: next as "auto" | "manual" })}
        >
          <ToggleGroupItem value="auto" className="text-xs">
            Automático
          </ToggleGroupItem>
          <ToggleGroupItem value="manual" className="text-xs">
            Manual
          </ToggleGroupItem>
        </ToggleGroup>

        {settings.cropStyleMode === "manual" && (
          <>
            <Field>
              <FieldLabel>Template de fundo (opcional)</FieldLabel>
              <p className="text-xs text-muted-foreground">
                Envie uma imagem 9:16 (1080x1920) com a sua arte: moldura, marca, publicidade. O vídeo
                é encaixado por cima dela, na altura e na posição que você escolher.
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
                    <span>{enviandoTemplate ? "Enviando..." : settings.hasBackgroundTemplate ? "Trocar imagem" : "Enviar imagem"}</span>
                  </Button>
                </label>
                {settings.hasBackgroundTemplate && (
                  <Button variant="ghost" size="sm" onClick={removerTemplate}>
                    Remover
                  </Button>
                )}
              </div>
              {erroTemplate && <p className="text-xs text-destructive">{erroTemplate}</p>}
            </Field>

            {settings.hasBackgroundTemplate && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel>Altura do vídeo no template</FieldLabel>
                  <Input
                    type="range"
                    min={10}
                    max={100}
                    value={settings.backgroundVideoHeightPercent}
                    onChange={(e) =>
                      setSettings({ ...settings, backgroundVideoHeightPercent: Number(e.target.value) })
                    }
                    onMouseUp={() => save(settings)}
                    onTouchEnd={() => save(settings)}
                  />
                  <p className="text-xs text-muted-foreground">
                    {settings.backgroundVideoHeightPercent}% da altura. O resto fica sendo a sua arte.
                  </p>
                </Field>
                <Field>
                  <FieldLabel>Posição do vídeo</FieldLabel>
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
                      ? "Colado no topo."
                      : settings.backgroundVideoOffsetPercent >= 85
                        ? "Colado na base."
                        : "No meio."}
                  </p>
                </Field>
              </div>
            )}

            <Field>
              <FieldLabel>Enquadramento (arraste as alças)</FieldLabel>
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
              <FieldLabel>Estilo da legenda</FieldLabel>
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
              <FieldLabel htmlFor="showTitle" className="font-normal">
                Mostrar o título no começo do vídeo
              </FieldLabel>
            </Field>

            {settings.showTitle && (
              <>
                <Field>
                  <FieldLabel htmlFor="titleSeconds">Por quantos segundos (1 a 15)</FieldLabel>
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
                  <FieldLabel>Estilo do título</FieldLabel>
                  <StyleGallery
                    options={settings.options.titleStyles}
                    value={settings.titleStyle}
                    onChange={(v) => save({ ...settings, titleStyle: v })}
                    sampleText="Título aqui"
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
              <FieldLabel htmlFor="showPartLabel" className="font-normal">
                Numerar os cortes (Parte 1, Parte 2...) quando o vídeo gerar mais de um
              </FieldLabel>
            </Field>
            {settings.showPartLabel && (
              <Field>
                <FieldLabel>Onde mostrar a numeração</FieldLabel>
                <PartLabelPositionPicker
                  value={settings.partLabelPosition}
                  onChange={(v) => save({ ...settings, partLabelPosition: v })}
                />
              </Field>
            )}
          </>
        )}

        <p className="text-xs text-muted-foreground">
          {saving ? "Salvando..." : savedFlash ? "Salvo ✓" : "Mudanças valem pros próximos vídeos processados."}
        </p>
      </CardContent>
    </Card>
  )
}
