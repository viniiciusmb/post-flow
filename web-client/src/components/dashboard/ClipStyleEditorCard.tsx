import { useEffect, useRef, useState } from "react"
import { IconAdjustmentsHorizontal } from "@tabler/icons-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
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

function CropZoomEditor({ value, onChange, onCommit }: { value: number; onChange: (v: number) => void; onCommit: (v: number) => void }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const videoHeight = videoHeightForZoom(value)
  const videoWidth = videoHeight * (16 / 9)
  const videoLeftInFrame = (FRAME_WIDTH - videoWidth) / 2

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
          className="absolute overflow-hidden rounded-md border-2 border-white bg-black"
          style={{ left: FRAME_LEFT, width: FRAME_WIDTH, height: FRAME_HEIGHT }}
        >
          <div
            className="absolute flex items-center justify-center bg-neutral-700 text-center text-[10px] text-white/70"
            style={{ width: videoWidth, height: videoHeight, left: videoLeftInFrame, top: (FRAME_HEIGHT - videoHeight) / 2 }}
          >
            vídeo original (16:9)
          </div>
        </div>

        {/* Alças de arrastar - fora da moldura (que tem overflow hidden), senao
            ficariam impossiveis de clicar quando o video passa das bordas. */}
        <div
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
        />
      </div>
      <p className="max-w-[220px] text-center text-xs text-muted-foreground">
        {value >= 90
          ? "Bem apertado - preenche a moldura toda, mostra menos do vídeo original."
          : value <= 10
            ? "Bem amplo - mostra o vídeo original quase inteiro, com fundo desfocado preenchendo a sobra."
            : `Zoom em ${value}% - arraste as alças roxas pra ajustar.`}
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

  useEffect(() => {
    api.get<ClientVideoSettingsResponse>("/api/client/video-settings").then((data) => {
      setSettings(data)
      setZoomDraft(data.cropZoomPercent)
    })
  }, [])

  async function save(next: ClientVideoSettingsResponse) {
    setSettings(next)
    setSaving(true)
    setSavedFlash(false)
    try {
      const updated = await api.put<ClientVideoSettingsResponse>("/api/client/video-settings", next)
      setSettings(updated)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  if (!settings) return <Skeleton className="h-96" />

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
              <FieldLabel>Enquadramento (arraste as alças)</FieldLabel>
              <CropZoomEditor
                value={zoomDraft}
                onChange={setZoomDraft}
                onCommit={(v) => save({ ...settings, cropZoomPercent: v })}
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
