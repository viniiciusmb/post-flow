/**
 * Os três passos que fazem o sistema começar a trabalhar.
 *
 * Aparece na tela inicial de quem ainda não terminou de configurar e SOME
 * sozinho quando os três estão feitos - um checklist que fica para sempre vira
 * ruído e ensina a pessoa a ignorar avisos.
 *
 * A ordem não é arbitrária: a conta do TikTok é o destino dos cortes e o canal
 * aponta pra ela, então conectar primeiro evita ter que voltar; o estilo vale
 * pra tudo que for cortado dali pra frente; e o canal é o que liga a máquina.
 */
import { useEffect, useState } from "react"
import { IconBrandTiktok, IconCheck, IconScissors, IconBrandYoutube, IconArrowRight } from "@tabler/icons-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { api } from "@/lib/api"
import { useT, type ChaveDeTraducao } from "@/i18n"
import type { OnboardingStatus } from "@/types/api"

const PASSOS: {
  chave: keyof Pick<OnboardingStatus, "tiktokConectado" | "estiloConfigurado" | "canalMonitorado">
  titulo: ChaveDeTraducao
  texto: ChaveDeTraducao
  url: string
  icone: typeof IconBrandTiktok
}[] = [
  {
    chave: "tiktokConectado",
    titulo: "guia.passo1",
    texto: "guia.passo1Texto",
    url: "/client/tiktok-account",
    icone: IconBrandTiktok,
  },
  {
    chave: "estiloConfigurado",
    titulo: "guia.passo2",
    texto: "guia.passo2Texto",
    url: "/client/videos-clips",
    icone: IconScissors,
  },
  {
    chave: "canalMonitorado",
    titulo: "guia.passo3",
    texto: "guia.passo3Texto",
    url: "/client/youtube-channels",
    icone: IconBrandYoutube,
  },
]

/**
 * Modo prévia, pela barra de endereço:
 *
 *   ?guia=1     mostra o checklist mesmo com tudo pronto (status real)
 *   ?guia=novo  mostra como quem acabou de criar a conta enxerga
 *
 * Existe porque quem já configurou tudo nunca mais vê o checklist - que é o
 * certo, mas impede de conferir como ele ficou sem desfazer a própria
 * configuração. Não muda nada no banco: sai da tela quando o endereço sai.
 */
function lerPrevia(): "nao" | "real" | "novo" {
  const guia = new URLSearchParams(window.location.search).get("guia")
  if (guia === "novo") return "novo"
  if (guia === "1") return "real"
  return "nao"
}

const ZERADO: OnboardingStatus = {
  tiktokConectado: false,
  estiloConfigurado: false,
  canalMonitorado: false,
  concluido: false,
  contasTiktok: 0,
  canais: 0,
}

export function OnboardingChecklist() {
  const t = useT()
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [previa] = useState(lerPrevia)

  useEffect(() => {
    // Falha em silêncio de propósito: se esta chamada não responder, a tela
    // inicial abre sem o checklist em vez de mostrar um erro por causa de um
    // cartão auxiliar.
    api.get<OnboardingStatus>("/api/client/onboarding").then(setStatus).catch(() => {})
  }, [])

  const dados = previa === "novo" ? ZERADO : status
  if (!dados) return null
  // Terminou o checklist? Ele some - a menos que a pessoa tenha pedido a
  // prévia de propósito pelo endereço.
  if (dados.concluido && previa === "nao") return null

  const feitos = PASSOS.filter((p) => dados[p.chave]).length
  const proximo = PASSOS.find((p) => !dados[p.chave])

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="font-heading text-base font-semibold">{t("guia.titulo")}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("guia.subtitulo")}</p>
          </div>
          <span className="flex shrink-0 flex-wrap items-center gap-2">
            {/* Sem este selo, quem já configurou tudo abriria a prévia e
                acharia que a configuração dele foi desfeita. */}
            {previa !== "nao" && (
              <span className="rounded-full border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {t("guia.previa")}
              </span>
            )}
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              {t("guia.progresso", { feitos, total: PASSOS.length })}
            </span>
          </span>
        </div>

        <ol className="flex flex-col gap-2">
          {PASSOS.map((passo, i) => {
            const feito = dados[passo.chave]
            const ehProximo = proximo?.chave === passo.chave
            const Icone = passo.icone
            return (
              <li
                key={passo.chave}
                className={`flex flex-wrap items-center gap-3 rounded-lg border p-3 ${
                  ehProximo ? "border-primary/50 bg-card" : "border-transparent bg-muted/40"
                }`}
              >
                <span
                  className={`flex size-7 shrink-0 items-center justify-center rounded-full ${
                    feito ? "bg-status-posted text-white" : ehProximo ? "bg-primary text-primary-foreground" : "bg-muted-foreground/15 text-muted-foreground"
                  }`}
                >
                  {feito ? <IconCheck className="size-4" /> : <Icone className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${feito ? "text-muted-foreground line-through" : ""}`}>
                    {i + 1}. {t(passo.titulo)}
                  </p>
                  {!feito && <p className="text-xs text-muted-foreground">{t(passo.texto)}</p>}
                </div>
                {!feito && (
                  <Button asChild size="sm" variant={ehProximo ? "default" : "outline"} className="shrink-0 gap-1">
                    <a href={passo.url}>
                      {t("guia.ir")} <IconArrowRight className="size-3.5" />
                    </a>
                  </Button>
                )}
              </li>
            )
          })}
        </ol>

        <p className="text-xs text-muted-foreground">
          {t("guia.duvida")}{" "}
          <a href="/client/tutorial" className="font-medium text-primary underline underline-offset-2">
            {t("guia.verTutorial")}
          </a>
        </p>
      </CardContent>
    </Card>
  )
}
