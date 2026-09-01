import { Rico } from "@/components/dashboard/Rico"
import { useT, type ChaveDeTraducao } from "@/i18n"
import { useEffect, useState } from "react"
import { IconCreditCard, IconCircleCheck, IconCoins, IconChevronDown, IconRouter, IconClock, IconBrandYoutube, IconBrandTiktok, IconReceipt, IconPlus } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader } from "@/components/dashboard/PageHeader"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import { Bandeira, bandeiraDoAsaas } from "@/components/checkout/BandeirasDeCartao"
import { dataHora } from "@/lib/formatoLocal"
import type {
  ClientBillingOverviewResponse,
  ClientPaymentsResponse,
  CreditBucket,
  CreditBucketView,
  StatementKind,
} from "@/types/api"

function formatCents(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function BucketMeter({ label, bucket }: { label: string; bucket: CreditBucketView }) {
  const totalPool = bucket.quotaMinutes + bucket.extraMinutes
  const usedPercent = totalPool > 0 ? Math.min(100, (bucket.usedMinutes / totalPool) * 100) : 0
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-heading text-lg font-semibold tabular-nums">{bucket.availableMinutes} min disponíveis</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${usedPercent}%` }} />
      </div>
      <div className="text-xs text-muted-foreground">
        {bucket.usedMinutes} de {bucket.quotaMinutes} min da cota semanal usados
        {bucket.extraMinutes > 0 && ` · +${bucket.extraMinutes} min avulsos`}
      </div>
    </div>
  )
}

function RateBox({
  titulo,
  valor,
  detalhe,
  destaque,
}: {
  titulo: string
  valor: string
  /** Ausente quando não há uma segunda tarifa pra contrastar com esta. */
  detalhe?: string
  destaque?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${destaque ? "border-primary/30 bg-primary/[0.04]" : "border-border"}`}
    >
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className="font-heading mt-0.5 text-lg font-semibold tabular-nums">{valor}</div>
      {detalhe && <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{detalhe}</div>}
    </div>
  )
}

// input type="range" nativo em vez de um componente novo: ja vem com teclado,
// leitor de tela e toque funcionando, e o visual sai todo do accent-color, que
// segue o tema claro/escuro sozinho.
function MinutosSlider({
  rotuloSlider,
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  rotuloSlider: string
}) {
  const percentual = ((value - min) / (max - min)) * 100
  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={rotuloSlider}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${percentual}%, var(--muted) ${percentual}%, var(--muted) 100%)`,
        }}
        className="accent-primary h-2 w-full cursor-pointer appearance-none rounded-full
          [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2
          [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-primary
          [&::-webkit-slider-thumb]:shadow-sm
          [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background
          [&::-moz-range-thumb]:bg-primary"
      />
      <div className="flex justify-between text-[11.5px] text-muted-foreground tabular-nums">
        <span>{min} min</span>
        <span>{max} min</span>
      </div>
    </div>
  )
}

// "1 canal(is)" e "Ilimitado canal(is)" eram o jeito preguiçoso de resolver
// plural. Some do texto e some a palavra "Ilimitado" antes de um substantivo
// singular, que nem português é.
function plural(qtd: number | null, umSo: string, varios: string, semLimite: string) {
  if (qtd === null || qtd === undefined) return semLimite
  return `${qtd} ${qtd === 1 ? umSo : varios}`
}

// A promoção de primeiro mês só pode ser anunciada se o plano tiver preço
// promocional E o cliente ainda não tiver usado a dele. Fora daqui, mostrar o
// desconto seria prometer um preço que não vai acontecer.
function descontoPercentual(plan: { priceCents: number; firstMonthPriceCents?: number | null }) {
  if (!plan.firstMonthPriceCents || plan.firstMonthPriceCents >= plan.priceCents) return 0
  return Math.round((1 - plan.firstMonthPriceCents / plan.priceCents) * 100)
}

// Minutos do vídeo usado no exemplo de preço. Um número redondo e realista:
// o cliente consegue comparar de cabeça com o vídeo dele.
const VIDEO_EXEMPLO_MIN = 30

// Traduz minutos em "quantos vídeos". Abaixo do vídeo de exemplo a divisão dá
// zero, e "cerca de 0 vídeos" logo acima de um botão de compra parece defeito -
// então nesse caso a frase muda em vez de mostrar o zero.
//
// Recebe o `t` porque é chamada de dentro de JSX aninhado, fora de componente.
function estimativaVideos(
  minutos: number,
  t: (c: "plano.daProcessarUm" | "plano.daProcessarVarios" | "plano.daProcessarExatamenteUm", v?: Record<string, string | number>) => string
) {
  const quantos = Math.floor(minutos / VIDEO_EXEMPLO_MIN)
  if (quantos < 1) return t("plano.daProcessarUm", { min: minutos })
  if (quantos === 1) return t("plano.daProcessarExatamenteUm", { min: VIDEO_EXEMPLO_MIN })
  return t("plano.daProcessarVarios", { n: quantos, min: VIDEO_EXEMPLO_MIN })
}

// A Stripe manda a bandeira em minúsculo e sem acento ("visa", "mastercard",
// "amex"). Só o nome bonito é traduzido aqui; bandeira desconhecida cai no
// próprio código que veio, que é melhor do que esconder a informação.
const EXTRATO_ROTULO: Record<StatementKind, ChaveDeTraducao> = {
  avulso: "plano.extratoAvulso",
  excedente: "plano.extratoExcedente",
  plano: "plano.extratoMensalidade",
  outro: "plano.extratoOutro",
}

const BANDEIRAS: Record<string, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  elo: "Elo",
  hipercard: "Hipercard",
  discover: "Discover",
  diners: "Diners Club",
  jcb: "JCB",
  unionpay: "UnionPay",
}

function nomeDaBandeira(brand: string) {
  return BANDEIRAS[brand] ?? brand.charAt(0).toUpperCase() + brand.slice(1)
}

// O SELO da bandeira, não o nome escrito.
//
// É como todo lugar que lida com cartão mostra — a pessoa reconhece o cartão
// dela pelo desenho antes de ler qualquer coisa, e "Visa •••• 5808" gasta uma
// linha inteira dizendo o que um selo de 32px já diz.
//
// O nome continua existindo no `title` e no texto alternativo: quem usa leitor
// de tela, ou quem passa o mouse, não perde a informação — ela só deixa de
// ocupar espaço para quem já enxerga o desenho.
//
// Bandeira que não reconhecemos cai no ícone genérico COM o nome ao lado: aí o
// texto é a única informação que existe, e escondê-lo deixaria a pessoa sem
// saber de que cartão se trata.
function SeloDoCartao({ brand }: { brand: string | null | undefined }) {
  const id = bandeiraDoAsaas(brand)
  if (id) return <Bandeira id={id} className="shrink-0" />
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-muted-foreground">
      <IconCreditCard className="size-3.5" />
      {brand ? nomeDaBandeira(brand) : "Cartão"}
    </span>
  )
}

function CartaoLinha({ card }: { card: { brand: string; last4: string } }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={nomeDaBandeira(card.brand)}>
      <SeloDoCartao brand={card.brand} />
      <span className="tabular-nums">•••• {card.last4}</span>
    </span>
  )
}

function formatarData(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}

export function ClientBillingPage() {
  const t = useT()
  const { user, loading: authLoading, logout, mostrarTunel } = useAuth()
  const [data, setData] = useState<ClientBillingOverviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [minutosAvulsos, setMinutosAvulsos] = useState<number | null>(null)
  const [payments, setPayments] = useState<ClientPaymentsResponse | null>(null)
  const [removerPedido, setRemoverPedido] = useState<"canais" | "contas" | null>(null)

  async function load() {
    const res = await api.get<ClientBillingOverviewResponse>("/api/client/billing/overview")
    setData(res)
  }

  // Cartões e extrato vêm da Stripe, então carregam separado: se a Stripe
  // estiver fora do ar, o resto da tela (saldo, cota, planos) continua abrindo
  // em vez de a página inteira morrer junto.
  async function loadPayments() {
    try {
      setPayments(await api.get<ClientPaymentsResponse>("/api/client/billing/payments"))
    } catch {
      setPayments({ cards: [], statement: [] })
    }
  }

  useEffect(() => {
    if (!user) return
    load()
    loadPayments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  async function runAction(key: string, action: () => Promise<{ checkoutUrl: string } | void>) {
    setError(null)
    setBusyKey(key)
    try {
      const result = await action()
      if (result && result.checkoutUrl) {
        window.location.href = result.checkoutUrl
        return
      }
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("plano.naoFoiPossivelCompletar"))
    } finally {
      setBusyKey(null)
    }
  }

  function subscribe(planKey: string) {
    return runAction(`subscribe-${planKey}`, () => api.post("/api/client/billing/subscribe", { planKey }))
  }

  // ---- confirmação de pagamento ao voltar da tela do Asaas ----
  //
  // Voltar do pagamento NÃO significa que o dinheiro chegou: quem confirma é
  // o aviso do Asaas, que leva alguns segundos. Por isso a tela mostra
  // "confirmando..." e só afirma que recebeu quando o servidor confirma —
  // dizer "pagamento recebido!" antes de saber seria mentir para quem
  // acabou de pagar.
  type UltimoPagamento = {
    tipo: "credito" | "assinatura" | null
    status?: string
    minutes?: number | null
    planName?: string | null
    amountCents?: number
  }
  const [recibo, setRecibo] = useState<UltimoPagamento | null>(null)
  const [reciboAberto, setReciboAberto] = useState(false)
  const [reciboConfirmando, setReciboConfirmando] = useState(false)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const voltouDePagamento = q.get("pacote") === "sucesso" || q.get("assinatura") === "sucesso"
    if (!voltouDePagamento) return

    setReciboAberto(true)
    setReciboConfirmando(true)
    // Tira o marcador da barra de endereço: sem isso, recarregar a página (ou
    // voltar a ela depois) mostraria o mesmo aviso de pagamento de novo.
    window.history.replaceState({}, "", window.location.pathname)

    let tentativas = 0
    const timer = setInterval(async () => {
      tentativas += 1
      try {
        const r = await api.get<UltimoPagamento>("/api/client/billing/ultimo-pagamento")
        setRecibo(r)
        if (r.status === "pago") {
          setReciboConfirmando(false)
          clearInterval(timer)
          load()
          return
        }
      } catch {
        // Erro de rede não precisa virar mensagem: a próxima tentativa vem aí.
      }
      // ~40 segundos. Passou disso, o aviso do Asaas provavelmente vai chegar,
      // só não agora - e é melhor dizer isso do que girar para sempre.
      if (tentativas >= 20) {
        setReciboConfirmando(false)
        clearInterval(timer)
      }
    }, 2000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // O PIX Automático saiu desta tela em 01/09/2026 e passou a viver no
  // checkout, como alternativa ao cartão. O fluxo inteiro (formulário, QR e a
  // espera pelo aviso do Asaas) foi junto - ver CheckoutPage.

  // Sai só DEPOIS de todos os hooks. React exige que a quantidade e a ordem
  // dos hooks sejam idênticas em toda renderização; sair antes fazia a
  // primeira renderização (enquanto a sessão carrega) declarar 5 hooks e a
  // seguinte declarar 16 - e a tela inteira virava branca com "Rendered more
  // hooks than during the previous render". Tudo daqui pra cima é declaração
  // de hook ou de função, nada que dependa de `user` já existir.
  if (authLoading || !user) return null

  function buyPackage(bucket: CreditBucket, minutes: number) {
    return runAction(`package-${bucket}`, () =>
      api.post("/api/client/billing/buy-package", { bucket, minutes })
    )
  }

  function setupOverageCard() {
    return runAction("overage-setup", () => api.post("/api/client/billing/overage-card/setup"))
  }

  function enableOverageCard() {
    return runAction("overage-enable", () => api.post("/api/client/billing/overage-card/enable"))
  }

  function disableOverageCard() {
    return runAction("overage-disable", () => api.post("/api/client/billing/overage-card/disable"))
  }

  async function selecionarCartao(paymentMethodId: string) {
    setError(null)
    setBusyKey(`card-${paymentMethodId}`)
    try {
      await api.post("/api/client/billing/payments/default-card", { paymentMethodId })
      await Promise.all([load(), loadPayments()])
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("plano.naoFoiPossivelCompletar"))
    } finally {
      setBusyKey(null)
    }
  }

  // Remoção em dois cliques, sem popup nativo: o mesmo padrão já usado na
  // exclusão de vídeos. O primeiro clique só arma, o segundo executa.
  // Dois cliques: o primeiro pede confirmação no próprio botão, o segundo
  // executa. `removerPedido` guarda QUAL dos dois está sendo confirmado — com
  // um booleano, pedir para remover um canal deixaria o botão de conta também
  // dizendo "confirmar", e o cliente removeria o que não queria.
  async function removerConexaoExtra(oQue: "canais" | "contas") {
    if (removerPedido !== oQue) {
      setRemoverPedido(oQue)
      return
    }
    setRemoverPedido(null)
    await runAction("extras-remover", () =>
      api.post("/api/client/checkout/extras/remover", { [oQue]: 1 })
    )
  }

  // Só anuncia o desconto se o cliente ainda tiver direito a ele.
  //
  // `promoDisponivel` vem do servidor e é a regra inteira: desconto de estreia,
  // só para quem nunca teve plano nenhum. Cliente com plano ativo — inclusive
  // um atribuído na mão pelo admin, que é como todo mundo é ativado hoje — não
  // vê mais "1º mês por R$59,90".
  function promoVale(plan: { priceCents: number; firstMonthPriceCents?: number | null }) {
    if (!plan.firstMonthPriceCents || plan.firstMonthPriceCents >= plan.priceCents) return false
    return Boolean(data?.subscription.promoDisponivel)
  }

  // Qual cartão mostrar. O do Asaas é o atual; os da Stripe só existem para
  // quem cadastrou antes da tokenização ser liberada.
  const cartaoSalvo = data?.asaasCard?.last4
    ? { brand: (data.asaasCard.brand ?? "").toLowerCase(), last4: data.asaasCard.last4 }
    : payments && payments.cards.length > 0
      ? { brand: payments.cards[0].brand, last4: payments.cards[0].last4 }
      : null
  const temCartaoSalvo = cartaoSalvo !== null

  // Os limites da barra só chegam com a resposta da API, então o estado começa
  // em null e cai no mínimo até lá - assim nenhum valor "chutado" aparece na
  // tela antes de a gente saber o preço de verdade.
  const minutos = data ? (minutosAvulsos ?? data.package.minMinutes) : 0
  const totalAvulso = data ? minutos * data.package.centsPerMinute : 0

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("plano.titulo")}>
      <PageHeader
        title={t("plano.titulo")}
        description={t("plano.descricao")}
      />
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {error && <p className="text-sm text-destructive">{error}</p>}

          {data.isExempt && (
            <Card>
              <CardContent className="py-4">
                <p className="text-sm font-medium">{t("plano.naoConsomeCredito")}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Você é o dono do sistema: seus vídeos são processados sem descontar cota e sem
                  depender de plano. Os números abaixo são só pra você ver como a tela aparece pros
                  seus clientes.
                </p>
              </CardContent>
            </Card>
          )}

          {/* O aviso só vale quando NENHUM provedor está de pé. Enquanto ele
              olhava só pra Stripe, a tela dizia "pagamento por cartão
              indisponível" para um cliente que tinha acabado de pagar pelo
              Asaas — o pior tipo de aviso: o que contradiz o que a pessoa
              acabou de fazer. */}
          {!data.stripeConfigured && !data.asaasConfigured && (
            <TonePill tone="neutral">{t("plano.cartaoIndisponivel")}</TonePill>
          )}

          {data.subscription.status === "sem_plano" && (
            <TonePill tone="danger">{t("plano.semPlanoAtivo")}</TonePill>
          )}
          {data.subscription.status === "inadimplente" && (
            <TonePill tone="danger">{t("plano.ultimaCobrancaFalhou")}</TonePill>
          )}

          <div className="grid gap-4 sm:grid-cols-2" data-tour="creditos">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("plano.creditosNormais")}</CardTitle>
                <CardDescription>
                  {mostrarTunel ? t("plano.creditosNormaisTexto") : t("plano.creditosNormaisTextoSozinho")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <BucketMeter label="Normais" bucket={data.credits.normal} />
              </CardContent>
            </Card>
            {/* Cota bônus: só existe pra quem instala o programa e faz os
                downloads saírem pela internet dele. Com a exibição do túnel
                desligada, mostrar esse cartão seria oferecer minutos que o
                cliente não tem como liberar. A cota continua no banco e
                continua sendo usada por quem já pareou. */}
            {mostrarTunel && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("plano.creditosBonus")}</CardTitle>
                  <CardDescription>{t("plano.creditosBonusTexto")}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <BucketMeter label={t("plano.bonus")} bucket={data.credits.bonus} />
                  {/* Quem chega aqui e vê "0 min disponíveis" no bônus precisa
                      saber onde ligar isso. Sem o caminho, a cota bônus vira um
                      número sem explicação. */}
                  <Button variant="outline" size="sm" asChild className="w-fit gap-1.5">
                    <a href="/client/tunnel">
                      <IconRouter className="size-4" />{t("plano.configurarConexao")}</a>
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>

          {/* As duas formas de nao ficar sem credito no meio do mes ficam
              ACIMA dos planos: quem chega nesta tela quase sempre chega porque
              o credito esta acabando agora, nao pra comparar plano. */}
          <div className="grid gap-4 lg:grid-cols-2" data-tour="nao-ficar-sem-credito">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconCreditCard className="size-4 text-muted-foreground" />{t("plano.cartaoCobranca")}</CardTitle>
                <CardDescription>{t("plano.maquinaDeViews")}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                {/* Com o túnel escondido só existe UMA tarifa, então a grade
                    de duas colunas viraria uma caixa solta e torta no meio da
                    largura. */}
                <div className={mostrarTunel ? "grid gap-2 sm:grid-cols-2" : "grid gap-2"}>
                  <RateBox
                    titulo={mostrarTunel ? t("plano.pelaNossaInternet") : t("plano.porMinuto")}
                    valor={`${formatCents(data.overage.rateCentsNormal)} / min`}
                    detalhe={mostrarTunel ? t("plano.semInstalarNada") : undefined}
                  />
                  {mostrarTunel && (
                    <RateBox
                      titulo={t("plano.pelaSuaInternet")}
                      valor={`${formatCents(data.overage.rateCentsBonus)} / min`}
                      detalhe={t("plano.comProgramaInstalado")}
                      destaque
                    />
                  )}
                </div>

                {/* Fechado por padrão: quem só quer saber o preço já viu os dois
                    valores acima. Isto aqui é pra quem tem a pergunta seguinte
                    ("quando exatamente me cobram?") - e essa merece resposta
                    completa, não uma linha espremida. */}
                <details className="group rounded-lg border border-border">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-3.5 text-sm font-medium [&::-webkit-details-marker]:hidden">{t("plano.comoGastosProcessados")}<IconChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>

                  <div className="flex flex-col gap-3 border-t border-border p-3.5 text-sm leading-relaxed text-muted-foreground">
                    {/* Estes parágrafos têm negrito no meio da frase. Cortá-los
                        em pedaços pra montar o JSX deixaria o dicionário
                        ilegível pra quem traduz — o Rico resolve isso. */}
                    <Rico html={t("plano.cobrancaExplicacao1", { min: VIDEO_EXEMPLO_MIN })} />
                    <Rico html={t("plano.cobrancaExplicacao2")} />

                    <div className="rounded-md bg-muted/60 p-3">
                      <p className="text-xs font-medium text-foreground">{t("adm.exemplo")}</p>
                      <Rico
                        className="mt-1 block text-[13px]"
                        html={t("plano.cobrancaExemplo1", {
                          min: VIDEO_EXEMPLO_MIN,
                          total: formatCents(data.overage.rateCentsNormal * VIDEO_EXEMPLO_MIN),
                          tarifa: formatCents(data.overage.rateCentsNormal),
                        })}
                      />
                      {mostrarTunel && (
                        <Rico
                          className="mt-2 block text-[13px]"
                          html={t("plano.cobrancaExemplo2", {
                            total: formatCents(data.overage.rateCentsBonus * VIDEO_EXEMPLO_MIN),
                          })}
                        />
                      )}
                    </div>

                    <p className="text-xs">{t("plano.cotaPrimeiro")}</p>
                  </div>
                </details>

                {data.overage.pendingCents > 0 && (
                  <TonePill tone="danger">
                    {t("plano.excedenteAcumulado", { valor: formatCents(data.overage.pendingCents) })}
                  </TonePill>
                )}

                <div className="mt-auto flex flex-col gap-3">
                  {data.subscription.overageCardEnabled ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <TonePill tone="success" icon={<IconCircleCheck className="size-3.5" />}>{t("plano.cartaoAtivo")}</TonePill>
                        {/* Com 1 cartão só, a bandeira e os 4 dígitos ficam
                            aqui mesmo; com vários, a lista abaixo já mostra
                            qual está selecionado e repetir seria ruído. */}
                        {data.asaasCard && data.asaasCard.last4 ? (
                          <span className="text-sm text-muted-foreground">
                            <CartaoLinha
                              card={{
                                brand: (data.asaasCard.brand ?? "").toLowerCase(),
                                last4: data.asaasCard.last4,
                              }}
                            />
                          </span>
                        ) : (
                          payments &&
                          payments.cards.length === 1 && (
                            <span className="text-sm text-muted-foreground">
                              <CartaoLinha card={payments.cards[0]} />
                            </span>
                          )
                        )}
                      </div>

                      {payments && payments.cards.length > 1 && (
                        <div className="flex flex-col gap-1.5">
                          <span className="text-xs text-muted-foreground">{t("plano.cartaoUsadoNasCobrancas")}</span>
                          {payments.cards.map((card) => {
                            const selecionado = card.isDefault
                            return (
                              <button
                                key={card.id}
                                type="button"
                                disabled={selecionado || busyKey === `card-${card.id}`}
                                onClick={() => selecionarCartao(card.id)}
                                className={`flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                                  selecionado
                                    ? "border-primary bg-primary/[0.04]"
                                    : "border-border hover:bg-muted disabled:opacity-60"
                                }`}
                              >
                                <CartaoLinha card={card} />
                                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span className="tabular-nums">
                                    {String(card.expMonth).padStart(2, "0")}/{card.expYear}
                                  </span>
                                  {selecionado ? (
                                    <IconCircleCheck className="size-4 text-primary" />
                                  ) : (
                                    <span>{busyKey === `card-${card.id}` ? "…" : t("plano.usarEste")}</span>
                                  )}
                                </span>
                              </button>
                            )
                          })}
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyKey === "overage-disable"}
                          onClick={disableOverageCard}
                        >{t("plano.desligarCobranca")}</Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyKey === "overage-setup"}
                          onClick={setupOverageCard}
                        >{t("plano.cadastrarOutroCartao")}</Button>
                      </div>
                    </>
                  ) : temCartaoSalvo ? (
                    /* Cartão salvo, cobrança automática DESLIGADA. É o estado
                       normal de quem acabou de pagar: guardar o cartão não
                       autoriza cobrá-lo sozinho, e essa autorização precisa de
                       um clique dedicado — é a única cobrança do sistema que
                       acontece sem ninguém clicar em nada. */
                    <div className="flex flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <TonePill tone="neutral">Cartão salvo · cobrança automática desligada</TonePill>
                        {cartaoSalvo && (
                          <span className="text-sm text-muted-foreground">
                            <CartaoLinha card={cartaoSalvo} />
                          </span>
                        )}
                      </div>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Enquanto estiver desligada, os vídeos param quando a cota da semana acabar. Ligando,
                        eles continuam saindo e você paga só o que passou do plano.
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button disabled={busyKey === "overage-enable"} onClick={enableOverageCard}>
                          {busyKey === "overage-enable" ? "Ativando..." : "Ativar cobrança automática"}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busyKey === "overage-setup"}
                          onClick={setupOverageCard}
                        >{t("plano.cadastrarOutroCartao")}</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button disabled={busyKey === "overage-setup"} onClick={setupOverageCard}>{t("plano.cadastrarCartao")}</Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconCoins className="size-4 text-muted-foreground" />{t("plano.comprarCreditos")}</CardTitle>
                <CardDescription>{t("plano.preferePagarAdiantado")}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground">{t("plano.quantosMinutos")}</div>
                      <div className="font-heading text-3xl leading-tight font-semibold tabular-nums">
                        {minutos} min
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">{t("plano.vocePaga")}</div>
                      <div className="font-heading text-3xl leading-tight font-semibold tabular-nums">
                        {formatCents(totalAvulso)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <MinutosSlider
                      value={minutos}
                      min={data.package.minMinutes}
                      max={data.package.maxMinutes}
                      step={data.package.stepMinutes}
                      onChange={setMinutosAvulsos}
                      rotuloSlider={t("plano.quantosMinutosComprar")}
                    />
                  </div>

                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {t("plano.mesmoPreco", { valor: formatCents(data.package.centsPerMinute) })}{" "}
                    {estimativaVideos(minutos, t)}
                  </p>
                </div>

                {/* Atalhos pros valores mais pedidos: arrastar até um número
                    exato é chato, e a barra sozinha deixava um vazio aqui. */}
                <div className="flex flex-wrap gap-2">
                  {[25, 100, 250, 500].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setMinutosAvulsos(v)}
                      className={`rounded-full border px-3 py-1.5 text-[13px] font-medium tabular-nums transition-colors ${
                        minutos === v
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {v} min
                    </button>
                  ))}
                </div>

                <Button
                  className="mt-auto"
                  disabled={busyKey === "package-normal"}
                  onClick={() => buyPackage("normal", minutos)}
                >
                  Comprar {minutos} min por {formatCents(totalAvulso)}
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base" data-tour="planos">{t("plano.seuPlano")}</CardTitle>
              <CardDescription>
                {data.subscription.planName
                  ? `Plano atual: ${data.subscription.planName}`
                  : t("plano.escolhaUmPlano")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-3 sm:items-start">
              {data.plans.map((plan, index) => {
                const isCurrent = plan.key === data.subscription.planKey
                // Sem conceito de "recomendado" vindo do backend - o plano do
                // meio (Pro) e o candidato natural, igual a referencia visual.
                const isPopular = data.plans.length === 3 && index === 1
                const emphasized = isCurrent || isPopular
                return (
                  <div
                    key={plan.key}
                    className={`relative flex flex-col gap-4 rounded-xl border p-5 ${
                      emphasized
                        ? "border-primary bg-primary/[0.03] shadow-[var(--shadow-raised)]"
                        : "border-border"
                    }`}
                  >
                    {isPopular && (
                      <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground">
                        {t("plano.maisPopular")}
                      </span>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-heading text-lg font-semibold">{plan.name}</span>
                      {isCurrent && (
                        <TonePill tone="success" icon={<IconCircleCheck className="size-3.5" />}>
                          Atual
                        </TonePill>
                      )}
                    </div>
                    {/* Os DOIS degraus do preço, sempre juntos. Mostrar só o
                        promocional e deixar o valor cheio para a fatura do mês
                        seguinte é o que gera estorno e reclamação. */}
                    {promoVale(plan) ? (
                      <div>
                        <div className="font-heading text-3xl font-semibold tabular-nums">
                          {formatCents(plan.firstMonthPriceCents!)}
                          <span className="text-sm font-normal text-muted-foreground">
                            {" "}no 1º mês
                          </span>
                        </div>
                        <div className="mt-1 text-[13px] text-muted-foreground">
                          depois{" "}
                          <span className="tabular-nums">{formatCents(plan.priceCents)}</span>/mês ·{" "}
                          <span className="font-medium text-primary">
                            {descontoPercentual(plan)}% de desconto agora
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="font-heading text-3xl font-semibold tabular-nums">
                        {formatCents(plan.priceCents)}
                        <span className="text-sm font-normal text-muted-foreground">/mês</span>
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      <Button
                        variant={isCurrent ? "outline" : "default"}
                        disabled={isCurrent || busyKey === `subscribe-${plan.key}`}
                        onClick={() => subscribe(plan.key)}
                      >
                        {isCurrent ? "Plano atual" : t("plano.assinarTrocar")}
                      </Button>
                      {/* O PIX Automático saiu daqui em 01/09/2026.
                          Dois botões lado a lado pediam a decisão do MEIO DE
                          PAGAMENTO antes da decisão que importa nesta tela, que
                          é qual plano. Agora existe um botão só, e o meio de
                          pagamento é escolhido no checkout - com cartão em
                          primeiro e PIX Automático como alternativa. */}
                    </div>
                    <ul className="flex flex-1 flex-col gap-2 border-t border-border pt-4 text-sm text-muted-foreground">
                      <li className="flex items-start gap-2">
                        <IconClock className="mt-0.5 size-4 shrink-0 text-primary" />
                        {t("plano.minutosPorSemana", { n: plan.weeklyMinutesNormal })}
                      </li>
                      {mostrarTunel && (
                        <li className="flex items-start gap-2">
                          <IconRouter className="mt-0.5 size-4 shrink-0 text-primary" />
                          {t("plano.minutosSuaInternet", { n: plan.weeklyMinutesBonus })}
                        </li>
                      )}
                      <li className="flex items-start gap-2">
                        <IconBrandYoutube className="mt-0.5 size-4 shrink-0 text-primary" />
                        {plural(plan.maxYoutubeChannels, t("plano.canalYoutube"), t("plano.canaisYoutube"), t("plano.canaisIlimitados"))}
                      </li>
                      <li className="flex items-start gap-2">
                        <IconBrandTiktok className="mt-0.5 size-4 shrink-0 text-primary" />
                        {plural(plan.maxTiktokAccounts, t("plano.contaTiktok"), t("plano.contasTiktok"), t("plano.contasIlimitadas"))}
                      </li>
                    </ul>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          {/* Conexões extras. Desde 01/09/2026 são dois produtos separados —
              canal do YouTube e conta do TikTok — em vez de um pacote fechado
              que valia os dois. Quem leva o par paga menos que os dois avulsos.

              Só aparece nos planos que vendem: nos outros a saída é trocar de
              plano, e um card vazio aqui ensinaria a ignorar esta parte da tela. */}
          {data.subscription.precosExtras && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconPlus className="size-4 text-muted-foreground" />
                  Conexões extras
                </CardTitle>
                <CardDescription>
                  Adicione só o que faltar: mais um canal para monitorar, mais uma conta para publicar, ou os
                  dois. O par sai por {formatCents(data.subscription.precosExtras.ambos)} — mais barato que
                  comprar separado.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <RateBox
                    titulo="Canais do YouTube"
                    valor={`${data.subscription.limiteCanais ?? "∞"}`}
                    detalhe={
                      data.subscription.extraChannels > 0
                        ? `${data.subscription.extraChannels} extra(s) que você comprou`
                        : "Total que você pode monitorar"
                    }
                  />
                  <RateBox
                    titulo="Contas do TikTok"
                    valor={`${data.subscription.limiteContas ?? "∞"}`}
                    detalhe={
                      data.subscription.extraTiktokAccounts > 0
                        ? `${data.subscription.extraTiktokAccounts} extra(s) que você comprou`
                        : "Total em que você pode publicar"
                    }
                  />
                </div>

                <div className="grid gap-2 sm:grid-cols-3">
                  <Button asChild variant="outline" className="h-auto flex-col items-start gap-0.5 py-2.5">
                    <a href="/client/checkout?extras=1&canais=1">
                      <span className="text-xs font-normal text-muted-foreground">+1 canal do YouTube</span>
                      <span className="font-semibold">{formatCents(data.subscription.precosExtras.canal)}/mês</span>
                    </a>
                  </Button>
                  <Button asChild variant="outline" className="h-auto flex-col items-start gap-0.5 py-2.5">
                    <a href="/client/checkout?extras=1&contas=1">
                      <span className="text-xs font-normal text-muted-foreground">+1 conta do TikTok</span>
                      <span className="font-semibold">{formatCents(data.subscription.precosExtras.conta)}/mês</span>
                    </a>
                  </Button>
                  <Button asChild className="h-auto flex-col items-start gap-0.5 py-2.5">
                    <a href="/client/checkout?extras=1&canais=1&contas=1">
                      <span className="text-xs font-normal opacity-80">+1 canal e +1 conta</span>
                      <span className="font-semibold">{formatCents(data.subscription.precosExtras.ambos)}/mês</span>
                    </a>
                  </Button>
                </div>

                {/* A primeira cobrança sai agora; a partir do ciclo seguinte ela
                    cai no mesmo dia da mensalidade. Dizer isso aqui evita a
                    dúvida de "por que fui cobrado duas vezes esse mês". */}
                <p className="text-xs text-muted-foreground">
                  Você paga a conexão agora e, a partir do mês seguinte, ela é cobrada junto com a sua
                  mensalidade, numa data só.
                </p>

                {(data.subscription.extraChannels > 0 || data.subscription.extraTiktokAccounts > 0) && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    {data.subscription.extraChannels > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyKey === "extras-remover"}
                        onClick={() => removerConexaoExtra("canais")}
                      >
                        {removerPedido === "canais" ? "Confirmar remoção" : "Remover 1 canal"}
                      </Button>
                    )}
                    {data.subscription.extraTiktokAccounts > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyKey === "extras-remover"}
                        onClick={() => removerConexaoExtra("contas")}
                      >
                        {removerPedido === "contas" ? "Confirmar remoção" : "Remover 1 conta"}
                      </Button>
                    )}
                    {removerPedido && (
                      <p className="w-full text-xs text-muted-foreground">
                        O mês já pago não é devolvido — a cobrança some a partir do próximo.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* FATURAS PAGAS: tudo que o cliente já pagou, com dia, hora, valor,
              produto e o cartão usado NAQUELA compra.

              O cartão vem gravado na fatura, e não lido do cadastro atual: o
              cliente troca de cartão e o extrato inteiro passaria a dizer que
              tudo foi pago no cartão novo — reescrevendo o passado numa tela
              que existe justamente para provar o que aconteceu. */}
          {data.faturas.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconReceipt className="size-4 text-muted-foreground" />
                  Faturas pagas
                </CardTitle>
                <CardDescription>Tudo que você já pagou no Post Flow.</CardDescription>
              </CardHeader>
              <CardContent>
                {/* A tabela rola dentro do próprio cartão: sem isto, no celular
                    ela empurra a PÁGINA inteira de lado. */}
                <div className="-mx-2 overflow-x-auto px-2">
                  <table className="w-full min-w-[34rem] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted-foreground">
                        <th className="pb-2 pr-3 font-medium">Quando</th>
                        <th className="pb-2 pr-3 font-medium">Produto</th>
                        <th className="pb-2 pr-3 font-medium">Pago com</th>
                        <th className="pb-2 text-right font-medium">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.faturas.map((f) => (
                        <tr key={f.id} className="border-b border-border/60 last:border-0">
                          <td className="py-2.5 pr-3 whitespace-nowrap text-muted-foreground tabular-nums">
                            {dataHora(f.pagoEm)}
                          </td>
                          <td className="py-2.5 pr-3">{f.produto}</td>
                          <td className="py-2.5 pr-3 whitespace-nowrap text-muted-foreground">
                            {f.cartao && f.cartao.final ? (
                              <span
                                className="inline-flex items-center gap-1.5"
                                title={f.cartao.bandeira ? nomeDaBandeira(f.cartao.bandeira) : "Cartão"}
                              >
                                <SeloDoCartao brand={f.cartao.bandeira} />
                                <span className="tabular-nums">•••• {f.cartao.final}</span>
                              </span>
                            ) : (
                              f.meio
                            )}
                          </td>
                          <td className="py-2.5 text-right font-medium tabular-nums">{formatCents(f.valorCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {payments && payments.statement.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconReceipt className="size-4 text-muted-foreground" />
                  {t("plano.extrato")}
                </CardTitle>
                <CardDescription>{t("plano.extratoDescricao")}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>{t("plano.data")}</TableHead>
                        <TableHead>{t("plano.oQueFoi")}</TableHead>
                        <TableHead>{t("plano.cartao")}</TableHead>
                        <TableHead className="text-right">{t("plano.valor")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.statement.map((linha) => (
                        <TableRow key={linha.id}>
                          <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                            {formatarData(linha.createdAt)}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-2">
                              <span>{t(EXTRATO_ROTULO[linha.kind])}</span>
                              {linha.minutes !== null && (
                                <span className="text-xs text-muted-foreground tabular-nums">
                                  {linha.minutes} min
                                </span>
                              )}
                              {linha.status !== "pago" && (
                                <TonePill tone={linha.status === "reembolsado" ? "neutral" : "danger"}>
                                  {t(linha.status === "reembolsado" ? "plano.reembolsado" : "plano.falhou")}
                                </TonePill>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {linha.card ? <CartaoLinha card={linha.card} /> : "—"}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {linha.receiptUrl ? (
                              <a
                                href={linha.receiptUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline decoration-dotted underline-offset-4 hover:decoration-solid"
                                title={t("plano.verRecibo")}
                              >
                                {formatCents(linha.amountCents)}
                              </a>
                            ) : (
                              formatCents(linha.amountCents)
                            )}
                            {linha.refundedCents > 0 && (
                              <div className="text-xs text-muted-foreground">
                                −{formatCents(linha.refundedCents)} {t("plano.devolvido")}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {data.recentTransactions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Consumo recente</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {data.recentTransactions.map((lancamento) => (
                  <div key={lancamento.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {t("tabela.video")} #{lancamento.sourceVideoId}
                    </span>
                    <span>
                      {lancamento.minutesCharged} min ·{" "}
                      {lancamento.bucket === "bonus" ? t("plano.bonusMinusculo") : t("plano.normalMinusculo")}
                    </span>
                    <TonePill
                      tone={
                        lancamento.status === "confirmado"
                          ? "success"
                          : lancamento.status === "liberado"
                            ? "neutral"
                            : "cyan"
                      }
                    >
                      {lancamento.status}
                    </TonePill>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
      {/* Confirmação de pagamento ao voltar da tela do Asaas. */}
      <Dialog open={reciboAberto} onOpenChange={setReciboAberto}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {reciboConfirmando
                ? t("recibo.confirmando")
                : recibo?.status === "pago"
                  ? t("recibo.recebemos")
                  : t("recibo.aindaProcessando")}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col items-center gap-4 py-2 text-center">
            {reciboConfirmando ? (
              <>
                <div className="size-12 animate-spin rounded-full border-4 border-muted border-t-primary" />
                <p className="text-sm text-muted-foreground">{t("recibo.esperandoBanco")}</p>
              </>
            ) : recibo?.status === "pago" ? (
              <>
                <IconCircleCheck className="size-14 text-emerald-500" />
                <div>
                  <p className="font-heading text-lg font-semibold">
                    {recibo.tipo === "credito"
                      ? t("recibo.minutosCreditados", { n: recibo.minutes ?? 0 })
                      : t("recibo.planoAtivo", { plano: recibo.planName ?? "" })}
                  </p>
                  {typeof recibo.amountCents === "number" && (
                    <p className="text-sm text-muted-foreground">{formatCents(recibo.amountCents)}</p>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">
                  {recibo.tipo === "credito" ? t("recibo.jaNoSaldo") : t("recibo.jaAtualizado")}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("recibo.avisamosQuandoCair")}</p>
            )}
            <Button className="w-full" onClick={() => setReciboAberto(false)}>
              {t("comum.fechar")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

    </DashboardLayout>
  )
}
