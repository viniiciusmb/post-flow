import { useT } from "@/i18n"
import { dataHora } from "@/lib/formatoLocal"
import { useEffect, useState } from "react"
import { IconRefresh, IconCheck, IconCopy, IconAlertTriangle } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader } from "@/components/dashboard/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import type { SystemError, SystemErrorsResponse } from "@/types/api"

type Filtro = "abertos" | "resolvidos" | "todos"

function quando(iso: string) {
  return dataHora(iso)
}

function ErrorRow({
  erro,
  onRetry,
  onResolve,
  busy,
}: {
  erro: SystemError
  onRetry: () => void
  onResolve: () => void
  busy: boolean
}) {
  const t = useT()
  const [aberto, setAberto] = useState(false)
  const [copiado, setCopiado] = useState(false)

  // O texto que vai ser colado numa conversa pra alguém consertar. Junta tudo
  // que importa num bloco só - copiar campo por campo da tela seria pior.
  async function copiar() {
    const texto = [
      `${t("adm.copiaOperacao")}: ${erro.operationLabel}`,
      erro.entityLabel ? `${t("adm.copiaItem")}: ${erro.entityLabel} #${erro.entityId}` : null,
      `${t("adm.copiaCliente")}: ${erro.clientName ?? t("adm.copiaDoSistema")}`,
      `${t("adm.copiaOcorrencias")}: ${erro.occurrences} (${t("adm.copiaPrimeira")} ${quando(erro.firstSeenAt)}, ${t("adm.copiaUltima")} ${quando(erro.lastSeenAt)})`,
      `${t("adm.copiaResumo")}: ${erro.message}`,
      "",
      erro.detail || t("adm.copiaSemDetalhe"),
    ]
      .filter(Boolean)
      .join("\n")
    await navigator.clipboard.writeText(texto)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{erro.operationLabel}</span>
              {erro.occurrences > 1 && (
                <TonePill tone="danger" dot={false}>
                  {erro.occurrences}x
                </TonePill>
              )}
              {erro.status === "retentando" && <TonePill tone="cyan" spin>{t("adm.tentandoDeNovo")}</TonePill>}
              {erro.status === "resolvido" && (
                <TonePill tone="success" icon={<IconCheck className="size-3.5" />}>
                  Resolvido
                </TonePill>
              )}
            </div>

            <p className="mt-1 text-sm text-muted-foreground">{erro.message}</p>

            <p className="mt-1 text-xs text-muted-foreground">
              {erro.entityLabel && (
                <>
                  {erro.entityLabel} #{erro.entityId} ·{" "}
                </>
              )}
              {erro.clientName || t("adm.doSistema")} · última vez {quando(erro.lastSeenAt)}
              {erro.retryCount > 0 && ` · ${erro.retryCount} tentativa${erro.retryCount > 1 ? "s" : ""}`}
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            {erro.canRetry && erro.status !== "resolvido" && (
              <Button size="sm" onClick={onRetry} disabled={busy} className="gap-1.5">
                <IconRefresh className="size-3.5" />
                {busy ? "Enviando..." : "Tentar novamente"}
              </Button>
            )}
            {erro.status !== "resolvido" && (
              <Button size="sm" variant="outline" onClick={onResolve} disabled={busy}>{t("adm.jaResolvi")}</Button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setAberto((v) => !v)}>
            {aberto ? "Esconder detalhe" : t("adm.verDetalheTecnico")}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={copiar}>
            <IconCopy className="size-3.5" />
            {copiado ? t("comum.copiado") : t("adm.copiarPraEnviar")}
          </Button>
        </div>

        {aberto && (
          <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap">
            {erro.detail || t("adm.semDetalheTecnico")}
          </pre>
        )}
      </CardContent>
    </Card>
  )
}

export function AdminErrorsPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const [data, setData] = useState<SystemErrorsResponse | null>(null)
  const [filtro, setFiltro] = useState<Filtro>("abertos")
  const [busyId, setBusyId] = useState<number | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  async function load(f: Filtro = filtro) {
    const res = await api.get<SystemErrorsResponse>(`/api/admin/errors?status=${f}`)
    setData(res)
  }

  useEffect(() => {
    if (!user) return
    load(filtro)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, filtro])

  if (authLoading || !user) return null

  async function acao(id: number, caminho: "retry" | "resolve") {
    setAviso(null)
    setBusyId(id)
    try {
      await api.post(`/api/admin/errors/${id}/${caminho}`)
      await load()
    } catch (err) {
      setAviso(err instanceof ApiError ? err.message : t("adm.naoConsegiFazerIsso"))
    } finally {
      setBusyId(null)
    }
  }

  return (
    <DashboardLayout user={user} onLogout={logout} title="Erros">
      <PageHeader
        title="Erros"
        description={t("adm.errosDescricao")}
      />

      {aviso && <p className="text-sm text-destructive">{aviso}</p>}

      {data && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ToggleGroup
            type="single"
            variant="outline"
            value={filtro}
            onValueChange={(v) => v && setFiltro(v as Filtro)}
          >
            <ToggleGroupItem value="abertos" className="text-xs">
              Abertos ({data.counts.abertos})
            </ToggleGroupItem>
            <ToggleGroupItem value="resolvidos" className="text-xs">
              Resolvidos ({data.counts.resolvidos})
            </ToggleGroupItem>
            <ToggleGroupItem value="todos" className="text-xs">
              Todos
            </ToggleGroupItem>
          </ToggleGroup>

          {data.counts.abertos > 0 && (
            <span className="text-xs text-muted-foreground">
              {data.counts.ocorrenciasAbertas} ocorrência
              {data.counts.ocorrenciasAbertas > 1 ? "s" : ""} no total
            </span>
          )}
        </div>
      )}

      {!data ? (
        <Skeleton className="h-40" />
      ) : data.errors.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center">
            <IconCheck className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">
              {filtro === "abertos" ? t("adm.nenhumErroEmAberto") : t("adm.nadaPorAqui")}
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Quando alguma operação falhar - sua ou de um cliente - ela aparece nesta lista com o
              botão de tentar de novo.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {data.errors.map((erro) => (
            <ErrorRow
              key={erro.id}
              erro={erro}
              busy={busyId === erro.id}
              onRetry={() => acao(erro.id, "retry")}
              onResolve={() => acao(erro.id, "resolve")}
            />
          ))}
        </div>
      )}

      {data && data.errors.some((e) => !e.canRetry && e.status !== "resolvido") && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <IconAlertTriangle className="mt-px size-3.5 shrink-0" />
          Alguns erros não têm botão de tentar de novo porque não são de uma operação que dê pra
          refazer sozinha (backup, teste de conexão). Esses precisam de correção.
        </p>
      )}
    </DashboardLayout>
  )
}
