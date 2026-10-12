import { useEffect, useState, type ReactNode } from "react"
import { IconBrandGoogleDrive, IconBrandTiktok, IconClockHour4, IconHourglass, IconRadar, IconShare3, IconTrash } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { TikTokAccountSummary, YoutubeChannel } from "@/types/api"
import type { ContaSocial } from "@/components/redes/PainelDaContaSocial"
import { REDES, duracaoCurta } from "@/lib/redes"

/** Uma linha de ajuste: o que é e o que muda, à esquerda; o controle, à direita. */
const TONS = {
  green: "bg-tone-success-wash text-tone-success-ink",
  amber: "bg-amber-500/12 text-amber-700 dark:text-amber-400",
  violet: "bg-tone-violet-wash text-tone-violet-ink",
  ink: "bg-foreground text-background",
  cyan: "bg-tone-cyan-wash text-tone-cyan-ink",
  red: "bg-tone-danger-wash text-tone-danger-ink",
} as const

function Linha({
  titulo,
  texto,
  children,
  className,
  icone,
  tom = "green",
}: {
  titulo: string
  texto: ReactNode
  children: ReactNode
  className?: string
  icone?: ReactNode
  tom?: keyof typeof TONS
}) {
  return (
    <div className={cn("flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8 sm:px-5", className)}>
      <div className="flex min-w-0 gap-3 sm:max-w-[30rem]">
        {icone && <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg", TONS[tom])}>{icone}</span>}
        <div className="min-w-0">
          <p className="text-sm font-medium">{titulo}</p>
          <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{texto}</div>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">{children}</div>
    </div>
  )
}

/** Liga/desliga no formato de interruptor, com o estado escrito ao lado. */
export function Interruptor({
  ligado,
  onClick,
  disabled,
  rotulo,
}: {
  ligado: boolean
  onClick: () => void
  disabled?: boolean
  rotulo: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      disabled={disabled}
      onClick={onClick}
      className="group inline-flex items-center gap-2.5 disabled:opacity-60"
    >
      <span className={cn("text-xs font-medium", ligado ? "text-tone-success-ink" : "text-muted-foreground")}>
        {ligado ? "Ligado" : "Desligado"}
      </span>
      <span
        className={cn(
          "relative h-[22px] w-[38px] rounded-full transition-colors",
          ligado ? "bg-tone-success-ink" : "bg-border",
        )}
      >
        <span
          className={cn(
            "absolute top-[3px] size-4 rounded-full bg-card shadow-sm transition-[left]",
            ligado ? "left-[19px]" : "left-[3px]",
          )}
        />
      </span>
    </button>
  )
}

export function MonitoramentoDoCanal({
  channel,
  tiktokAccounts,
  contasSociais = [],
  destinosSociais = [],
  driveConectado,
  onMudou,
  onRemovido,
}: {
  channel: YoutubeChannel
  tiktokAccounts: TikTokAccountSummary[]
  /** Contas das outras redes (painel novo) e as que já recebem deste canal. */
  contasSociais?: ContaSocial[]
  destinosSociais?: number[]
  driveConectado: boolean
  onMudou: () => Promise<void> | void
  onRemovido: () => void
}) {
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState<string | null>(null)
  const [freio, setFreio] = useState(channel.processOnlyWhenQueueClear)
  const [limite, setLimite] = useState(channel.maxVideoMinutes === null ? "" : String(channel.maxVideoMinutes))
  const [autoDrive, setAutoDrive] = useState(false)
  const [confirmandoRemocao, setConfirmandoRemocao] = useState(false)

  async function salvar(chave: string, acao: () => Promise<unknown>) {
    setErro(null)
    setSalvando(chave)
    try {
      await acao()
      await onMudou()
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível salvar. Tente de novo.")
      throw err
    } finally {
      setSalvando(null)
    }
  }

  async function salvarLimite(valor: string) {
    const minutos = valor.trim() === "" ? null : Number(valor)
    if (minutos !== null && (!Number.isFinite(minutos) || minutos <= 0)) return
    if (minutos === channel.maxVideoMinutes) return
    setLimite(minutos === null ? "" : String(minutos))
    await salvar("limite", () =>
      api.put(`/api/client/youtube-channels/${channel.id}/max-video-minutes`, { maxVideoMinutes: minutos }),
    ).catch(() => setLimite(channel.maxVideoMinutes === null ? "" : String(channel.maxVideoMinutes)))
  }

  const contaVinculada = tiktokAccounts.find((a) => a.id === channel.tiktokAccountId) ?? null
  const [ligadas, setLigadas] = useState<number[]>(destinosSociais)
  // A lista chega do servidor depois que a aba pode já ter aberto: acompanha o
  // que veio, senão as caixas ficariam desmarcadas com o canal publicando.
  const chaveDestinos = destinosSociais.join(",")
  useEffect(() => {
    setLigadas(chaveDestinos ? chaveDestinos.split(",").map(Number) : [])
  }, [chaveDestinos])
  const [avisoRedes, setAvisoRedes] = useState<string | null>(null)

  async function alternarConta(id: number, ligar: boolean) {
    const antes = ligadas
    const novas = ligar ? [...new Set([...ligadas, id])] : ligadas.filter((x) => x !== id)
    setLigadas(novas)
    setAvisoRedes(null)
    try {
      await salvar("redes", async () => {
        const r = await api.put<{ enfileirados: number; longos: number }>(`/api/client/social-accounts/canais/${channel.id}`, { socialAccountIds: novas })
        if (ligar && (r.enfileirados || r.longos)) {
          const conta = contasSociais.find((c) => c.id === id)
          const limite = conta ? REDES[conta.network].duracaoMaxS : 0
          setAvisoRedes(
            `${r.enfileirados} corte${r.enfileirados === 1 ? "" : "s"} já pronto${r.enfileirados === 1 ? "" : "s"} entr${r.enfileirados === 1 ? "ou" : "aram"} na fila.` +
              (r.longos ? ` ${r.longos} ficaram de fora por passar de ${duracaoCurta(limite)}.` : ""),
          )
        }
      })
    } catch {
      setLigadas(antes)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {erro && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>
      )}
      <Card className="gap-0 divide-y divide-border py-0">
        <Linha
          titulo="Pegar vídeos novos sozinho"
          icone={<IconRadar className="size-5" />}
          tom="green"
          texto={
            channel.isActive
              ? "O canal é conferido a cada 20 minutos. Cada vídeo novo publicado é baixado e cortado sem você fazer nada."
              : "Desligado: vídeos novos não entram. Você ainda pode cortar o último vídeo na mão."
          }
        >
          <Interruptor
            ligado={channel.isActive}
            rotulo="Pegar vídeos novos sozinho"
            disabled={salvando === "ativo"}
            onClick={() =>
              void salvar("ativo", () =>
                api.post(`/api/client/youtube-channels/${channel.id}/active`, { isActive: !channel.isActive }),
              ).catch(() => {})
            }
          />
        </Linha>

        <Linha
          titulo="Esperar a fila de publicação esvaziar"
          icone={<IconHourglass className="size-5" />}
          tom="amber"
          texto="Só pega o próximo vídeo quando falta no máximo 1 corte pra publicar. Evita acumular cortes de assunto velho em canal que publica todo dia."
        >
          <Interruptor
            ligado={freio}
            rotulo="Esperar a fila de publicação esvaziar"
            disabled={salvando === "freio"}
            onClick={() => {
              const novo = !freio
              setFreio(novo)
              void salvar("freio", () => api.post(`/api/client/youtube-channels/${channel.id}/queue-gate`, { ativo: novo })).catch(
                () => setFreio(!novo),
              )
            }}
          />
        </Linha>

        <Linha
          titulo="Limite de duração"
          icone={<IconClockHour4 className="size-5" />}
          tom="violet"
          texto={
            channel.maxVideoMinutes
              ? `Vídeos com mais de ${channel.maxVideoMinutes} min ficam de fora e aparecem com um aviso. Você ainda pode cortar cada um na mão.`
              : "Sem limite: qualquer vídeo novo entra, até live de horas. Escolha um teto pra não gastar minutos com vídeo longo."
          }
        >
          <div className="flex items-center gap-1.5">
            <Input
              type="number"
              min={1}
              max={1440}
              inputMode="numeric"
              placeholder="—"
              aria-label="Limite em minutos"
              className="h-8 w-20 text-center font-mono"
              value={limite}
              disabled={salvando === "limite"}
              onChange={(e) => setLimite(e.target.value)}
              onBlur={() => void salvarLimite(limite)}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur()
              }}
            />
            <span className="text-xs text-muted-foreground">min</span>
          </div>
          <div className="flex flex-wrap gap-1 sm:justify-end">
            {[15, 30, 60, 90].map((m) => (
              <button
                key={m}
                type="button"
                disabled={salvando === "limite"}
                onClick={() => void salvarLimite(String(m))}
                className={cn(
                  "rounded-md border px-2 py-1 font-mono text-[11px] transition-colors",
                  channel.maxVideoMinutes === m
                    ? "border-tone-violet-ink bg-tone-violet-ink text-white"
                    : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                {m}
              </button>
            ))}
            {channel.maxVideoMinutes !== null && (
              <button
                type="button"
                onClick={() => void salvarLimite("")}
                className="rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                sem limite
              </button>
            )}
          </div>
        </Linha>

        <Linha
          titulo="Publicar no TikTok"
          icone={<IconBrandTiktok className="size-5" />}
          tom="ink"
          texto={
            tiktokAccounts.length === 0 ? (
              <>
                Nenhuma conta conectada. <a href="/client/social?rede=tiktok" className="font-medium text-foreground underline underline-offset-2">Conectar em Redes sociais</a>.
              </>
            ) : contaVinculada ? (
              contaVinculada.autoPostEnabled ? (
                "Os cortes deste canal entram na fila desta conta e saem nos horários dela."
              ) : (
                <>
                  Os cortes vão pra fila desta conta, mas a publicação automática dela está desligada.{" "}
                  <a href="/client/social?rede=tiktok" className="font-medium text-foreground underline underline-offset-2">Ajustar</a>
                </>
              )
            ) : (
              "Sem conta escolhida, os cortes ficam prontos aqui e não são publicados."
            )
          }
        >
          {tiktokAccounts.length > 0 && (
            <Select
              value={channel.tiktokAccountId ? String(channel.tiktokAccountId) : "none"}
              disabled={salvando === "tiktok"}
              onValueChange={(v) =>
                void salvar("tiktok", () =>
                  api.post(`/api/client/youtube-channels/${channel.id}/tiktok-account`, {
                    tiktokAccountId: v === "none" ? null : Number(v),
                  }),
                ).catch(() => {})
              }
            >
              <SelectTrigger size="sm" className="w-56 text-xs">
                <IconBrandTiktok className="size-3.5 text-muted-foreground" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Não publicar</SelectItem>
                {tiktokAccounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Linha>

        {contasSociais !== undefined && (
          <Linha
            titulo="Publicar também em"
            icone={<IconShare3 className="size-5" />}
            tom="violet"
            texto={
              contasSociais.length === 0 ? (
                <>
                  Instagram, Facebook, YouTube e outras redes.{" "}
                  <a href="/client/social" className="font-medium text-foreground underline underline-offset-2">Conectar em Redes sociais</a>.
                </>
              ) : (
                <>
                  Cada corte novo entra também na fila das contas marcadas, com os horários de cada uma. Corte mais longo do que a rede aceita não vai pra ela.
                  {avisoRedes && <span className="mt-1 block text-foreground">{avisoRedes}</span>}
                </>
              )
            }
          >
            {contasSociais.length > 0 && (
              <div className="flex w-full flex-col gap-1.5 sm:w-64">
                {contasSociais.map((c) => {
                  const r = REDES[c.network]
                  const on = ligadas.includes(c.id)
                  return (
                    <label
                      key={c.id}
                      className={cn("flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs", on ? "border-foreground bg-muted/40" : "border-border")}
                    >
                      <Checkbox checked={on} disabled={salvando === "redes"} onCheckedChange={(v) => void alternarConta(c.id, v === true)} />
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full text-white" style={{ background: r.fundo }}>
                        <r.Icone className="size-2.5" />
                      </span>
                      <span className="min-w-0 truncate">{c.displayName || c.username}</span>
                      <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">até {duracaoCurta(r.duracaoMaxS)}</span>
                    </label>
                  )
                })}
              </div>
            )}
          </Linha>
        )}

        <Linha
          titulo="Enviar ao Google Drive"
          icone={<IconBrandGoogleDrive className="size-5" />}
          tom="cyan"
          texto={
            !driveConectado ? (
              <>
                Conecte o Drive em <a href="/client/settings" className="font-medium text-foreground underline underline-offset-2">Configurações</a> pra receber os cortes numa pasta.
              </>
            ) : channel.exportFolder ? (
              <>
                Pasta <span className="font-mono text-foreground">{channel.exportFolder.name ?? channel.exportFolder.id}</span>.{" "}
                {channel.driveExportMode === "auto"
                  ? "Todo corte pronto vai pra lá sozinho."
                  : "Você escolhe corte a corte quais enviar."}
              </>
            ) : (
              "Opcional. Criamos uma pasta com o nome do canal no seu Drive e os cortes vão pra ela."
            )
          }
        >
          {driveConectado &&
            (channel.exportFolder ? (
              <div className="flex flex-wrap gap-2 sm:justify-end">
                <Interruptor
                  ligado={channel.driveExportMode === "auto"}
                  rotulo="Enviar todo corte pronto sozinho"
                  disabled={salvando === "drive"}
                  onClick={() =>
                    void salvar("drive", () =>
                      api.post(`/api/client/youtube-channels/${channel.id}/drive-export-mode`, {
                        mode: channel.driveExportMode === "auto" ? "manual" : "auto",
                      }),
                    ).catch(() => {})
                  }
                />
              </div>
            ) : (
              <div className="flex flex-col items-start gap-2 sm:items-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  disabled={salvando === "pasta"}
                  onClick={() =>
                    void salvar("pasta", () =>
                      api.post(`/api/client/youtube-channels/${channel.id}/export-folder`, { autoMode: autoDrive }),
                    ).catch(() => {})
                  }
                >
                  <IconBrandGoogleDrive className="size-3.5" />
                  {salvando === "pasta" ? "Criando pasta..." : "Criar pasta no Drive"}
                </Button>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Checkbox checked={autoDrive} onCheckedChange={(c) => setAutoDrive(c === true)} />
                  Enviar todo corte sozinho
                </label>
              </div>
            ))}
        </Linha>
      </Card>

      <Card className="gap-0 py-0">
        <Linha
          titulo="Remover canal"
          icone={<IconTrash className="size-5" />}
          tom="red"
          texto="Para de acompanhar o canal e apaga do Post Flow os vídeos e cortes dele. O que já foi publicado continua nas redes."
        >
          {confirmandoRemocao ? (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setConfirmandoRemocao(false)}>
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="destructive"
                disabled={salvando === "remover"}
                onClick={async () => {
                  setSalvando("remover")
                  try {
                    await api.delete(`/api/client/youtube-channels/${channel.id}`)
                    onRemovido()
                  } catch (err) {
                    setErro(err instanceof ApiError ? err.message : "Não foi possível remover o canal.")
                  } finally {
                    setSalvando(null)
                  }
                }}
              >
                Remover de vez
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="gap-1.5 text-destructive" onClick={() => setConfirmandoRemocao(true)}>
              <IconTrash className="size-3.5" />
              Remover canal
            </Button>
          )}
        </Linha>
      </Card>
    </div>
  )
}
