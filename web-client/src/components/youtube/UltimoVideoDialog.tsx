import { useEffect, useState } from "react"
import { IconMovie } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, ApiError } from "@/lib/api"
import { useI18n, useT } from "@/i18n"
import { nomeDeIdioma } from "@/lib/nomeDeIdioma"
import type { LatestChannelVideo } from "@/types/api"

export type PedidoDeUltimoVideo = { channelId: number; video: LatestChannelVideo; recemConectado?: boolean }

export function duracao(seconds: number | null) {
  if (!seconds) return null
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`
}

/**
 * "Cortar o vídeo mais recente do canal": o mesmo pop-up do cadastro do canal
 * e do botão "Cortar último vídeo". A escolha de idioma (canal dublado) mora
 * aqui porque é o único momento em que perguntar sai barato, e ela é gravada
 * nos DOIS caminhos (aceitar e recusar): é sobre o canal, não sobre o vídeo.
 */
export function UltimoVideoDialog({
  pedido,
  onFechar,
  onProcessado,
}: {
  pedido: PedidoDeUltimoVideo | null
  onFechar: () => void
  onProcessado: () => void
}) {
  const t = useT()
  const { idioma } = useI18n()
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [idiomaEscolhido, setIdiomaEscolhido] = useState("original")

  useEffect(() => {
    setErro(null)
    setIdiomaEscolhido(pedido?.video.audioLanguageSuggestion || "original")
  }, [pedido])

  async function salvarIdioma() {
    if (!pedido || pedido.video.audioLanguages.length < 2) return
    await api.put(`/api/client/youtube-channels/${pedido.channelId}/audio-language`, { audioLanguage: idiomaEscolhido })
  }

  async function processar() {
    if (!pedido) return
    setEnviando(true)
    setErro(null)
    try {
      await salvarIdioma()
      await api.post(`/api/client/youtube-channels/${pedido.channelId}/process-latest-video`, {})
      onProcessado()
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t("canais.naoFoiPossivelProcessar"))
    } finally {
      setEnviando(false)
    }
  }

  const v = pedido?.video

  return (
    <Dialog open={pedido !== null} onOpenChange={(aberto) => !aberto && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{pedido?.recemConectado ? "Canal conectado. Cortar o vídeo mais recente?" : "Cortar o vídeo mais recente"}</DialogTitle>
          <DialogDescription>
            {pedido?.recemConectado
              ? "A partir de agora, cada vídeo novo do canal entra sozinho. Este aqui já foi publicado, então só entra se você mandar."
              : "O vídeo é baixado, cortado com o estilo deste canal e fica pronto pra publicar."}
          </DialogDescription>
        </DialogHeader>
        {erro && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>
        )}
        {v && (
          <div className="flex gap-3 rounded-lg border border-border p-3">
            <div className="h-16 w-28 shrink-0 overflow-hidden rounded-md bg-muted">
              {v.thumbnailUrl ? (
                <img src={v.thumbnailUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <IconMovie className="size-5 text-muted-foreground" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 text-sm font-medium">{v.title}</p>
              {duracao(v.durationSeconds) && (
                <p className="mt-1 font-mono text-xs text-muted-foreground">{duracao(v.durationSeconds)}</p>
              )}
            </div>
          </div>
        )}
        {v && v.audioLanguages.length > 1 && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3">
            <p className="text-sm font-medium">{t("canais.idiomaDoCanal")}</p>
            <p className="text-xs text-muted-foreground">{t("canais.idiomaDoCanalTexto")}</p>
            <Select value={idiomaEscolhido} onValueChange={(x) => x && setIdiomaEscolhido(x)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="original">{t("canais.idiomaOriginal")}</SelectItem>
                {v.audioLanguages.map((codigo) => (
                  <SelectItem key={codigo} value={codigo}>
                    {nomeDeIdioma(codigo, idioma)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {v && v.disponivel === false && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t("canais.videoIndisponivelAgora")}
          </p>
        )}
        {v && v.jaNoSistema && (
          <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t("canais.videoJaEstaNoSistema", { status: v.jaNoSistema.status })}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={enviando}
            onClick={async () => {
              await salvarIdioma().catch(() => {})
              onFechar()
            }}
          >
            {erro ? "Fechar" : pedido?.recemConectado ? "Não, só os próximos" : "Agora não"}
          </Button>
          <Button onClick={processar} disabled={enviando || v?.disponivel === false}>
            {enviando ? "Enviando..." : erro ? "Tentar de novo" : "Cortar este vídeo"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
