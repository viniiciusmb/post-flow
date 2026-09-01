import { useEffect, useMemo, useState } from "react"
import {
  IconLock,
  IconCreditCard,
  IconQrcode,
  IconCircleCheck,
  IconArrowLeft,
  IconShieldCheck,
  IconClock,
  IconRouter,
  IconBrandYoutube,
  IconBrandTiktok,
  IconPlus,
  IconCopy,
  IconLoader2,
} from "@tabler/icons-react"
import { BrandMark } from "@/components/brand-mark"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { api, ApiError } from "@/lib/api"
import { useAuth } from "@/hooks/useAuth"
import { EMAIL_SUPORTE } from "@/lib/contato"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import {
  Bandeira,
  FileiraDeBandeiras,
  detectarBandeira,
  passaNoLuhn,
  NOME_DA_BANDEIRA,
  bandeiraDoAsaas,
} from "@/components/checkout/BandeirasDeCartao"
import type { CheckoutContexto, CheckoutItem, CheckoutPagamento } from "@/types/api"

/*
 * Checkout transparente.
 *
 * A pessoa digita o cartão AQUI, dentro do Post Flow. Antes ela era mandada
 * para a tela hospedada do Asaas — outro domínio, outra identidade visual,
 * exatamente no momento em que mais precisa confiar no que está vendo.
 *
 * Três decisões que explicam o layout:
 *
 *   1. UMA COLUNA DE PAGAMENTO E UMA DE RESUMO. O que está sendo comprado, e
 *      por quanto, fica visível o tempo inteiro — inclusive no celular, onde o
 *      resumo vem ANTES do formulário. Ninguém deve precisar rolar para saber
 *      quanto vai pagar.
 *
 *   2. O SEGUNDO DEGRAU DO PREÇO É DITO NA CARA. Mostrar só o valor
 *      promocional e deixar o preço cheio para a fatura do mês seguinte é o
 *      tipo de coisa que gera estorno e desconfiança. O resumo diz o que sai
 *      hoje e o que passa a sair depois.
 *
 *   3. A PÁGINA ESTÁ EM PORTUGUÊS, sem passar pelo dicionário de idiomas. Não
 *      é descuido: ela coleta CPF/CNPJ e CEP, aceita PIX e é processada por
 *      uma instituição brasileira — o fluxo inteiro só existe no Brasil.
 */

function formatCents(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

// ---------------------------------------------------------------------------
// Máscaras
//
// Digitação livre num campo de cartão é onde mais se erra: sem os espaços a
// pessoa perde a conta dos dígitos, e sem a barra na validade metade digita
// "0527" e a outra metade "05/27". As máscaras guardam só os números por baixo
// — o que vai para o servidor nunca depende de como ficou na tela.
// ---------------------------------------------------------------------------
function soDigitos(v: string) {
  return v.replace(/\D/g, "")
}

function mascaraCartao(v: string) {
  return soDigitos(v).slice(0, 19).replace(/(\d{4})(?=\d)/g, "$1 ")
}

function mascaraValidade(v: string) {
  const d = soDigitos(v).slice(0, 4)
  return d.length <= 2 ? d : `${d.slice(0, 2)}/${d.slice(2)}`
}

function mascaraDocumento(v: string) {
  const d = soDigitos(v).slice(0, 14)
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d)/, "$1.$2")
      .replace(/(\d{3})(\d{1,2})$/, "$1-$2")
  }
  return d
    .replace(/(\d{2})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2")
}

function mascaraCep(v: string) {
  const d = soDigitos(v).slice(0, 8)
  return d.length <= 5 ? d : `${d.slice(0, 5)}-${d.slice(5)}`
}

function mascaraTelefone(v: string) {
  const d = soDigitos(v).slice(0, 11)
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d{1,4})$/, "$1-$2")
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d{1,4})$/, "$1-$2")
}

// ---------------------------------------------------------------------------
// Pedaços da tela
// ---------------------------------------------------------------------------

function Campo({
  label,
  children,
  dica,
  className = "",
}: {
  label: string
  children: React.ReactNode
  dica?: string
  className?: string
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-[13px] font-medium">{label}</span>
      {children}
      {dica && <span className="text-[11.5px] leading-snug text-muted-foreground">{dica}</span>}
    </label>
  )
}

function LinhaResumo({
  rotulo,
  valor,
  forte,
  suave,
}: {
  rotulo: React.ReactNode
  valor: React.ReactNode
  forte?: boolean
  suave?: boolean
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${
        forte ? "text-base font-semibold" : suave ? "text-[13px] text-muted-foreground" : "text-sm"
      }`}
    >
      <span className={forte ? "font-heading" : ""}>{rotulo}</span>
      <span className={`tabular-nums ${forte ? "font-heading" : ""}`}>{valor}</span>
    </div>
  )
}

function Beneficio({ icone, texto }: { icone: React.ReactNode; texto: string }) {
  return (
    <li className="flex items-start gap-2 text-[13px] text-muted-foreground">
      <span className="mt-0.5 shrink-0 text-primary">{icone}</span>
      <span>{texto}</span>
    </li>
  )
}

// Rodapé de confiança. Não é enfeite: quem está prestes a digitar um cartão
// procura exatamente estas três informações — quem processa, o que acontece
// com o número do cartão, e quem é a empresa por trás.
function SeloDeConfianca({ cnpj, empresa }: { cnpj: string; empresa: string }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-muted/40 p-4">
      <div className="flex items-start gap-2.5">
        <IconShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Pagamentos processados por{" "}
          <a
            href="https://www.asaas.com"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground underline decoration-dotted underline-offset-2"
          >
            Asaas
          </a>
          , instituição de pagamento autorizada pelo Banco Central do Brasil.
        </p>
      </div>
      <div className="flex items-start gap-2.5">
        <IconLock className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Conexão criptografada. Os dados do seu cartão não ficam guardados nos nossos servidores.
        </p>
      </div>
      <p className="border-t border-border pt-2.5 text-[11.5px] leading-relaxed text-muted-foreground/80">
        {empresa} · CNPJ {cnpj}
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// A página
// ---------------------------------------------------------------------------

type Metodo = "cartao" | "pix"

export function CheckoutPage() {
  const { mostrarTunel } = useAuth()
  const [ctx, setCtx] = useState<CheckoutContexto | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [metodo, setMetodo] = useState<Metodo>("cartao")
  const [usarOutroCartao, setUsarOutroCartao] = useState(false)
  const [concluido, setConcluido] = useState<CheckoutPagamento | null>(null)
  const [pix, setPix] = useState<{ paymentId: string; copiaECola: string; qr: string } | null>(null)
  // Oferta que aparece DEPOIS do pagamento aprovado. Dois passos, cada um com
  // uma decisão só: guardar o cartão, e — separadamente — autorizar que ele
  // seja cobrado sozinho quando a cota acabar. Juntar as duas transformaria
  // "paguei uma vez" em "autorizei cobranças futuras" sem ninguém dizer isso.
  const [oferta, setOferta] = useState<"salvar" | "excedente" | null>(null)
  const [ofertaOcupada, setOfertaOcupada] = useState(false)
  const [copiado, setCopiado] = useState(false)

  // O que está sendo comprado vem da barra de endereço. Uma tela só para as
  // três compras: duplicá-la seria garantir que uma delas ia ficar para trás
  // no próximo ajuste de layout.
  const item: CheckoutItem = useMemo(() => {
    const q = new URLSearchParams(window.location.search)
    if (q.get("plano")) return { tipo: "plano", planKey: q.get("plano")! }
    if (q.get("creditos")) return { tipo: "creditos", minutos: Number(q.get("creditos")) || 25 }
    if (q.get("extras")) {
      // Canal e conta são pedidos separados desde 01/09/2026. Sem nenhum dos
      // dois na URL, cai no par — que é o que o link antigo (?extras=1) queria
      // dizer, e o que a tela de Plano e uso manda quando o cliente clica no
      // botão do par.
      const canais = Number(q.get("canais")) || 0
      const contas = Number(q.get("contas")) || 0
      return canais + contas > 0
        ? { tipo: "extras", canais, contas }
        : { tipo: "extras", canais: 1, contas: 1 }
    }
    return { tipo: "cartao" }
  }, [])

  // Cartão
  const [numero, setNumero] = useState("")
  const [validade, setValidade] = useState("")
  const [cvv, setCvv] = useState("")
  const [nomeNoCartao, setNomeNoCartao] = useState("")
  // Titular (o Asaas exige o conjunto inteiro para tokenizar)
  const [nome, setNome] = useState("")
  const [documento, setDocumento] = useState("")
  const [telefone, setTelefone] = useState("")
  const [cep, setCep] = useState("")
  const [numeroEndereco, setNumeroEndereco] = useState("")

  async function carregar() {
    const r = await api.get<CheckoutContexto>("/api/client/checkout/contexto")
    setCtx(r)
    setNome((atual) => atual || r.perfil.nome)
    setDocumento((atual) => atual || r.perfil.cpfCnpj)
  }

  useEffect(() => {
    carregar().catch((e) => setErro(e instanceof Error ? e.message : "Não consegui carregar o checkout."))
  }, [])

  // Enquanto o QR está na tela, pergunta ao servidor se o PIX já caiu. É a
  // única forma de saber: o pagamento acontece no app do banco, fora daqui.
  useEffect(() => {
    if (!pix || concluido) return
    const timer = setInterval(async () => {
      try {
        const r = await api.get<{ status: string }>(`/api/client/checkout/pagamento/${pix.paymentId}`)
        if (r.status === "pago") {
          setConcluido({ pago: true, tipo: item.tipo === "creditos" ? "creditos" : "plano" })
          clearInterval(timer)
        }
      } catch {
        // Falha de rede aqui não vira mensagem: a próxima tentativa vem em 4s.
      }
    }, 4000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pix, concluido])

  const plano = ctx?.plans.find((p) => p.key === (item.tipo === "plano" ? item.planKey : null)) ?? null

  // Preço do que está sendo comprado. Calculado a partir do MESMO contexto que
  // o servidor usa; o servidor recalcula tudo de novo por conta dele — aqui é
  // só para mostrar, nunca para decidir quanto cobrar.
  const preco = useMemo(() => {
    if (!ctx) return null
    if (item.tipo === "plano" && plano) {
      // Mesma regra do servidor: preço promocional que existe E é menor que o
      // cheio, e cliente com direito a ele (nunca teve plano nenhum).
      const promo =
        Boolean(plano.firstMonthPriceCents) &&
        plano.firstMonthPriceCents! < plano.priceCents &&
        ctx.subscription.promoDisponivel
      return {
        hojeCents: promo ? plano.firstMonthPriceCents! : plano.priceCents,
        depoisCents: plano.priceCents,
        promo,
      }
    }
    if (item.tipo === "creditos") {
      return { hojeCents: item.minutos * ctx.package.centsPerMinute, depoisCents: null, promo: false }
    }
    if (item.tipo === "extras") {
      // Mesma conta do servidor (ver lib/precoDasConexoesExtras): o par tem
      // desconto, e o desconto vale por par. Aqui é só para MOSTRAR — quem
      // decide quanto cobrar é o servidor, que recalcula tudo de novo.
      const p = ctx.subscription.precosExtras
      if (!p) return { hojeCents: 0, depoisCents: null, promo: false }
      const pares = Math.min(item.canais, item.contas)
      const total =
        pares * p.ambos + (item.canais - pares) * p.canal + (item.contas - pares) * p.conta
      return { hojeCents: total, depoisCents: total, promo: false }
    }
    return { hojeCents: 0, depoisCents: null, promo: false }
  }, [ctx, item, plano])

  const temCartaoSalvo = Boolean(ctx?.card) && !usarOutroCartao
  const precisaDoFormulario = metodo === "cartao" && !temCartaoSalvo

  function corpoDoCartao() {
    const [mes, ano] = validade.split("/")
    return {
      titular: {
        nome,
        documento,
        email: ctx?.perfil.email,
        cep,
        numeroEndereco,
        telefone,
      },
      cartao: {
        number: soDigitos(numero),
        expiryMonth: mes || "",
        expiryYear: ano || "",
        ccv: cvv,
        holderName: nomeNoCartao,
      },
    }
  }

  async function pagar() {
    setErro(null)
    setEnviando(true)
    try {
      // Só cadastrar cartão: não há compra, então não passa pelo /pagar.
      if (item.tipo === "cartao") {
        await api.post("/api/client/checkout/cartao", corpoDoCartao())
        setConcluido({ pago: true, tipo: "cartao" })
        await carregar()
        // Quem entrou aqui já decidiu guardar o cartão; a única pergunta que
        // falta é se ele pode ser cobrado sozinho quando a cota acabar.
        setOferta("excedente")
        return
      }

      const corpo: Record<string, unknown> = { tipo: item.tipo, metodo }
      if (item.tipo === "plano") corpo.planKey = item.planKey
      if (item.tipo === "creditos") corpo.minutos = item.minutos
      if (item.tipo === "extras") {
        corpo.canais = item.canais
        corpo.contas = item.contas
      }
      if (precisaDoFormulario || metodo === "pix") Object.assign(corpo, corpoDoCartao())
      // O cartão salvo é usado pelo token guardado no servidor: nada de cartão
      // sai daqui nesse caso.
      if (temCartaoSalvo && metodo === "cartao") delete corpo.cartao

      const r = await api.post<CheckoutPagamento>("/api/client/checkout/pagar", corpo)

      if (r.pixCopiaECola && r.qrCodeBase64 && r.paymentId) {
        setPix({ paymentId: r.paymentId, copiaECola: r.pixCopiaECola, qr: r.qrCodeBase64 })
        return
      }
      setConcluido(r)

      // Pagou no cartão e ele foi aprovado: é o único momento em que existe um
      // cartão recém-usado para oferecer guardar. Em pagamento pendente não se
      // oferece nada — não há o que comemorar ainda.
      if (metodo === "cartao" && r.pago) {
        await carregar()
        setOferta("salvar")
      }
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não consegui concluir o pagamento agora.")
    } finally {
      setEnviando(false)
    }
  }

  async function manterCartaoSalvo() {
    // O cartão já está guardado (foi ele que pagou). "Salvar" aqui é confirmar
    // que ele fica — o que muda é só passar para a pergunta seguinte.
    setOferta("excedente")
  }

  async function descartarCartao() {
    setOfertaOcupada(true)
    try {
      await api.delete("/api/client/checkout/cartao")
    } catch {
      // Se falhar, o cartão continua salvo e o cliente pode remover em "Plano
      // e uso". Não vale segurar a tela de sucesso por causa disso.
    } finally {
      setOfertaOcupada(false)
      setOferta(null)
    }
  }

  async function ativarExcedente() {
    setOfertaOcupada(true)
    try {
      await api.post("/api/client/billing/overage-card/enable")
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não consegui ativar agora.")
    } finally {
      setOfertaOcupada(false)
      setOferta(null)
    }
  }

  const podePagar =
    !enviando &&
    (metodo === "pix"
      ? nome.trim().length >= 3 && soDigitos(documento).length >= 11
      : temCartaoSalvo
        ? true
        : passaNoLuhn(numero) &&
          soDigitos(numero).length >= 13 &&
          validade.length === 5 &&
          cvv.length >= 3 &&
          nomeNoCartao.trim().length >= 3 &&
          nome.trim().length >= 3 &&
          soDigitos(documento).length >= 11 &&
          soDigitos(cep).length === 8 &&
          numeroEndereco.trim().length > 0)

  const titulo =
    item.tipo === "plano"
      ? `Assinar ${plano?.name ?? ""}`.trim()
      : item.tipo === "creditos"
        ? "Comprar créditos"
        : item.tipo === "extras"
          ? "Conexões extras"
          : "Cadastrar cartão"

  return (
    <div className="flex min-h-screen flex-col bg-muted/30">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-[1080px] items-center justify-between gap-4 px-4 py-3.5 sm:px-6">
          <a href="/client/billing" className="flex items-center gap-2.5">
            <BrandMark className="size-7" />
            <span className="font-heading text-base font-bold tracking-tight">Post Flow</span>
          </a>
          <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground">
            <IconLock className="size-3.5" />
            Pagamento seguro
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1080px] flex-1 px-4 py-6 sm:px-6 sm:py-10">
        <a
          href="/client/billing"
          className="mb-5 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
        >
          <IconArrowLeft className="size-4" />
          Voltar para Plano e uso
        </a>

        {!ctx || !preco ? (
          <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
            <Skeleton className="h-96" />
            <Skeleton className="h-64" />
          </div>
        ) : concluido ? (
          <ConcluidoView concluido={concluido} item={item} planName={plano?.name ?? null} />
        ) : (
          <>
            <h1 className="font-heading mb-1 text-2xl font-semibold tracking-tight">{titulo}</h1>
            <p className="mb-6 text-sm text-muted-foreground">
              {item.tipo === "cartao"
                ? "Guarde um cartão para as cobranças automáticas. Nada é cobrado agora."
                : "Confira o resumo e escolha como quer pagar."}
            </p>

            <div className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-start">
              {/* O resumo vem PRIMEIRO no celular (order-first) e à direita no
                  desktop: quanto se vai pagar não pode depender de rolar. */}
              <aside className="order-first flex flex-col gap-4 lg:order-last lg:sticky lg:top-6">
                <ResumoDoPedido ctx={ctx} item={item} plano={plano} preco={preco} mostrarTunel={mostrarTunel} />
                <SeloDeConfianca cnpj={ctx.empresa.cnpj} empresa={ctx.empresa.nome} />
              </aside>

              <section className="flex flex-col gap-5 rounded-xl border border-border bg-background p-5 shadow-[var(--shadow-raised)] sm:p-6">
                {pix ? (
                  <PixView pix={pix} copiado={copiado} setCopiado={setCopiado} />
                ) : (
                  <>
                    {item.tipo !== "cartao" && (
                      <MetodoSeletor
                        metodo={metodo}
                        setMetodo={setMetodo}
                        pixDisponivel={item.tipo === "creditos"}
                      />
                    )}

                    {metodo === "cartao" && ctx.card && (
                      <CartaoSalvo
                        card={ctx.card}
                        usandoOutro={usarOutroCartao}
                        onTrocar={() => setUsarOutroCartao((v) => !v)}
                      />
                    )}

                    {precisaDoFormulario && (
                      <FormularioDeCartao
                        numero={numero}
                        setNumero={setNumero}
                        validade={validade}
                        setValidade={setValidade}
                        cvv={cvv}
                        setCvv={setCvv}
                        nomeNoCartao={nomeNoCartao}
                        setNomeNoCartao={setNomeNoCartao}
                      />
                    )}

                    {(precisaDoFormulario || metodo === "pix") && (
                      <DadosDoTitular
                        pix={metodo === "pix"}
                        nome={nome}
                        setNome={setNome}
                        documento={documento}
                        setDocumento={setDocumento}
                        telefone={telefone}
                        setTelefone={setTelefone}
                        cep={cep}
                        setCep={setCep}
                        numeroEndereco={numeroEndereco}
                        setNumeroEndereco={setNumeroEndereco}
                      />
                    )}

                    {erro && (
                      <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                        {erro}
                      </p>
                    )}

                    <Button size="lg" className="w-full gap-2" disabled={!podePagar} onClick={pagar}>
                      {enviando ? (
                        <>
                          <IconLoader2 className="size-4 animate-spin" />
                          Processando...
                        </>
                      ) : item.tipo === "cartao" ? (
                        "Salvar cartão"
                      ) : metodo === "pix" ? (
                        <>
                          <IconQrcode className="size-4" />
                          Gerar código PIX
                        </>
                      ) : (
                        <>
                          <IconLock className="size-4" />
                          Pagar {formatCents(preco.hojeCents)}
                        </>
                      )}
                    </Button>

                    {/* A fileira de bandeiras já está lá em cima, colada no
                        campo do número, onde ela serve pra alguma coisa.
                        Repeti-la aqui era só enfeite duplicado. */}
                    <span className="flex items-center justify-center gap-1.5 text-[12px] font-medium text-muted-foreground">
                      <IconLock className="size-3.5" />
                      Pagamento processado por Asaas
                    </span>

                    <p className="text-center text-[11.5px] leading-relaxed text-muted-foreground">
                      Ao continuar você concorda com os{" "}
                      <a href="/termos" target="_blank" className="underline underline-offset-2">
                        Termos de Uso
                      </a>{" "}
                      e a{" "}
                      <a href="/privacidade" target="_blank" className="underline underline-offset-2">
                        Política de Privacidade
                      </a>
                      .
                    </p>
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </main>

      {/* Oferta de guardar o cartão, depois do pagamento aprovado.
          Regra do fluxo: SALVAR NÃO É AUTORIZAR. São dois passos porque são
          duas decisões — e a segunda (deixar o cartão ser cobrado sozinho)
          nunca acontece por padrão, só com um clique dedicado. */}
      <Dialog open={oferta !== null} onOpenChange={(aberto) => !aberto && setOferta(null)}>
        <DialogContent className="sm:max-w-md">
          {oferta === "salvar" ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 pr-6">
                  <IconCircleCheck className="size-5 text-emerald-500" />
                  Pagamento aprovado
                </DialogTitle>
                <DialogDescription>
                  Quer deixar este cartão salvo para as próximas compras?
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4">
                {ctx?.card && (
                  <div className="flex items-center gap-2.5 rounded-lg border border-border bg-muted/40 px-3.5 py-3">
                    {(() => {
                      const marca = bandeiraDoAsaas(ctx.card.brand)
                      return marca ? (
                        <Bandeira id={marca} />
                      ) : (
                        <IconCreditCard className="size-4 shrink-0 text-muted-foreground" />
                      )
                    })()}
                    <span className="text-sm">
                      {(() => {
                        const marca = bandeiraDoAsaas(ctx.card.brand)
                        return marca ? NOME_DA_BANDEIRA[marca] : "Cartão"
                      })()}{" "}
                      <span className="tabular-nums">•••• {ctx.card.last4}</span>
                    </span>
                  </div>
                )}

                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  Salvando, você não precisa digitar o número de novo quando comprar créditos ou trocar de
                  plano. <strong className="text-foreground">Nada é cobrado por deixá-lo salvo</strong> — só
                  quando você autorizar uma compra.
                </p>

                <div className="flex flex-col gap-2">
                  <Button onClick={manterCartaoSalvo} disabled={ofertaOcupada}>
                    Salvar cartão
                  </Button>
                  <Button variant="ghost" onClick={descartarCartao} disabled={ofertaOcupada}>
                    {ofertaOcupada ? "..." : "Não salvar"}
                  </Button>
                </div>

                <p className="text-center text-[11.5px] leading-relaxed text-muted-foreground">
                  Guardamos só uma referência ao cartão no Asaas — o número não fica com a gente. Se você
                  assinou um plano, a mensalidade continua sendo cobrada normalmente de qualquer forma.
                </p>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="pr-6">Quer usar este cartão quando a cota acabar?</DialogTitle>
                <DialogDescription>
                  Isto é opcional e está <strong>desligado</strong>. Só liga se você clicar.
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-4">
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  Quando os minutos da semana acabam, os vídeos param de ser processados até a virada. Com
                  isto ligado, eles continuam saindo e você paga só o que passou do plano
                  {ctx && (
                    <>
                      {" "}
                      — <strong className="text-foreground">{formatCents(ctx.overage.rateCentsNormal)} por
                      minuto</strong> de vídeo
                      {mostrarTunel && <>, ou {formatCents(ctx.overage.rateCentsBonus)} usando a sua própria internet</>}
                    </>
                  )}
                  .
                </p>

                <div className="rounded-lg border border-border bg-muted/40 p-3">
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    A cobrança acontece <strong className="text-foreground">antes</strong> de cada vídeo, no
                    valor exato dos minutos que passaram — nunca um valor fechado. Dá para desligar quando
                    quiser em "Plano e uso".
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <Button onClick={ativarExcedente} disabled={ofertaOcupada}>
                    {ofertaOcupada ? "Ativando..." : "Ativar cobrança automática"}
                  </Button>
                  <Button variant="ghost" onClick={() => setOferta(null)} disabled={ofertaOcupada}>
                    Agora não
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <footer className="border-t border-border bg-background py-5">
        <p className="mx-auto max-w-[1080px] px-4 text-center text-[11.5px] text-muted-foreground sm:px-6">
          Dúvidas sobre a cobrança? Escreva para{" "}
          <a href={`mailto:${EMAIL_SUPORTE}`} className="underline underline-offset-2">
            {EMAIL_SUPORTE}
          </a>
        </p>
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------

function MetodoSeletor({
  metodo,
  setMetodo,
  pixDisponivel,
}: {
  metodo: Metodo
  setMetodo: (m: Metodo) => void
  pixDisponivel: boolean
}) {
  const opcoes: { id: Metodo; rotulo: string; icone: React.ReactNode; nota?: string }[] = [
    { id: "cartao", rotulo: "Cartão de crédito", icone: <IconCreditCard className="size-4" /> },
    ...(pixDisponivel
      ? [{ id: "pix" as const, rotulo: "PIX", icone: <IconQrcode className="size-4" />, nota: "Cai na hora" }]
      : []),
  ]
  if (opcoes.length === 1) return null

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-medium">Como você quer pagar</span>
      <div className="grid gap-2 sm:grid-cols-2">
        {opcoes.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => setMetodo(o.id)}
            aria-pressed={metodo === o.id}
            className={`flex items-center gap-2.5 rounded-lg border px-3.5 py-3 text-left text-sm transition-colors ${
              metodo === o.id
                ? "border-primary bg-primary/[0.05] font-medium"
                : "border-border hover:bg-muted"
            }`}
          >
            <span className={metodo === o.id ? "text-primary" : "text-muted-foreground"}>{o.icone}</span>
            <span className="flex-1">{o.rotulo}</span>
            {o.nota && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                {o.nota}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function CartaoSalvo({
  card,
  usandoOutro,
  onTrocar,
}: {
  card: { brand: string | null; last4: string | null; exp: string | null }
  usandoOutro: boolean
  onTrocar: () => void
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3.5 py-3">
      <span className="flex items-center gap-2 text-sm">
        <IconCreditCard className="size-4 text-muted-foreground" />
        <span className={usandoOutro ? "text-muted-foreground line-through" : ""}>
          {card.brand ?? "Cartão"} <span className="tabular-nums">•••• {card.last4}</span>
        </span>
      </span>
      <Button variant="ghost" size="sm" onClick={onTrocar}>
        {usandoOutro ? "Usar o cartão salvo" : "Usar outro cartão"}
      </Button>
    </div>
  )
}

function FormularioDeCartao({
  numero,
  setNumero,
  validade,
  setValidade,
  cvv,
  setCvv,
  nomeNoCartao,
  setNomeNoCartao,
}: {
  numero: string
  setNumero: (v: string) => void
  validade: string
  setValidade: (v: string) => void
  cvv: string
  setCvv: (v: string) => void
  nomeNoCartao: string
  setNomeNoCartao: (v: string) => void
}) {
  const bandeira = detectarBandeira(numero)
  const digitos = soDigitos(numero)
  // Só reclama quando o número já tem tamanho de cartão: avisar "inválido"
  // no meio da digitação é errado e ainda parece que o cartão foi recusado.
  const numeroCompleto = digitos.length >= 13
  const numeroInvalido = numeroCompleto && !passaNoLuhn(digitos)

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-[13px] font-medium">Dados do cartão</span>
          <span className="text-[12px] text-muted-foreground">
            {bandeira ? NOME_DA_BANDEIRA[bandeira] : "Aceitamos"}
          </span>
        </div>
        {/* Uma peça só faz dois trabalhos: antes de digitar, mostra o que é
            aceito; depois, apaga as outras e confirma qual foi reconhecida. */}
        <FileiraDeBandeiras detectada={bandeira} />
      </div>

      <Campo label="Número do cartão">
        {/* A bandeira reconhecida fica exposta aqui pra poder ser conferida de
            fora (teste de tela). Sem isso, a única forma de verificar seria ler
            o desenho, e a fileira de bandeiras aceitas desenha todas elas o
            tempo todo - o que dá falso positivo em qualquer checagem. */}
        <div className="relative" data-bandeira={bandeira ?? "nenhuma"}>
          <Input
            value={numero}
            onChange={(e) => setNumero(mascaraCartao(e.target.value))}
            inputMode="numeric"
            autoComplete="cc-number"
            placeholder="0000 0000 0000 0000"
            aria-invalid={numeroInvalido}
            className={`pr-16 tabular-nums ${numeroInvalido ? "border-destructive focus-visible:ring-destructive/30" : ""}`}
          />
          {/* A bandeira aparece DENTRO do campo, do lado do número, no momento
              em que é reconhecida. É a confirmação que quem está com o cartão
              na mão procura: "ele aceita o meu". */}
          {bandeira && (
            <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2">
              <Bandeira id={bandeira} />
            </span>
          )}
        </div>
      </Campo>

      {numeroInvalido && (
        <p className="-mt-2 text-[12px] text-destructive">
          Confira o número do cartão — parece faltar ou sobrar um dígito.
        </p>
      )}

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Campo label="Validade">
          <Input
            value={validade}
            onChange={(e) => setValidade(mascaraValidade(e.target.value))}
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM/AA"
            className="tabular-nums"
          />
        </Campo>
        <Campo label="Código de segurança">
          <Input
            value={cvv}
            onChange={(e) => setCvv(soDigitos(e.target.value).slice(0, 4))}
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="CVV"
            className="tabular-nums"
          />
        </Campo>
      </div>

      <Campo label="Nome impresso no cartão">
        <Input
          value={nomeNoCartao}
          onChange={(e) => setNomeNoCartao(e.target.value.toUpperCase())}
          autoComplete="cc-name"
          placeholder="COMO ESTÁ NO CARTÃO"
        />
      </Campo>
    </div>
  )
}

function DadosDoTitular({
  pix,
  nome,
  setNome,
  documento,
  setDocumento,
  telefone,
  setTelefone,
  cep,
  setCep,
  numeroEndereco,
  setNumeroEndereco,
}: {
  pix: boolean
  nome: string
  setNome: (v: string) => void
  documento: string
  setDocumento: (v: string) => void
  telefone: string
  setTelefone: (v: string) => void
  cep: string
  setCep: (v: string) => void
  numeroEndereco: string
  setNumeroEndereco: (v: string) => void
}) {
  return (
    <div className="flex flex-col gap-3.5 border-t border-border pt-5">
      <div>
        <span className="text-[13px] font-medium">{pix ? "Seus dados" : "Dados de cobrança"}</span>
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
          {pix
            ? "O emissor do PIX exige a identificação de quem está pagando."
            : "O banco emissor do cartão confere estes dados antes de aprovar. Use o endereço da fatura."}
        </p>
      </div>

      <Campo label={pix ? "Nome completo" : "Nome completo do titular"}>
        <Input value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" />
      </Campo>

      <div className="grid gap-3.5 sm:grid-cols-2">
        <Campo label="CPF ou CNPJ">
          <Input
            value={documento}
            onChange={(e) => setDocumento(mascaraDocumento(e.target.value))}
            inputMode="numeric"
            className="tabular-nums"
          />
        </Campo>
        <Campo label="Celular" dica="Opcional">
          <Input
            value={telefone}
            onChange={(e) => setTelefone(mascaraTelefone(e.target.value))}
            inputMode="numeric"
            autoComplete="tel"
            placeholder="(00) 00000-0000"
            className="tabular-nums"
          />
        </Campo>
      </div>

      {!pix && (
        <div className="grid gap-3.5 sm:grid-cols-[1fr_140px]">
          <Campo label="CEP da fatura">
            <Input
              value={cep}
              onChange={(e) => setCep(mascaraCep(e.target.value))}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="00000-000"
              className="tabular-nums"
            />
          </Campo>
          <Campo label="Número">
            <Input value={numeroEndereco} onChange={(e) => setNumeroEndereco(e.target.value)} />
          </Campo>
        </div>
      )}
    </div>
  )
}

function PixView({
  pix,
  copiado,
  setCopiado,
}: {
  pix: { copiaECola: string; qr: string }
  copiado: boolean
  setCopiado: (v: boolean) => void
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-2 text-center">
      <h2 className="font-heading text-lg font-semibold">Escaneie para pagar</h2>
      <img
        src={`data:image/png;base64,${pix.qr}`}
        alt="QR Code do PIX"
        className="size-56 rounded-lg border border-border bg-white p-2"
      />
      {/* Quem paga pelo computador não consegue ler o QR da própria tela — por
          isso o copia-e-cola precisa existir junto, não como alternativa
          escondida. */}
      <Button
        variant="outline"
        className="w-full gap-2"
        onClick={() => {
          navigator.clipboard.writeText(pix.copiaECola)
          setCopiado(true)
          setTimeout(() => setCopiado(false), 2000)
        }}
      >
        <IconCopy className="size-4" />
        {copiado ? "Código copiado" : "Copiar código PIX"}
      </Button>
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <IconLoader2 className="size-4 animate-spin" />
        Esperando o pagamento. Esta tela se atualiza sozinha.
      </p>
    </div>
  )
}

function ResumoDoPedido({
  ctx,
  item,
  plano,
  preco,
  mostrarTunel,
}: {
  ctx: CheckoutContexto
  item: CheckoutItem
  plano: CheckoutContexto["plans"][number] | null
  preco: { hojeCents: number; depoisCents: number | null; promo: boolean }
  mostrarTunel: boolean
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-background p-5 shadow-[var(--shadow-raised)]">
      <h2 className="font-heading text-base font-semibold">Resumo do pedido</h2>

      {item.tipo === "plano" && plano && (
        <>
          <div className="flex flex-col gap-1">
            <LinhaResumo rotulo={`Plano ${plano.name}`} valor={formatCents(preco.hojeCents)} />
            {preco.promo && (
              <LinhaResumo
                suave
                rotulo="Preço normal"
                valor={<span className="line-through">{formatCents(plano.priceCents)}</span>}
              />
            )}
          </div>
          <ul className="flex flex-col gap-2 border-t border-border pt-4">
            <Beneficio icone={<IconClock className="size-4" />} texto={`${plano.weeklyMinutesNormal} minutos de vídeo por semana`} />
            {/* Minutos que só existem com o programa instalado. Com a exibição
                do túnel desligada, anunciá-los no resumo de um pagamento seria
                vender algo que o cliente não tem como usar. */}
            {mostrarTunel && (
              <Beneficio icone={<IconRouter className="size-4" />} texto={`${plano.weeklyMinutesBonus} minutos por semana usando a sua internet`} />
            )}
            <Beneficio
              icone={<IconBrandYoutube className="size-4" />}
              texto={`${plano.maxYoutubeChannels ?? "∞"} ${plano.maxYoutubeChannels === 1 ? "canal do YouTube" : "canais do YouTube"}`}
            />
            <Beneficio
              icone={<IconBrandTiktok className="size-4" />}
              texto={`${plano.maxTiktokAccounts ?? "∞"} ${plano.maxTiktokAccounts === 1 ? "conta do TikTok" : "contas do TikTok"}`}
            />
            {plano.extraBothPriceCents && (
              <Beneficio
                icone={<IconPlus className="size-4" />}
                texto={`Pode comprar canal extra por ${formatCents(plano.extraChannelPriceCents!)}/mês ou conta extra por ${formatCents(plano.extraTiktokPriceCents!)}/mês`}
              />
            )}
          </ul>
        </>
      )}

      {item.tipo === "creditos" && (
        <>
          <LinhaResumo rotulo={`${item.minutos} minutos de crédito`} valor={formatCents(preco.hojeCents)} />
          <p className="border-t border-border pt-4 text-[12.5px] leading-relaxed text-muted-foreground">
            {formatCents(ctx.package.centsPerMinute)} por minuto de vídeo — o mesmo preço que você pagaria
            estourando a cota. Créditos avulsos não expiram e não somem na virada da semana.
          </p>
        </>
      )}

      {item.tipo === "extras" && (
        <>
          <LinhaResumo
            rotulo={[
              item.canais > 0 ? `${item.canais} canal${item.canais > 1 ? "is" : ""} do YouTube` : null,
              item.contas > 0 ? `${item.contas} conta${item.contas > 1 ? "s" : ""} do TikTok` : null,
            ]
              .filter(Boolean)
              .join(" + ")}
            valor={formatCents(preco.hojeCents)}
          />
          <p className="border-t border-border pt-4 text-[12.5px] leading-relaxed text-muted-foreground">
            Cada conexão libera <strong className="text-foreground">1 canal do YouTube e 1 conta do TikTok</strong>{" "}
            a mais, cobrada todo mês junto com o seu plano. Você pode cancelar quando quiser — o mês já pago
            não é devolvido.
          </p>
        </>
      )}

      {item.tipo === "cartao" && (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Nenhum valor é cobrado agora. O cartão fica salvo para as cobranças automáticas: quando a sua cota
          semanal acabar, o vídeo continua sendo processado e você paga só o que passou.
        </p>
      )}

      {item.tipo !== "cartao" && (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <LinhaResumo forte rotulo="Total hoje" valor={formatCents(preco.hojeCents)} />
          {/* O segundo degrau do preço fica escrito ANTES do pagamento. Deixar
              para a fatura do mês seguinte é o que gera estorno. */}
          {item.tipo === "plano" && preco.depoisCents !== null && (
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              {preco.promo ? (
                <>
                  Depois do primeiro mês, {formatCents(preco.depoisCents)} por mês. Cancele quando quiser.
                </>
              ) : (
                <>Renova automaticamente por {formatCents(preco.depoisCents)} todo mês. Cancele quando quiser.</>
              )}
            </p>
          )}
          {item.tipo === "extras" && (
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Depois, {formatCents(preco.depoisCents ?? 0)} por mês enquanto as conexões estiverem ativas.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ConcluidoView({
  concluido,
  item,
  planName,
}: {
  concluido: CheckoutPagamento
  item: CheckoutItem
  planName: string | null
}) {
  // "Em análise" não é fracasso nem sucesso: alguns cartões levam minutos para
  // responder. Dizer "pronto" seria mentir, e dizer "falhou" mandaria a pessoa
  // pagar de novo — o que poderia cobrar duas vezes.
  const emAnalise = !concluido.pago
  return (
    <div className="mx-auto flex max-w-[520px] flex-col items-center gap-5 rounded-xl border border-border bg-background px-6 py-12 text-center shadow-[var(--shadow-raised)]">
      {emAnalise ? (
        <IconClock className="size-14 text-muted-foreground" />
      ) : (
        <IconCircleCheck className="size-14 text-emerald-500" />
      )}
      <div>
        <h1 className="font-heading text-xl font-semibold">
          {emAnalise
            ? "Pagamento em análise"
            : item.tipo === "plano"
              ? `Plano ${planName ?? ""} ativado`
              : item.tipo === "creditos"
                ? "Créditos adicionados"
                : item.tipo === "extras"
                  ? "Conexões liberadas"
                  : "Cartão salvo"}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {emAnalise
            ? "O banco está confirmando a cobrança. Assim que o resultado sair, liberamos tudo sozinho — não precisa pagar de novo."
            : item.tipo === "plano"
              ? "Sua cota semanal já está disponível e os vídeos parados voltaram para a fila."
              : item.tipo === "creditos"
                ? "Os minutos já estão no seu saldo."
                : item.tipo === "extras"
                  ? "Você já pode conectar mais um canal e mais uma conta do TikTok."
                  : "Ele será usado nas cobranças automáticas."}
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild>
          <a href="/client">Ir para o painel</a>
        </Button>
        <Button variant="outline" asChild>
          <a href="/client/billing">Ver plano e uso</a>
        </Button>
      </div>
    </div>
  )
}
