/**
 * Tour guiado: caixas que apontam os controles da tela DE VERDADE.
 *
 * Diferente do menu Tutorial, que é leitura. Aqui a pessoa fica no painel, o
 * fundo escurece, o controle da vez fica aceso e uma caixa explica o que ele
 * faz — "primeiro você vem aqui, clica nisso, e isso serve pra tal coisa".
 *
 * O tour ATRAVESSA PÁGINAS. Cada tela do painel é uma página separada (não é
 * uma SPA com rotas), então avançar de um passo de Cortes para um de Canais é
 * uma navegação de verdade: o passo atual fica no localStorage e este
 * componente, que é montado em todas as telas pelo DashboardLayout, retoma de
 * onde parou quando a página nova abre.
 *
 * Feito à mão em vez de usar uma biblioteca de tour: o que ele precisa fazer é
 * medir um elemento, escurecer o resto e posicionar uma caixa. Uma dependência
 * traria tema próprio pra brigar com o nosso, e mais peso do que o recurso.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { IconArrowRight, IconArrowLeft, IconX, IconSparkles } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { useI18n, useT } from "@/i18n"
import { PASSOS_DO_TOUR, type PassoDoTour } from "@/content/tour"
import { useAuth } from "@/hooks/useAuth"

const CHAVE_PASSO = "postflow-tour-passo"
const CHAVE_ATIVO = "postflow-tour-ativo"
/** Marca que o tour já foi visto, pra não reabrir sozinho toda vez. */
const CHAVE_VISTO = "postflow-tour-visto"

const MARGEM = 8
const LARGURA_CAIXA = 340

type Caixa = { top: number; left: number; width: number; height: number }

function lerNumero(chave: string, padrao: number) {
  const bruto = localStorage.getItem(chave)
  const n = Number(bruto)
  return Number.isFinite(n) && bruto !== null ? n : padrao
}

/** O tour está rodando? Exportado pra tela inicial poder oferecer "continuar". */
export function tourEstaAtivo() {
  try {
    return localStorage.getItem(CHAVE_ATIVO) === "1"
  } catch {
    return false
  }
}

export function iniciarTour(doZero = true) {
  try {
    if (doZero) localStorage.setItem(CHAVE_PASSO, "0")
    localStorage.setItem(CHAVE_ATIVO, "1")
    const primeiro = PASSOS_DO_TOUR[doZero ? 0 : lerNumero(CHAVE_PASSO, 0)]
    if (primeiro && primeiro.pagina !== window.location.pathname) {
      window.location.href = primeiro.pagina
      return
    }
    window.dispatchEvent(new Event("postflow-tour"))
  } catch {
    /* localStorage bloqueado (aba anônima com site data desligado): sem tour. */
  }
}

export function GuidedTour({ autoIniciar = false }: { autoIniciar?: boolean }) {
  const t = useT()
  const { idioma } = useI18n()
  const { mostrarTunel } = useAuth()
  const [ativo, setAtivo] = useState(false)
  const [indice, setIndice] = useState(0)
  const [alvo, setAlvo] = useState<Caixa | null>(null)
  const [pronto, setPronto] = useState(false)
  const caixaRef = useRef<HTMLDivElement>(null)

  // O roteiro depende do que o produto está oferecendo: com a exibição do
  // túnel desligada, o passo "Sua conexão" sai fora. Deixá-lo levaria o tour a
  // navegar pra uma tela que hoje redireciona, e o tour terminaria sozinho no
  // meio, numa página que não é a dele.
  //
  // useMemo porque a lista é recriada a cada render e ela alimenta um efeito
  // que mede o alvo na tela — sem isso o efeito rodaria sem parar.
  const passos = useMemo(
    () => PASSOS_DO_TOUR.filter((p) => mostrarTunel || !p.soComTunel),
    [mostrarTunel]
  )
  const passo: PassoDoTour | undefined = passos[indice]

  // --- ligar/desligar ---
  const sincronizar = useCallback(() => {
    try {
      const rodando = localStorage.getItem(CHAVE_ATIVO) === "1"
      setIndice(lerNumero(CHAVE_PASSO, 0))
      setAtivo(rodando)
    } catch {
      setAtivo(false)
    }
  }, [])

  useEffect(() => {
    sincronizar()
    window.addEventListener("postflow-tour", sincronizar)
    return () => window.removeEventListener("postflow-tour", sincronizar)
  }, [sincronizar])

  // Abre sozinho na primeira visita de quem ainda não configurou nada.
  useEffect(() => {
    if (!autoIniciar) return
    try {
      if (localStorage.getItem(CHAVE_VISTO) === "1") return
      if (localStorage.getItem(CHAVE_ATIVO) === "1") return
      localStorage.setItem(CHAVE_VISTO, "1")
      iniciarTour(true)
    } catch {
      /* sem localStorage, sem abertura automática */
    }
  }, [autoIniciar])

  const encerrar = useCallback(() => {
    try {
      localStorage.setItem(CHAVE_ATIVO, "0")
      localStorage.setItem(CHAVE_VISTO, "1")
      localStorage.setItem(CHAVE_PASSO, "0")
    } catch { /* ignora */ }
    setAtivo(false)
  }, [])

  const irPara = useCallback(
    (novo: number) => {
      const destino = passos[novo]
      if (!destino) {
        encerrar()
        return
      }
      try {
        localStorage.setItem(CHAVE_PASSO, String(novo))
      } catch { /* ignora */ }
      // Passo de outra tela: navega de verdade e o tour retoma lá.
      if (destino.pagina !== window.location.pathname) {
        window.location.href = destino.pagina
        return
      }
      setPronto(false)
      setIndice(novo)
    },
    [passos, encerrar]
  )

  // --- medir o alvo ---
  const medir = useCallback(() => {
    if (!passo?.alvo) {
      setAlvo(null)
      setPronto(true)
      return
    }
    const el = document.querySelector(passo.alvo)
    if (!el) {
      // O controle não existe nesta conta (ex.: cartão de canal em quem ainda
      // não tem canal). A caixa aparece centralizada em vez de o tour travar.
      setAlvo(null)
      setPronto(true)
      return
    }
    const r = el.getBoundingClientRect()
    setAlvo({ top: r.top, left: r.left, width: r.width, height: r.height })
    setPronto(true)
  }, [passo])

  // Antes de medir, executa a ação do passo (abrir um painel, por exemplo) e
  // traz o alvo pra vista. Sem isso, o passo que explica algo dentro de um
  // painel fechado apontaria pro nada.
  useEffect(() => {
    if (!ativo || !passo) return
    let cancelado = false

    async function preparar() {
      if (passo!.abrir) {
        const botao = document.querySelector<HTMLElement>(passo!.abrir)
        // Só clica se o conteúdo ainda não estiver na tela - clicar de novo
        // fecharia o painel que já estava aberto.
        if (botao && passo!.alvo && !document.querySelector(passo!.alvo)) {
          botao.click()
          await new Promise((r) => setTimeout(r, 350))
        }
      }
      if (cancelado) return
      if (passo!.alvo) {
        document.querySelector(passo!.alvo)?.scrollIntoView({ block: "center", behavior: "smooth" })
        await new Promise((r) => setTimeout(r, 420))
      } else {
        window.scrollTo({ top: 0, behavior: "smooth" })
      }
      if (!cancelado) medir()
    }
    setPronto(false)
    void preparar()
    return () => {
      cancelado = true
    }
  }, [ativo, passo, medir, idioma])

  useEffect(() => {
    if (!ativo) return
    const remedir = () => medir()
    window.addEventListener("resize", remedir)
    window.addEventListener("scroll", remedir, true)
    return () => {
      window.removeEventListener("resize", remedir)
      window.removeEventListener("scroll", remedir, true)
    }
  }, [ativo, medir])

  // Setas e Esc: um tour que só obedece o mouse é um tour que trava no teclado.
  useEffect(() => {
    if (!ativo) return
    function tecla(e: KeyboardEvent) {
      if (e.key === "Escape") encerrar()
      if (e.key === "ArrowRight" || e.key === "Enter") irPara(indice + 1)
      if (e.key === "ArrowLeft") irPara(indice - 1)
    }
    window.addEventListener("keydown", tecla)
    return () => window.removeEventListener("keydown", tecla)
  }, [ativo, indice, irPara, encerrar])

  // --- posição da caixa de texto ---
  const [posCaixa, setPosCaixa] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    if (!ativo || !pronto) return
    const alturaCaixa = caixaRef.current?.offsetHeight ?? 200
    const larg = Math.min(LARGURA_CAIXA, window.innerWidth - 2 * MARGEM)
    if (!alvo) {
      setPosCaixa({
        top: Math.max(MARGEM, window.innerHeight / 2 - alturaCaixa / 2),
        left: Math.max(MARGEM, window.innerWidth / 2 - larg / 2),
      })
      return
    }
    // Abaixo do alvo quando cabe; senão acima; senão centralizada.
    const abaixo = alvo.top + alvo.height + MARGEM
    const acima = alvo.top - alturaCaixa - MARGEM
    let top: number
    if (abaixo + alturaCaixa <= window.innerHeight - MARGEM) top = abaixo
    else if (acima >= MARGEM) top = acima
    else top = Math.max(MARGEM, window.innerHeight - alturaCaixa - MARGEM)

    const desejado = alvo.left + alvo.width / 2 - larg / 2
    const left = Math.min(Math.max(MARGEM, desejado), window.innerWidth - larg - MARGEM)
    setPosCaixa({ top, left })
  }, [ativo, pronto, alvo, indice])

  if (!ativo || !passo) return null

  // Dois passos falam da cota bônus e do menu "Sua conexão" no meio da frase.
  // Escondê-los inteiros tiraria explicação que continua valendo (o que é a
  // cota, onde ver o que sobrou), então eles têm uma redação alternativa.
  const dicionarioDoTexto = !mostrarTunel && passo.textoSemTunel ? passo.textoSemTunel : passo.texto
  const texto = dicionarioDoTexto[idioma] ?? dicionarioDoTexto.pt
  const titulo = passo.titulo[idioma] ?? passo.titulo.pt
  const larguraCaixa = Math.min(LARGURA_CAIXA, typeof window !== "undefined" ? window.innerWidth - 2 * MARGEM : LARGURA_CAIXA)
  const ultimo = indice === passos.length - 1

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={titulo}>
      {/* Escurece tudo. Com alvo, o "buraco" é feito pela sombra gigante em
          volta do retângulo dele - assim o controle real continua visível e
          nítido, sem precisar duplicar nada na tela. */}
      {alvo ? (
        <div
          className="pointer-events-none absolute rounded-lg ring-2 ring-primary transition-all duration-200"
          style={{
            top: alvo.top - 4,
            left: alvo.left - 4,
            width: alvo.width + 8,
            height: alvo.height + 8,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
          }}
        />
      ) : (
        <div className="absolute inset-0 bg-black/60" />
      )}

      {/* Camada que engole cliques fora da caixa: sem ela, a pessoa clicaria
          num botão do painel achando que faz parte do tour. */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      <div
        ref={caixaRef}
        className="absolute rounded-xl border border-border bg-card p-4 shadow-2xl"
        style={{
          width: larguraCaixa,
          top: posCaixa?.top ?? 0,
          left: posCaixa?.left ?? 0,
          visibility: posCaixa ? "visible" : "hidden",
        }}
      >
        <div className="mb-2 flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            <IconSparkles className="size-3" />
            {t("tour.passoDe", { atual: indice + 1, total: passos.length })}
          </span>
          <button
            type="button"
            onClick={encerrar}
            aria-label={t("tour.sair")}
            className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <IconX className="size-4" />
          </button>
        </div>

        <h3 className="font-heading text-base font-semibold">{titulo}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{texto}</p>

        {/* Barra de progresso: numa sequência de 11 passos, saber quanto falta
            é a diferença entre seguir e desistir no meio. */}
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${((indice + 1) / passos.length) * 100}%` }}
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={encerrar}
            className="text-xs font-medium text-muted-foreground underline underline-offset-2"
          >
            {t("tour.sair")}
          </button>
          <div className="flex items-center gap-2">
            {indice > 0 && (
              <Button variant="outline" size="sm" onClick={() => irPara(indice - 1)} className="gap-1">
                <IconArrowLeft className="size-3.5" />
                {t("tour.anterior")}
              </Button>
            )}
            <Button size="sm" onClick={() => irPara(indice + 1)} className="gap-1">
              {ultimo ? t("tour.terminar") : t("tour.proximo")}
              {!ultimo && <IconArrowRight className="size-3.5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
