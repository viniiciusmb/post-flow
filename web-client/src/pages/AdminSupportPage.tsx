import { useEffect, useState } from "react"
import { IconRefresh } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader } from "@/components/dashboard/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import { dataHora } from "@/lib/formatoLocal"
import { useT } from "@/i18n"
import type { AdminSupportConversation, AdminSupportDetail, SupportConversationStatus } from "@/types/api"

type Filtro = "todas" | SupportConversationStatus

const TOM: Record<SupportConversationStatus, "danger" | "indigo" | "success"> = {
  encaminhada: "danger",
  aberta: "indigo",
  resolvida: "success",
}

// Qual modelo respondeu (a Flora escolhe pela complexidade da pergunta).
const NOME_DO_MODELO: Record<string, string> = {
  "claude-haiku-4-5": "Haiku (simples)",
  "claude-sonnet-5-5": "Sonnet (investigação)",
  "claude-opus-5-5": "Opus (caso difícil)",
}

function Detalhe({ id }: { id: number }) {
  const t = useT()
  const [d, setD] = useState<AdminSupportDetail | null>(null)
  useEffect(() => {
    api.get<AdminSupportDetail>(`/api/admin/support/${id}`).then(setD).catch(() => setD(null))
  }, [id])
  if (!d) return <Skeleton className="h-24 w-full" />
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      {d.messages.map((m) => [
        m.model && (
          <p key={`${m.id}-modelo`} className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {NOME_DO_MODELO[m.model] ?? m.model} · US$ {m.costUsd.toFixed(4)}
          </p>
        ),
        ...m.blocks.map((b, i) => (
          <div key={`${m.id}-${i}`} className="text-sm">
            {b.tipo === "texto" && (
              <p className="whitespace-pre-wrap break-words">
                <span className="font-semibold">{m.role === "user" ? t("suporte.voce") : t("suporte.assistente")}: </span>
                {b.texto}
              </p>
            )}
            {b.tipo === "ferramenta" && (
              <p className="font-mono text-xs text-muted-foreground">
                → {t("suporteAdm.ferramenta")}: {b.nome} {JSON.stringify(b.entrada)}
              </p>
            )}
            {b.tipo === "resultado" && (
              <details className="font-mono text-xs text-muted-foreground">
                <summary className="cursor-pointer">{t("suporteAdm.resultado")}</summary>
                <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2">{b.conteudo}</pre>
              </details>
            )}
          </div>
        )),
      ])}
      {d.refunds.length > 0 && (
        <ul className="mt-2 text-sm">
          {d.refunds.map((r, i) => (
            <li key={i}>
              {t("suporteAdm.minutosDevolvidos", { minutos: r.minutes })} — {r.title ?? `#${r.videoId}`} ({r.reason}, {dataHora(r.createdAt)})
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function AdminSupportPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const [filtro, setFiltro] = useState<Filtro>("todas")
  const [lista, setLista] = useState<AdminSupportConversation[] | null>(null)
  const [aberta, setAberta] = useState<number | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  async function carregar(f: Filtro = filtro) {
    const q = f === "todas" ? "" : `?status=${f}`
    const r = await api.get<{ conversations: AdminSupportConversation[] }>(`/api/admin/support${q}`)
    setLista(r.conversations)
  }

  useEffect(() => {
    if (!user) return
    carregar(filtro)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, filtro])

  if (authLoading || !user) return null

  async function mudarStatus(id: number, status: SupportConversationStatus) {
    setAviso(null)
    try {
      await api.post(`/api/admin/support/${id}/status`, { status })
      await carregar()
    } catch (err) {
      setAviso(err instanceof ApiError ? err.message : t("comum.erroGenerico"))
    }
  }

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("menu.suporte")}>
      <PageHeader
        title={t("menu.suporte")}
        description={t("suporteAdm.descricao")}
        action={
          <Button variant="outline" size="sm" onClick={() => carregar()}>
            <IconRefresh className="size-4" />
          </Button>
        }
      />
      <ToggleGroup type="single" value={filtro} onValueChange={(v) => v && setFiltro(v as Filtro)} variant="outline" className="flex-wrap justify-start">
        <ToggleGroupItem value="todas">{t("suporteAdm.todas")}</ToggleGroupItem>
        <ToggleGroupItem value="encaminhada">{t("suporteAdm.encaminhadas")}</ToggleGroupItem>
        <ToggleGroupItem value="aberta">{t("suporteAdm.abertas")}</ToggleGroupItem>
        <ToggleGroupItem value="resolvida">{t("suporteAdm.resolvidas")}</ToggleGroupItem>
      </ToggleGroup>
      {aviso && <p className="text-sm text-destructive">{aviso}</p>}

      {lista === null ? (
        <Skeleton className="h-32 w-full" />
      ) : lista.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("suporteAdm.vazio")}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {lista.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex flex-col gap-3 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{c.businessName || c.email}</span>
                      <TonePill tone={TOM[c.status]}>{c.status}</TonePill>
                      {c.minutesRefunded > 0 && (
                        <span className="text-xs text-muted-foreground">{t("suporteAdm.minutosDevolvidos", { minutos: c.minutesRefunded })}</span>
                      )}
                    </div>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.email} · {dataHora(c.updatedAt)} · {t("suporteAdm.custo")}: US$ {c.costUsd.toFixed(3)}
                    </p>
                    {c.firstMessage && <p className="mt-1 line-clamp-2 break-words text-sm">{c.firstMessage}</p>}
                    {c.escalationSummary && (
                      <p className="mt-2 rounded-md bg-status-pending/10 px-3 py-2 text-sm">
                        <span className="font-semibold">{t("suporteAdm.resumoParaEquipe")}: </span>
                        {c.escalationSummary}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setAberta(aberta === c.id ? null : c.id)}>
                      {aberta === c.id ? t("suporteAdm.esconder") : t("suporteAdm.verConversa")}
                    </Button>
                    {c.status === "resolvida" ? (
                      <Button variant="outline" size="sm" onClick={() => mudarStatus(c.id, "aberta")}>
                        {t("suporteAdm.reabrir")}
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => mudarStatus(c.id, "resolvida")}>
                        {t("suporteAdm.marcarResolvida")}
                      </Button>
                    )}
                  </div>
                </div>
                {aberta === c.id && <Detalhe id={c.id} />}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </DashboardLayout>
  )
}
