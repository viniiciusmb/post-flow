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

export function SeloDaRede({ rede }: { rede: Rede }) {
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

/** Uma linha da compra de conexões extras (canal do YouTube, TikTok ou outra rede). */
export type LinhaDeExtra = {
  /** "canal" (canal do YouTube), "tiktok" ou o nome da rede (instagram, facebook...). */
  chave: string
  nome: string
  icone: React.ReactNode
  usadas: number
  limite: number | null
  extras: number
  precoCents: number
}

/** O que vai no endereço do checkout para cada linha. */
function parteDoPedido(chave: string, n: number) {
  if (chave === "canal") return `canais=${n}`
  if (chave === "tiktok") return `contas=${n}`
  return null
}

/**
 * Compra de conexões extras: mais um canal do YouTube para monitorar, mais uma
 * conta do TikTok ou de outra rede para publicar. O cliente escolhe quantas em
 * cada linha e vai pro checkout com tudo de uma vez. O preço mostrado aqui é só
 * pra conta: quem decide quanto cobrar é o servidor.
 */
export function ConexoesExtras({
  linhas,
  ocupado,
  onRemover,
}: {
  linhas: LinhaDeExtra[]
  ocupado: boolean
  onRemover: (chave: string) => void
}) {
  const [qtd, setQtd] = useState<Record<string, number>>({})
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const total = Object.values(qtd).reduce((a, b) => a + b, 0)
  const totalCents = linhas.reduce((soma, l) => soma + (qtd[l.chave] || 0) * l.precoCents, 0)

  const partes: string[] = []
  const redes: string[] = []
  for (const l of linhas) {
    const n = qtd[l.chave] || 0
    if (!n) continue
    const parte = parteDoPedido(l.chave, n)
    if (parte) partes.push(parte)
    else redes.push(`${l.chave}:${n}`)
  }
  if (redes.length) partes.push(`redes=${redes.join(",")}`)
  const endereco = `/client/checkout?extras=1&${partes.join("&")}`

  function mudar(chave: string, delta: number) {
    setQtd((q) => ({ ...q, [chave]: Math.max(0, Math.min(10, (q[chave] || 0) + delta)) }))
  }

  // Os preços mudam por linha (o canal do YouTube custa mais); o texto do topo
  // cita os dois valores que existem, sem escrever número à mão.
  const precos = [...new Set(linhas.map((l) => l.precoCents))].sort((a, b) => a - b)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Conexões extras</CardTitle>
        <CardDescription>
          Precisa de mais um canal ou de mais uma conta? Em qualquer plano:{" "}
          {precos.length > 1
            ? `contas por ${reais(precos[0])}/mês e canal do YouTube por ${reais(precos[precos.length - 1])}/mês.`
            : `${reais(precos[0] ?? 0)} por mês cada.`}{" "}
          Você paga agora e, a partir do mês seguinte, a cobrança vem junto com a sua mensalidade.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="divide-y divide-border/70">
          {linhas.map((l) => {
            const n = qtd[l.chave] || 0
            return (
              <li key={l.chave} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
                <span className="flex min-w-0 flex-1 items-center gap-2.5">
                  {l.icone}
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      {l.nome} <span className="font-normal text-muted-foreground">· {reais(l.precoCents)}/mês</span>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {l.usadas} de {l.limite ?? "∞"} em uso
                      {l.extras > 0 && ` · ${l.extras} extra${l.extras > 1 ? "s" : ""} comprada${l.extras > 1 ? "s" : ""}`}
                    </span>
                  </span>
                </span>
                {l.extras > 0 && (
                  <button
                    type="button"
                    disabled={ocupado}
                    className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                    onClick={() => {
                      if (confirmando !== l.chave) return setConfirmando(l.chave)
                      setConfirmando(null)
                      onRemover(l.chave)
                    }}
                  >
                    {confirmando === l.chave ? "Confirmar: devolver 1" : "Devolver 1"}
                  </button>
                )}
                <span className="flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-8"
                    aria-label={`Menos um: ${l.nome}`}
                    disabled={n === 0}
                    onClick={() => mudar(l.chave, -1)}
                  >
                    <IconMinus className="size-3.5" />
                  </Button>
                  <span className="w-6 text-center text-sm font-semibold tabular-nums">{n}</span>
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="size-8"
                    aria-label={`Mais um: ${l.nome}`}
                    onClick={() => mudar(l.chave, 1)}
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
              <span className="text-muted-foreground">Escolha pelo menos uma conexão.</span>
            ) : (
              <>
                {total} {total > 1 ? "conexões" : "conexão"} a mais ·{" "}
                <strong className="tabular-nums">{reais(totalCents)}</strong>/mês
              </>
            )}
          </span>
          <Button asChild={total > 0} disabled={total === 0}>
            {total > 0 ? <a href={endereco}>Comprar</a> : <span>Comprar</span>}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
