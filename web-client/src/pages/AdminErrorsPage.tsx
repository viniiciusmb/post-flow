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

type Ocorrencia = {
  id: number
  quando: string
  mensagem: string
  detalhe: string | null
  contexto: Record<string, unknown> | null
  cliente: string | null
}

function textoDaOcorrencia(o: Ocorrencia) {
  return [
    `${quando(o.quando)}${o.cliente ? ` - ${o.cliente}` : ""} - ${o.mensagem}`,
    o.contexto ? `Contexto:\n${JSON.stringify(o.contexto, null, 2)}` : null,
    o.detalhe ? `Detalhe:\n${o.detalhe}` : null,
  ]
    .filter(Boolean)
    .join("\n")
}

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
  // Cada vez que o erro aconteceu, com o contexto inteiro (conta, rede,
  // arquivo, etapa, resposta crua da API). Carregado só ao abrir.
  const [ocorrencias, setOcorrencias] = useState<Ocorrencia[] | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function carregarOcorrencias() {
    setCarregando(true)
    try {
      const r = await api.get<{ ocorrencias: Ocorrencia[] }>(`/api/admin/errors/${erro.id}/ocorrencias`)
      setOcorrencias(r.ocorrencias)
      return r.ocorrencias
    } catch {
      setOcorrencias([])
      return []
    } finally {
      setCarregando(false)
    }
  }

  async function alternar() {
    const abrir = !aberto
    setAberto(abrir)
    if (abrir && !ocorrencias) await carregarOcorrencias()
  }

  // O texto que vai ser colado numa conversa pra alguém consertar. Junta tudo
  // que importa num bloco só - copiar campo por campo da tela seria pior.
  async function copiar() {
    const lista = ocorrencias ?? (await carregarOcorrencias())
    const texto = [
      `${t("adm.copiaOperacao")}: ${erro.operationLabel}`,
      erro.entityLabel ? `${t("adm.copiaItem")}: ${erro.entityLabel}${erro.entityId ? ` #${erro.entityId}` : ""}` : null,
      `${t("adm.copiaCliente")}: ${erro.clientName ?? t("adm.copiaDoSistema")}`,
      `${t("adm.copiaOcorrencias")}: ${erro.occurrences} (${t("adm.copiaPrimeira")} ${quando(erro.firstSeenAt)}, ${t("adm.copiaUltima")} ${quando(erro.lastSeenAt)})`,
      `${t("adm.copiaResumo")}: ${erro.message}`,
      "",
      erro.detail || t("adm.copiaSemDetalhe"),
      // As 5 ocorrências mais recentes com o contexto: é o que permite comparar
      // uma vez com a outra sem abrir a tela.
      ...(lista.length ? ["", "=== Ocorrências mais recentes ===", ...lista.slice(0, 5).map((o) => `\n${textoDaOcorrencia(o)}`)] : []),
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
                  {erro.entityLabel}
                  {erro.entityId ? ` #${erro.entityId}` : ""} ·{" "}
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
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={alternar}>
            {aberto ? "Esconder detalhe" : t("adm.verDetalheTecnico")}
          </Button>
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={copiar}>
            <IconCopy className="size-3.5" />
            {copiado ? t("comum.copiado") : t("adm.copiarPraEnviar")}
          </Button>
        </div>

        {aberto && (
          <div className="flex flex-col gap-2">
            <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-muted/40 p-3 text-[11.5px] leading-relaxed whitespace-pre-wrap">
              {erro.detail || t("adm.semDetalheTecnico")}
            </pre>
            <p className="text-xs font-medium">
              Ocorrências {ocorrencias ? `(${ocorrencias.length}${ocorrencias.length === 50 ? " mais recentes" : ""})` : ""}
            </p>
            {carregando && <Skeleton className="h-16" />}
            {ocorrencias && ocorrencias.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Sem ocorrências guardadas (este erro é anterior ao registro detalhado).
              </p>
            )}
            {ocorrencias?.map((o) => (
              <details key={o.id} className="rounded-lg border border-border bg-muted/20 p-2.5 text-xs">
                <summary className="cursor-pointer break-words">
                  <span className="tabular-nums text-muted-foreground">{quando(o.quando)}</span>
                  {o.cliente && <span className="text-muted-foreground"> · {o.cliente}</span>} · {o.mensagem}
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/40 p-2 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                  {o.contexto ? JSON.stringify(o.contexto, null, 2) : "Sem contexto."}
                  {o.detalhe && o.detalhe !== erro.detail ? `\n\n${o.detalhe}` : ""}
                </pre>
              </details>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// /admin/errors-teste mostra só os erros das novidades em teste (painel novo):
// redes sociais novas, feed, lives, telas novas. /admin/errors continua igual.
const EM_TESTE = typeof window !== "undefined" && window.location.pathname.startsWith("/admin/errors-teste")

export function AdminErrorsPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const [data, setData] = useState<SystemErrorsResponse | null>(null)
  const [filtro, setFiltro] = useState<Filtro>("abertos")
  const [busyId, setBusyId] = useState<number | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  async function load(f: Filtro = filtro) {
    const res = await api.get<SystemErrorsResponse>(`/api/admin/errors?status=${f}${EM_TESTE ? "&grupo=teste" : ""}`)
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
    <DashboardLayout user={user} onLogout={logout} title={EM_TESTE ? "Limites e vagas" : "Erros"}>
      <PageHeader
        title={EM_TESTE ? "Limites e vagas" : "Erros"}
        description={
          EM_TESTE
            ? "Avisos que não são defeito: cliente que tentou passar do limite do plano (sinal de quem quer um plano maior) e live que ficou sem vaga no servidor (sinal de que está na hora de um servidor maior). Os erros de verdade ficam em Erros."
            : t("adm.errosDescricao")
        }
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
