/**
 * Tutorial: o passo a passo completo do painel.
 *
 * A ordem das seções é a ordem em que a configuração precisa acontecer, e o
 * progresso real do cliente é lido do servidor - quem já conectou o TikTok vê
 * esse passo marcado em vez de ser mandado refazer.
 *
 * As ilustrações são réplicas em HTML (ver components/tutorial/Mockups.tsx),
 * não capturas de tela. O motivo está documentado lá.
 */
import { useEffect, useState } from "react"
import {
  IconCheck,
  IconArrowRight,
  IconAlertTriangle,
  IconMapPin,
  IconBook,
} from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader } from "@/components/dashboard/PageHeader"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { useI18n, useT } from "@/i18n"
import { TUTORIAL, type Bloco, type Passo, type TelaKey } from "@/content/tutorial"
import type { OnboardingStatus } from "@/types/api"
import {
  Legenda,
  TelaAdicionarCanal,
  TelaCartaoDoCanal,
  TelaEscopoDoEstilo,
  TelaComoEscolherCortes,
  TelaVideoEmPartes,
  TelaEstiloVisual,
  TelaConectarTiktok,
  TelaOpcoesDePublicacao,
  TelaHorarios,
  TelaFilaDePostagem,
  TelaPostados,
  TelaAcompanharCortes,
} from "@/components/tutorial/Mockups"

const TELAS: Record<TelaKey, () => React.JSX.Element> = {
  adicionarCanal: TelaAdicionarCanal,
  cartaoDoCanal: TelaCartaoDoCanal,
  escopoDoEstilo: TelaEscopoDoEstilo,
  comoEscolherCortes: TelaComoEscolherCortes,
  videoEmPartes: TelaVideoEmPartes,
  estiloVisual: TelaEstiloVisual,
  conectarTiktok: TelaConectarTiktok,
  opcoesDePublicacao: TelaOpcoesDePublicacao,
  horarios: TelaHorarios,
  filaDePostagem: TelaFilaDePostagem,
  postados: TelaPostados,
  acompanharCortes: TelaAcompanharCortes,
}

function Blocos({ blocos }: { blocos: Bloco[] }) {
  return (
    <>
      {blocos.map((bloco, i) => {
        if (bloco.tipo === "p") {
          return (
            <p key={i} className="mb-4 text-sm leading-relaxed text-muted-foreground">
              {bloco.texto}
            </p>
          )
        }
        if (bloco.tipo === "lista") {
          return (
            <ul key={i} className="mb-4 list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
              {bloco.itens.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )
        }
        if (bloco.tipo === "aviso") {
          return (
            <div
              key={i}
              className="mb-4 flex gap-3 rounded-lg border border-status-processing/35 bg-status-processing/[0.08] p-3"
            >
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-status-processing" />
              <div className="min-w-0">
                <p className="text-sm font-semibold">{bloco.titulo}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{bloco.texto}</p>
              </div>
            </div>
          )
        }
        const Tela = TELAS[bloco.qual]
        return (
          <div key={i}>
            <Tela />
            {bloco.legenda.length > 0 && <Legenda itens={bloco.legenda} />}
          </div>
        )
      })}
    </>
  )
}

function Secao({
  passo,
  numero,
  feito,
}: {
  passo: Passo
  numero: number
  feito: boolean
}) {
  const t = useT()
  return (
    <section id={passo.id} className="scroll-mt-20">
      <Card>
        <CardContent className="flex flex-col gap-1">
          <div className="mb-2 flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-border pb-4">
            <span
              className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                feito ? "bg-status-posted text-white" : "bg-primary text-primary-foreground"
              }`}
            >
              {feito ? <IconCheck className="size-4" /> : numero}
            </span>
            {/* min-w garante que o botão desça pra própria linha em vez de
                espremer o título numa coluna de duas palavras no celular. */}
            <div className="min-w-[12rem] flex-1">
              <h2 className="font-heading text-lg font-semibold tracking-[-0.01em]">{passo.titulo}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{passo.resumo}</p>
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                <IconMapPin className="size-3.5 shrink-0" />
                <span className="min-w-0">{passo.ondeFica}</span>
              </p>
            </div>
            {passo.link && (
              <Button asChild size="sm" variant={feito ? "outline" : "default"} className="shrink-0 gap-1 max-sm:w-full">
                <a href={passo.link.url}>
                  {passo.link.texto} <IconArrowRight className="size-3.5" />
                </a>
              </Button>
            )}
          </div>

          {feito && (
            <p className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-status-posted/10 px-2.5 py-1 text-xs font-medium text-status-posted">
              <IconCheck className="size-3.5" /> {t("tut.jaFeito")}
            </p>
          )}

          <Blocos blocos={passo.blocos} />
        </CardContent>
      </Card>
    </section>
  )
}

export function TutorialPage() {
  const t = useT()
  const { idioma } = useI18n()
  const { user, loading: authLoading, logout } = useAuth()
  const [status, setStatus] = useState<OnboardingStatus | null>(null)
  const [carregouStatus, setCarregouStatus] = useState(false)

  useEffect(() => {
    if (!user) return
    api
      .get<OnboardingStatus>("/api/client/onboarding")
      .then(setStatus)
      .catch(() => {})
      .finally(() => setCarregouStatus(true))
  }, [user])

  if (authLoading || !user) return null

  const conteudo = TUTORIAL[idioma]
  const passosComMarco = conteudo.passos.filter((p) => p.marco)
  const feitos = status ? passosComMarco.filter((p) => status[p.marco!]).length : 0

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("menu.tutorial")}>
      <PageHeader title={t("tut.titulo")} description={conteudo.intro} />

      {/* Índice + progresso. Numa página longa, sem um índice a pessoa não
          sabe quanto falta nem consegue voltar a um trecho específico. */}
      <Card>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <h2 className="flex items-center gap-2 font-heading text-sm font-semibold">
              <IconBook className="size-4 text-muted-foreground" />
              {t("tut.indice")}
            </h2>
            {carregouStatus && status && (
              <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
                {t("guia.progresso", { feitos, total: passosComMarco.length })}
              </span>
            )}
            {!carregouStatus && <Skeleton className="h-6 w-24" />}
          </div>
          <ol className="grid gap-2 sm:grid-cols-2">
            {conteudo.passos.map((passo, i) => {
              const feito = Boolean(status && passo.marco && status[passo.marco])
              return (
                // min-w-0 nos dois: item de grid nasce com min-width:auto e
                // se recusa a encolher abaixo do conteúdo, então o truncate do
                // título não tinha efeito e a lista empurrava a página de lado
                // num celular estreito.
                <li key={passo.id} className="min-w-0">
                  <a
                    href={`#${passo.id}`}
                    className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border p-2.5 transition-colors hover:bg-muted/60"
                  >
                    <span
                      className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                        feito ? "bg-status-posted text-white" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {feito ? <IconCheck className="size-3.5" /> : i + 1}
                    </span>
                    <span className="min-w-0 truncate text-sm font-medium">{passo.titulo}</span>
                  </a>
                </li>
              )
            })}
          </ol>
        </CardContent>
      </Card>

      {conteudo.passos.map((passo, i) => (
        <Secao
          key={passo.id}
          passo={passo}
          numero={i + 1}
          feito={Boolean(status && passo.marco && status[passo.marco])}
        />
      ))}

      <Card className="border-primary/30 bg-primary/[0.03]">
        <CardContent>
          <h2 className="font-heading text-base font-semibold">{conteudo.fim.titulo}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{conteudo.fim.texto}</p>
        </CardContent>
      </Card>
    </DashboardLayout>
  )
}
