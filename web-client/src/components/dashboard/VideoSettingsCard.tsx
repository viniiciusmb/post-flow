import { useT, type ChaveDeTraducao } from "@/i18n"
import { useEffect, useState } from "react"
import { IconVideo } from "@tabler/icons-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api } from "@/lib/api"
import type { ClientVideoSettingsResponse } from "@/types/api"

const ASPECT_LABELS: Record<string, ChaveDeTraducao> = {
  "9:16": "vs.aspect916",
  "1:1": "vs.aspect11",
  "16:9": "vs.aspect169",
  "4:5": "vs.aspect45",
}
const FRAMING_LABELS: Record<string, ChaveDeTraducao> = {
  crop: "vs.cortarBordas",
  blur_pad: "vs.mostrarInteiro",
}
// Todos guardam a CHAVE de tradução: são montados quando o módulo carrega,
// antes de existir idioma escolhido.
const QUALITY_LABELS: Record<string, ChaveDeTraducao> = {
  high: "vs.alta",
  medium: "vs.media",
}
const CLIP_LENGTH_LABELS: Record<string, ChaveDeTraducao> = {
  short: "vs.curtos",
  balanced: "vs.equilibrados",
  long: "vs.longos",
}
const CLIP_MODE_LABELS: Record<string, ChaveDeTraducao> = {
  ai_choice: "vs.melhoresPartes",
  full_video: "vs.videoInteiro",
  fixed_count: "vs.escolherQuantidade",
}
const CLIP_MODE_DESCRIPTIONS: Record<string, ChaveDeTraducao> = {
  ai_choice: "vs.iaDecide",
  full_video: "vs.videoInteiroTexto",
  fixed_count: "vs.quantidadeFixaTexto",
}
const DESCRIPTION_MODE_LABELS: Record<string, ChaveDeTraducao> = {
  auto: "vs.iaEscreve",
  fixed: "vs.sempreAMesma",
  none: "vs.semDescricao",
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
  labels: Record<string, ChaveDeTraducao>
  onChange: (value: string) => void
}) {
  const t = useT()
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
            {labels[o] ? t(labels[o]) : o}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  )
}

export function VideoSettingsCard() {
  const t = useT()
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

  // Só os campos que ESTE cartão edita. A mesma tela é gravada por dois
  // cartões, e mandar o objeto inteiro fazia este aqui reenviar a cópia que
  // carregou quando a página abriu — apagando o estilo, a fonte, a altura e a
  // cor que o cliente tinha acabado de escolher no cartão de estilo visual.
  // O servidor preserva o que não vier no corpo.
  const MEUS_CAMPOS = [
    "aspectRatio",
    "framing",
    "quality",
    "clipLength",
    "clipMode",
    "maxClips",
    "descriptionMode",
    "descriptionTemplate",
  ] as const

  async function save(next: ClientVideoSettingsResponse) {
    setSettings(next)
    setSaving(true)
    setSavedFlash(false)
    try {
      const corpo = Object.fromEntries(MEUS_CAMPOS.map((k) => [k, next[k]]))
      await api.put<ClientVideoSettingsResponse>("/api/client/video-settings", corpo)
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
          <IconVideo className="size-4 text-muted-foreground" />{t("vs.titulo")}</CardTitle>
        <CardDescription>{t("vs.descricao")}</CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
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

          {/* A quantidade vale também no modo "melhores partes": ali ela é o
              TETO de cortes que a IA pode gerar. Antes só aparecia no modo de
              quantidade fixa, e quem escolhia "melhores partes" não tinha como
              limitar - um vídeo longo virava 20 e poucos cortes sem aviso.
              Só "vídeo inteiro" dispensa, porque ali sempre sai 1. */}
          {settings.clipMode !== "full_video" && (
            <Field>
              <FieldLabel htmlFor="maxClips">{t("vs.quantidadeCortes")}</FieldLabel>
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
            label={t("vs.proporcao")}
            value={settings.aspectRatio}
            options={settings.options.aspectRatios}
            labels={ASPECT_LABELS}
            onChange={(v) => save({ ...settings, aspectRatio: v as never })}
          />
          <OptionRow
            label={t("vs.enquadramento")}
            value={settings.framing}
            options={settings.options.framings}
            labels={FRAMING_LABELS}
            onChange={(v) => save({ ...settings, framing: v as never })}
          />
          <OptionRow
            label={t("vs.qualidade")}
            value={settings.quality}
            options={settings.options.qualities}
            labels={QUALITY_LABELS}
            onChange={(v) => save({ ...settings, quality: v as never })}
          />

          {settings.clipMode !== "full_video" && (
            <OptionRow
              label={t("vs.duracaoCadaCorte")}
              value={settings.clipLength}
              options={settings.options.clipLengths}
              labels={CLIP_LENGTH_LABELS}
              onChange={(v) => save({ ...settings, clipLength: v as never })}
            />
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
                <button
                  type="button"
                  onClick={() => save({ ...settings, descriptionTemplate: descriptionDraft })}
                  className="shrink-0 rounded-md border border-input px-3 text-sm font-medium hover:bg-accent"
                >{t("comum.salvar")}</button>
              </div>
            </Field>
          )}

          <p className="text-xs text-muted-foreground">
            {saving ? "Salvando..." : savedFlash ? "Salvo ✓" : t("vs.mudancasValem")}
          </p>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}
