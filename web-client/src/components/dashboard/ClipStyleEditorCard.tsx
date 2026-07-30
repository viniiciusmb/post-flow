import { useEffect, useRef, useState } from "react"
import { IconAdjustmentsHorizontal } from "@tabler/icons-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { ClientVideoSettingsResponse, PartLabelPosition, VideoCaptionStyle } from "@/types/api"

// Mesma formula do backend (videoEditingService.buildFilter) assumindo uma
// fonte 16:9 tipica - so pra desenhar a caixa de recorte do tamanho certo,
// nao afeta o render de verdade (o ffmpeg usa o video real).
const TIGHT_CROP_RATIO = (9 / 16) * (9 / 16) // ~0.3164
function zoomToBoxWidthPercent(zoom: number) {
  return 1 - (1 - TIGHT_CROP_RATIO) * (zoom / 100)
}
function boxWidthPercentToZoom(widthPercent: number) {
  const z = (1 - widthPercent) / (1 - TIGHT_CROP_RATIO)
  return Math.round(Math.min(100, Math.max(0, z * 100)))
}

const PREVIEW_WIDTH = 320
const PREVIEW_HEIGHT = 180

function CropZoomEditor({ value, onChange, onCommit }: { value: number; onChange: (v: number) => void; onCommit: (v: number) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState(false)
  const boxWidthPercent = zoomToBoxWidthPercent(value)
  const boxWidthPx = boxWidthPercent * PREVIEW_WIDTH

  function handlePointerDown(e: React.PointerEvent) {
    e.preventDefault()
    setDragging(true)
    ;(e.target as Element).setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragging || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const halfWidth = Math.abs(e.clientX - centerX)
    const widthPercent = Math.min(1, Math.max(TIGHT_CROP_RATIO, (halfWidth * 2) / rect.width))
    onChange(boxWidthPercentToZoom(widthPercent))
  }

  function handlePointerUp() {
    if (!dragging) return
    setDragging(false)
    onCommit(value)
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        ref={containerRef}
        className="relative select-none rounded-md bg-black"
        style={{ width: PREVIEW_WIDTH, height: PREVIEW_HEIGHT }}
      >
        <div className="absolute inset-0 flex items-center justify-center text-[10px] text-white/40">
          vídeo original (16:9)
        </div>
        <div
          className="absolute top-0 flex h-full items-center justify-center border-2 border-white bg-white/10"
          style={{ width: boxWidthPx, left: (PREVIEW_WIDTH - boxWidthPx) / 2 }}
        >
          <span className="pointer-events-none rounded bg-black/60 px-1 text-[9px] text-white">9:16</span>
          <div
            className="absolute top-0 left-0 h-full w-3 cursor-ew-resize"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
          <div
            className="absolute top-0 right-0 h-full w-3 cursor-ew-resize"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {value >= 90
          ? "Bem apertado - preenche a tela toda, mostra menos do vídeo original."
          : value <= 10
            ? "Bem amplo - mostra o vídeo original quase inteiro, com fundo desfocado nas bordas."
            : `Zoom em ${value}% - arraste as bordas da caixa branca pra ajustar.`}
      </p>
    </div>
  )
}

const CAPTION_PREVIEW: Record<VideoCaptionStyle, { label: string; render: (text: string) => React.ReactNode }> = {
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

function CaptionStyleGallery({
  options,
  value,
  onChange,
}: {
  options: VideoCaptionStyle[]
  value: VideoCaptionStyle
  onChange: (v: VideoCaptionStyle) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {options.map((style) => {
        const preview = CAPTION_PREVIEW[style]
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
              {preview.render("Exemplo")}
            </div>
            <span className="text-xs font-medium">{preview.label}</span>
          </button>
        )
      })}
    </div>
  )
}

const POSITION_GRID: PartLabelPosition[][] = [
  ["top_left", "top_center", "top_right"],
  ["bottom_left", "bottom_center", "bottom_right"],
]

function PartLabelPositionPicker({ value, onChange }: { value: PartLabelPosition; onChange: (v: PartLabelPosition) => void }) {
  return (
    <div className="flex flex-col gap-1.5" style={{ width: 160 }}>
      {POSITION_GRID.map((row, i) => (
        <div key={i} className="flex justify-between gap-1.5">
          {row.map((pos) => (
            <button
              key={pos}
              type="button"
              onClick={() => onChange(pos)}
              className={cn(
                "h-9 flex-1 rounded-md border text-[10px]",
                value === pos ? "border-primary bg-primary/10" : "border-border hover:bg-accent"
              )}
              title={pos}
            >
              ●
            </button>
          ))}
        </div>
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
          Automático usa nosso padrão (recorte central 9:16, legenda clássica, sem numeração). Manual te dá controle
          total sobre enquadramento, legenda e numeração de parte.
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
              <FieldLabel>Enquadramento (arraste as bordas)</FieldLabel>
              <CropZoomEditor
                value={zoomDraft}
                onChange={setZoomDraft}
                onCommit={(v) => save({ ...settings, cropZoomPercent: v })}
              />
            </Field>

            <Field>
              <FieldLabel>Estilo da legenda e do título</FieldLabel>
              <CaptionStyleGallery
                options={settings.options.captionStyles}
                value={settings.captionStyle}
                onChange={(v) => save({ ...settings, captionStyle: v })}
              />
            </Field>

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
