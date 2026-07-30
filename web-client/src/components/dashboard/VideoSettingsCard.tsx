import { useEffect, useState } from "react"
import { IconVideo } from "@tabler/icons-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import type { ClientVideoSettingsResponse } from "@/types/api"

const ASPECT_LABELS: Record<string, string> = {
  "9:16": "9:16 (TikTok/Reels)",
  "1:1": "1:1 (quadrado)",
  "16:9": "16:9 (horizontal)",
  "4:5": "4:5 (retrato)",
}
const FRAMING_LABELS: Record<string, string> = {
  crop: "Cortar as bordas (preenche a tela)",
  blur_pad: "Mostrar o vídeo inteiro (fundo desfocado)",
}
const QUALITY_LABELS: Record<string, string> = {
  high: "Alta (mais nítido, arquivo maior)",
  medium: "Média (mais rápido de gerar)",
}
const CLIP_LENGTH_LABELS: Record<string, string> = {
  short: "Curtos (15–40s)",
  balanced: "Equilibrados (25–90s)",
  long: "Longos (60–180s)",
}
const CLIP_MODE_LABELS: Record<string, string> = {
  ai_choice: "Melhores partes",
  full_video: "Vídeo inteiro",
  fixed_count: "Escolher quantidade",
}
const CLIP_MODE_DESCRIPTIONS: Record<string, string> = {
  ai_choice: "A IA decide quantos cortes fazem sentido para esse vídeo, sem número fixo.",
  full_video: "O vídeo inteiro vira um único corte vertical, sem a IA escolher trecho.",
  fixed_count: "Você escolhe exatamente quantos cortes quer, e a IA escolhe os melhores trechos até esse número.",
}
const DESCRIPTION_MODE_LABELS: Record<string, string> = {
  auto: "IA escreve",
  fixed: "Sempre a mesma",
  none: "Sem descrição",
}

function OptionRow({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  labels: Record<string, string>
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <ToggleGroup
        type="single"
        variant="outline"
        value={value}
        onValueChange={(next) => next && onChange(next)}
        className="flex-wrap"
      >
        {options.map((o) => (
          <ToggleGroupItem key={o} value={o} className="text-xs">
            {labels[o] ?? o}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  )
}

export function VideoSettingsCard() {
  const [settings, setSettings] = useState<ClientVideoSettingsResponse | null>(null)
  const [descriptionDraft, setDescriptionDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    api.get<ClientVideoSettingsResponse>("/api/client/video-settings").then((data) => {
      setSettings(data)
      setDescriptionDraft(data.descriptionTemplate ?? "")
    })
  }, [])

  async function save(next: ClientVideoSettingsResponse) {
    setSettings(next)
    setSaving(true)
    setSavedFlash(false)
    try {
      await api.put<ClientVideoSettingsResponse>("/api/client/video-settings", next)
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
          <IconVideo className="size-4 text-muted-foreground" />
          Qualidade e estilo dos cortes
        </CardTitle>
        <CardDescription>
          Como cada vídeo é cortado e editado automaticamente. 9:16 é o padrão recomendado pro TikTok.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel>Como escolher os cortes</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              value={settings.clipMode}
              onValueChange={(next) => next && save({ ...settings, clipMode: next as never })}
              className="flex-wrap"
            >
              {settings.options.clipModes.map((m) => (
                <ToggleGroupItem key={m} value={m} className="text-xs">
                  {CLIP_MODE_LABELS[m] ?? m}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">{CLIP_MODE_DESCRIPTIONS[settings.clipMode]}</p>
          </Field>

          {settings.clipMode === "fixed_count" && (
            <Field>
              <FieldLabel htmlFor="maxClips">Quantidade de cortes (1 a 30)</FieldLabel>
              <Input
                id="maxClips"
                type="number"
                min={1}
                max={30}
                className="w-24"
                value={settings.maxClips}
                onChange={(e) => save({ ...settings, maxClips: Number(e.target.value) })}
              />
            </Field>
          )}

          <OptionRow
            label="Proporção"
            value={settings.aspectRatio}
            options={settings.options.aspectRatios}
            labels={ASPECT_LABELS}
            onChange={(v) => save({ ...settings, aspectRatio: v as never })}
          />
          <OptionRow
            label="Enquadramento"
            value={settings.framing}
            options={settings.options.framings}
            labels={FRAMING_LABELS}
            onChange={(v) => save({ ...settings, framing: v as never })}
          />
          <OptionRow
            label="Qualidade"
            value={settings.quality}
            options={settings.options.qualities}
            labels={QUALITY_LABELS}
            onChange={(v) => save({ ...settings, quality: v as never })}
          />

          {settings.clipMode !== "full_video" && (
            <OptionRow
              label="Duração de cada corte"
              value={settings.clipLength}
              options={settings.options.clipLengths}
              labels={CLIP_LENGTH_LABELS}
              onChange={(v) => save({ ...settings, clipLength: v as never })}
            />
          )}

          <Field>
            <FieldLabel>Descrição do corte</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              value={settings.descriptionMode}
              onValueChange={(next) => next && save({ ...settings, descriptionMode: next as never })}
              className="flex-wrap"
            >
              {settings.options.descriptionModes.map((m) => (
                <ToggleGroupItem key={m} value={m} className="text-xs">
                  {DESCRIPTION_MODE_LABELS[m] ?? m}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          {settings.descriptionMode === "fixed" && (
            <Field>
              <FieldLabel htmlFor="descriptionTemplate">Texto fixo (usado em todos os cortes)</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="descriptionTemplate"
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  placeholder="Ex: Segue a gente pra mais! #viral"
                />
                <button
                  type="button"
                  onClick={() => save({ ...settings, descriptionTemplate: descriptionDraft })}
                  className="shrink-0 rounded-md border border-input px-3 text-sm font-medium hover:bg-accent"
                >
                  Salvar
                </button>
              </div>
            </Field>
          )}

          <p className="text-xs text-muted-foreground">
            {saving ? "Salvando..." : savedFlash ? "Salvo ✓" : "Mudanças valem pros próximos vídeos processados."}
          </p>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
