import { useState } from "react"
import {
  IconBrandTiktok,
  IconBrandYoutube,
  IconBroadcast,
  IconHandClick,
  IconMinus,
  IconPlus,
  IconVideo,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { REDES, type Rede } from "@/lib/redes"
import { cn } from "@/lib/utils"
import type { ClientBillingOverviewResponse } from "@/types/api"

/**
 * Partes da tela "Plano e uso" (reformulada em 12/10/2026): quanto cada coisa
 * gasta de crédito, o que o plano inclui (com o uso rede por rede) e a compra
 * de contas extras nas redes sociais.
 */

type Uso = NonNullable<ClientBillingOverviewResponse["uso"]>
type Regras = NonNullable<ClientBillingOverviewResponse["regrasDeCredito"]>

function reais(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function horasEMinutos(min: number) {
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  if (h === 0) return `${m} min`
  return m ? `${h} h ${m} min` : `${h} h`
}

/** Quanto cada coisa gasta. Os números vêm do servidor (os mesmos que ele cobra). */
export function QuantoGasta({
  regras,
  disponiveis,
  isento,
  onComprar,
}: {
  regras: Regras
  disponiveis: number
  isento: boolean
  onComprar: () => void
}) {
  const itens = [
    {
      Icone: IconVideo,
      titulo: "Vídeo do YouTube ou enviado",
      valor: `${regras.minutosDeVideoPorCredito} min de vídeo = 1 crédito`,
      exemplo: "Um vídeo de 30 min gasta 30 créditos, cobrados quando o download termina.",
    },
    {
      Icone: IconBroadcast,
      titulo: "Live clipada",
      valor: `${regras.minutosDeLivePorCredito} min de live = 1 crédito`,
      exemplo: `1 hora de live clipada gasta ${Math.round(60 / regras.minutosDeLivePorCredito)} créditos. Só conta enquanto a live está sendo clipada pra você.`,
    },
    {
      Icone: IconHandClick,
      titulo: "Clipar este momento",
      valor: `${regras.creditosCliparEsteMomento} crédito por clique`,
      exemplo: "Corta os últimos 2 minutos e meio da live na hora em que você aperta.",
    },
  ]
  return (
    <Card data-tour="quanto-gasta">
      <CardHeader>
        <CardTitle className="text-base">Quanto cada coisa gasta</CardTitle>
        <CardDescription>
          Vídeos do YouTube e lives usam os mesmos créditos da sua cota semanal (e dos minutos avulsos que você comprar).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {itens.map(({ Icone, titulo, valor, exemplo }) => (
            <div key={titulo} className="flex flex-col gap-1 rounded-lg border border-border p-3.5">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Icone className="size-4" />
                {titulo}
              </span>
              <span className="font-heading text-base font-semibold">{valor}</span>
              <span className="text-xs leading-relaxed text-muted-foreground">{exemplo}</span>
            </div>
          ))}
        </div>
        {!isento && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/50 px-3.5 py-3 text-sm">
            <span>
              Seus <strong className="tabular-nums">{disponiveis}</strong> créditos dão para cerca de{" "}
              <strong className="tabular-nums">{disponiveis} min</strong> de vídeo ou{" "}
              <strong className="tabular-nums">{horasEMinutos(disponiveis * regras.minutosDeLivePorCredito)}</strong> de live.
            </span>
            <Button size="sm" variant="outline" onClick={onComprar}>
              Comprar mais créditos
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Medidor({ usados, limite }: { usados: number; limite: number | null }) {
  const pct = limite ? Math.min(100, (usados / limite) * 100) : 0
  const cheio = limite !== null && usados >= limite
  return (
    <div className="flex flex-col gap-1">
      <span className={cn("text-sm font-semibold tabular-nums", cheio && "text-tone-danger-ink")}>
        {usados} de {limite ?? "∞"}
      </span>
      {limite !== null && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className={cn("h-full rounded-full", cheio ? "bg-tone-danger-ink" : "bg-primary")} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

function LinhaDeUso({
  icone,
  nome,
  usados,
  limite,
  extras = 0,
}: {
  icone: React.ReactNode
  nome: string
  usados: number
  limite: number | null
  extras?: number
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2.5 text-sm">
        {icone}
        <span className="truncate">{nome}</span>
        {extras > 0 && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">+{extras} comprada{extras > 1 ? "s" : ""}</span>
        )}
      </span>
      <Medidor usados={usados} limite={limite} />
    </li>
  )
}

function SeloDaRede({ rede }: { rede: Rede }) {
  const info = REDES[rede]
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md text-white" style={{ background: info.fundo }}>
      <info.Icone className="size-3.5" />
    </span>
  )
}

/** O que o plano inclui, com o quanto já está em uso. */
export function UsoDoPlano({ uso, onComprarExtra }: { uso: Uso; onComprarExtra: () => void }) {
  return (
    <Card data-tour="uso-do-plano">
      <CardHeader>
        <CardTitle className="text-base">O que seu plano inclui</CardTitle>
        <CardDescription>
          Quanto você já está usando de cada coisa. Nas redes sociais o limite vale para cada rede, e dá para comprar
          conta extra por rede.
        </CardDescription>
      </CardHeader>
      {/* minmax(0,1fr): sem isso a coluna única do celular cresce até a linha
          mais larga e a página rola de lado. */}
      <CardContent className="grid grid-cols-[minmax(0,1fr)] gap-x-8 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">Onde os cortes nascem</p>
          <ul className="divide-y divide-border/70">
            <LinhaDeUso
              icone={<span className="flex size-6 items-center justify-center rounded-md bg-[#FF0000] text-white"><IconBrandYoutube className="size-3.5" /></span>}
              nome="Canais do YouTube"
              usados={uso.canaisYoutube.usados}
              limite={uso.canaisYoutube.limite}
            />
            <LinhaDeUso
              icone={<span className="flex size-6 items-center justify-center rounded-md bg-[#9146FF] text-white"><IconBroadcast className="size-3.5" /></span>}
              nome={`Canais de live${uso.livesAoMesmoTempo !== null ? ` · ${uso.livesAoMesmoTempo} clipada por vez` : ""}`}
              usados={uso.canaisDeLive.usados}
              limite={uso.canaisDeLive.limite}
            />
          </ul>
        </div>
        <div className="mt-4 min-w-0 lg:mt-0">
          <p className="text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">Onde os cortes são publicados</p>
          <ul className="divide-y divide-border/70">
            <LinhaDeUso
              icone={<span className="flex size-6 items-center justify-center rounded-md bg-black text-white"><IconBrandTiktok className="size-3.5" /></span>}
              nome="TikTok"
              usados={uso.contasTiktok.usados}
              limite={uso.contasTiktok.limite}
            />
            {uso.redes.map((r) => (
              <LinhaDeUso
                key={r.rede}
                icone={r.rede in REDES ? <SeloDaRede rede={r.rede as Rede} /> : null}
                nome={r.nome}
                usados={r.usadas}
                limite={r.limite}
                extras={r.extras}
              />
            ))}
          </ul>
          <Button variant="link" className="mt-1 h-auto max-w-full shrink whitespace-normal px-0 text-left text-sm" onClick={onComprarExtra}>
            Precisa de mais contas numa rede? Comprar conta extra →
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/**
 * Compra de contas extras nas redes sociais: o cliente escolhe quantas em cada
 * rede e vai pro checkout com tudo de uma vez. O preço mostrado aqui é só pra
 * conta: quem decide quanto cobrar é o servidor.
 */
export function ExtrasNasRedes({
  uso,
  precoCents,
  ocupado,
  onRemover,
}: {
  uso: Uso
  precoCents: number
  ocupado: boolean
  onRemover: (rede: string) => void
}) {
  const [qtd, setQtd] = useState<Record<string, number>>({})
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const total = Object.values(qtd).reduce((a, b) => a + b, 0)
  const pedido = Object.entries(qtd)
    .filter(([, n]) => n > 0)
    .map(([rede, n]) => `${rede}:${n}`)
    .join(",")

  function mudar(rede: string, delta: number) {
    setQtd((q) => ({ ...q, [rede]: Math.max(0, Math.min(10, (q[rede] || 0) + delta)) }))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Contas extras nas redes sociais</CardTitle>
        <CardDescription>
          {reais(precoCents)} por mês por conta, em qualquer plano. Escolha a rede e quantas contas a mais você quer. Você
          paga agora e, a partir do mês seguinte, a cobrança vem junto com a sua mensalidade.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="divide-y divide-border/70">
          {uso.redes.map((r) => {
            const n = qtd[r.rede] || 0
            return (
              <li key={r.rede} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  {r.rede in REDES && <SeloDaRede rede={r.rede as Rede} />}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{r.nome}</span>
                    <span className="block text-xs text-muted-foreground">
                      {r.usadas} de {r.limite ?? "∞"} em uso
                      {r.extras > 0 && ` · ${r.extras} extra${r.extras > 1 ? "s" : ""} comprada${r.extras > 1 ? "s" : ""}`}
                    </span>
                  </span>
                </span>
                {r.extras > 0 && (
                  <button
                    type="button"
                    disabled={ocupado}
                    className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => {
                      if (confirmando !== r.rede) return setConfirmando(r.rede)
                      setConfirmando(null)
                      onRemover(r.rede)
                    }}
                  >
                    {confirmando === r.rede ? "Confirmar: devolver 1" : "Devolver 1"}
                  </button>
                )}
                <span className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-8"
                    aria-label={`Menos uma conta do ${r.nome}`}
                    disabled={n === 0}
                    onClick={() => mudar(r.rede, -1)}
                  >
                    <IconMinus className="size-3.5" />
                  </Button>
                  <span className="w-6 text-center text-sm font-semibold tabular-nums">{n}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-8"
                    aria-label={`Mais uma conta do ${r.nome}`}
                    onClick={() => mudar(r.rede, 1)}
                  >
                    <IconPlus className="size-3.5" />
                  </Button>
                </span>
              </li>
            )
          })}
        </ul>
        {confirmando && (
          <p className="text-xs text-muted-foreground">O mês já pago não é devolvido — a cobrança some a partir do próximo.</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <span className="text-sm">
            {total === 0 ? (
              <span className="text-muted-foreground">Escolha pelo menos uma conta.</span>
            ) : (
              <>
                {total} conta{total > 1 ? "s" : ""} a mais ·{" "}
                <strong className="tabular-nums">{reais(total * precoCents)}</strong>/mês
              </>
            )}
          </span>
          <Button asChild={total > 0} disabled={total === 0}>
            {total > 0 ? <a href={`/client/checkout?extras=1&redes=${pedido}`}>Comprar</a> : <span>Comprar</span>}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
