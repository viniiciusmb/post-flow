import { useEffect, useState } from "react"
import { IconAlertTriangle, IconRefresh, IconExternalLink, IconWallet } from "@tabler/icons-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { api } from "@/lib/api"
import type { SaldoDeIa, SaldosDasIasResponse } from "@/types/api"

// Onde recarregar cada conta - o aviso vermelho leva direto pra lá.
const ONDE_RECARREGAR: Record<SaldoDeIa["provedor"], string> = {
  deepinfra: "https://deepinfra.com/dash/billing",
  groq: "https://console.groq.com/settings/billing",
  openai: "https://platform.openai.com/settings/organization/billing/overview",
  anthropic: "https://console.anthropic.com/settings/billing",
  elevenlabs: "https://elevenlabs.io/app/subscription",
}

function usd(v: number | null | undefined) {
  if (v === null || v === undefined) return "—"
  return `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function data(iso?: string) {
  if (!iso) return ""
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function dias(v: number | null) {
  if (v === null) return null
  if (v < 1) return "menos de 1 dia"
  if (v > 365) return "mais de um ano"
  return `~${Math.round(v)} dias`
}

function LinkRecarregar({ provedor }: { provedor: SaldoDeIa["provedor"] }) {
  return (
    <a
      href={ONDE_RECARREGAR[provedor]}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2"
    >
      Recarregar <IconExternalLink className="size-3" />
    </a>
  )
}

function Provedor({ p, onInformar }: { p: SaldoDeIa; onInformar: (provedor: string, usd: number) => Promise<void> }) {
  const [rascunho, setRascunho] = useState("")
  const [salvando, setSalvando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function salvar() {
    const valor = Number(rascunho.replace(",", "."))
    if (!rascunho.trim() || !Number.isFinite(valor) || valor < 0) {
      setErro("Digite o saldo em dólar, como 20 ou 12,50.")
      return
    }
    setErro(null)
    setSalvando(true)
    try {
      await onInformar(p.provedor, valor)
      setRascunho("")
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui salvar.")
    } finally {
      setSalvando(false)
    }
  }

  const alerta = p.abaixoDoLimite
  const rotuloTipo =
    p.tipo === "real" ? "Saldo real" : p.tipo === "estimado" ? "Estimado" : "Plano gratuito"

  return (
    <div
      className={`flex min-w-0 flex-col gap-2 rounded-xl border p-4 ${
        alerta ? "border-2 border-destructive bg-tone-danger-wash" : "bg-card"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{p.nome}</div>
          <div className="text-xs text-muted-foreground">{p.uso}</div>
        </div>
        {p.configurado && (
          <TonePill tone={alerta ? "danger" : p.tipo === "real" ? "success" : "neutral"} dot={false}>
            {alerta ? "Saldo baixo" : rotuloTipo}
          </TonePill>
        )}
      </div>

      {!p.configurado ? (
        <div className="text-sm text-muted-foreground">Sem chave configurada — não está em uso.</div>
      ) : p.tipo === "gratuito" ? (
        <div className="text-sm">
          {p.chaveOk === false ? (
            <span className="font-semibold text-destructive">{p.erro}</span>
          ) : (
            <span className="text-muted-foreground">Sem saldo para acabar. Chave funcionando.</span>
          )}
        </div>
      ) : (
        <>
          <div
            className={`font-heading font-semibold tabular-nums ${
              alerta ? "text-3xl text-destructive" : "text-2xl"
            }`}
          >
            {p.saldoUsd === null || p.saldoUsd === undefined ? (p.semInformacao ? "Informe o saldo" : "—") : usd(p.saldoUsd)}
          </div>

          {alerta && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm font-semibold text-destructive">
              <span className="inline-flex items-center gap-1">
                <IconAlertTriangle className="size-4" />
                {p.suspenso ? "Conta suspensa por falta de saldo" : "Abaixo de US$ 5 — recarregue"}
              </span>
              <LinkRecarregar provedor={p.provedor} />
            </div>
          )}

          {p.erro && <div className="text-xs text-destructive">{p.erro}</div>}

          <div className="space-y-0.5 text-xs text-muted-foreground">
            {p.tipo === "real" && p.consultadoEm && <div>Consultado na {p.nome} às {data(p.consultadoEm)}.</div>}
            {p.tipo === "estimado" && p.informadoEm && (
              <div>
                Você informou {usd(p.informadoUsd)} em {data(p.informadoEm)}; o Post Flow gastou{" "}
                {usd(p.gastoDesdeUsd)} desde então.
              </div>
            )}
            {p.gasto30dUsd > 0 && (
              <div>
                Gasto nos últimos 30 dias: {usd(p.gasto30dUsd)}
                {dias(p.diasRestantes) && <> · no ritmo atual, dura {dias(p.diasRestantes)}</>}
              </div>
            )}
          </div>

          {p.tipo === "estimado" && (
            <div className="mt-1 flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  inputMode="decimal"
                  placeholder="Saldo atual (US$)"
                  value={rascunho}
                  onChange={(e) => setRascunho(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && salvar()}
                  className="h-8 w-36"
                />
                <Button size="sm" variant="outline" onClick={salvar} disabled={salvando}>
                  {salvando ? "Salvando..." : "Informar saldo"}
                </Button>
                {!alerta && <LinkRecarregar provedor={p.provedor} />}
              </div>
              {erro && <span className="text-xs text-destructive">{erro}</span>}
              <span className="text-xs text-muted-foreground">
                A {p.nome} não informa o saldo pela API. Copie o valor do painel dela sempre que recarregar.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export function SaldoDasIasCard() {
  const [dados, setDados] = useState<SaldosDasIasResponse | null>(null)
  const [atualizando, setAtualizando] = useState(false)

  async function carregar(forcar = false) {
    setAtualizando(true)
    try {
      setDados(await api.get<SaldosDasIasResponse>(`/api/admin/costs/ai-balances${forcar ? "?atualizar=1" : ""}`))
    } finally {
      setAtualizando(false)
    }
  }

  useEffect(() => {
    carregar()
  }, [])

  async function informar(provedor: string, valor: number) {
    setDados(await api.post<SaldosDasIasResponse>(`/api/admin/costs/ai-balances/${provedor}`, { saldoUsd: valor }))
  }

  const abaixo = dados?.provedores.filter((p) => p.abaixoDoLimite) ?? []

  return (
    <Card className={abaixo.length ? "border-2 border-destructive" : undefined}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-base">
              <IconWallet className="size-4 text-muted-foreground" />
              Saldo das IAs
            </CardTitle>
            <CardDescription>
              Quando uma conta fica abaixo de US$ {dados?.limiteAlertaUsd ?? 5}, ela fica vermelha aqui e na tela
              inicial. Sem saldo, o vídeo falha ou cai para um provedor de reserva mais caro.
            </CardDescription>
          </div>
          <Button size="sm" variant="outline" onClick={() => carregar(true)} disabled={atualizando}>
            <IconRefresh className={`size-4 ${atualizando ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {abaixo.length > 0 && (
          <div className="flex items-start gap-3 rounded-xl bg-destructive p-4 text-destructive-foreground">
            <IconAlertTriangle className="mt-0.5 size-6 shrink-0" />
            <div className="min-w-0">
              <div className="text-base font-bold">Saldo acabando — recarregue agora</div>
              <div className="text-sm">
                {abaixo.map((p) => `${p.nome}: ${p.suspenso ? "suspensa" : usd(p.saldoUsd)}`).join(" · ")}
              </div>
            </div>
          </div>
        )}
        {!dados ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dados.provedores.map((p) => (
              <Provedor key={p.provedor} p={p} onInformar={informar} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Aviso na tela inicial do admin: só aparece quando alguma conta está abaixo do
// limite. A tela de Custos não é aberta todo dia - o aviso precisa ir até quem
// precisa vê-lo.
export function SaldoBaixoAlerta() {
  const [dados, setDados] = useState<SaldosDasIasResponse | null>(null)

  useEffect(() => {
    api
      .get<SaldosDasIasResponse>("/api/admin/costs/ai-balances")
      .then(setDados)
      .catch(() => setDados(null))
  }, [])

  const abaixo = dados?.provedores.filter((p) => p.abaixoDoLimite) ?? []
  if (!abaixo.length) return null

  return (
    <a
      href="/admin/costs"
      className="flex items-start gap-3 rounded-xl bg-destructive p-4 text-destructive-foreground shadow-sm"
    >
      <IconAlertTriangle className="mt-0.5 size-6 shrink-0" />
      <div className="min-w-0">
        <div className="text-base font-bold">Saldo de IA acabando — recarregue agora</div>
        <div className="text-sm">
          {abaixo.map((p) => `${p.nome}: ${p.suspenso ? "suspensa" : usd(p.saldoUsd)}`).join(" · ")} · ver em Custos
        </div>
      </div>
    </a>
  )
}
