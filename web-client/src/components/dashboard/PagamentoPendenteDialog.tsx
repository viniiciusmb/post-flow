import { useEffect, useState } from "react"
import { IconAlertTriangle, IconCreditCard, IconLogout } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { useT } from "@/i18n"
import type { ClientBillingOverviewResponse } from "@/types/api"

/**
 * Mensalidade vencida: o painel inteiro fica atrás deste aviso (14/10/2026,
 * decisão do fundador - cliente que não pagou não usa nenhuma funcionalidade).
 * Não fecha: as saídas são pagar, ir para Plano e uso ou sair. O servidor tem a
 * trava de verdade (bloqueioPorPagamento); isto aqui diz o porquê e o caminho.
 * Não aparece em Plano e uso nem no checkout, que é onde a pessoa paga.
 */
export function PagamentoPendenteDialog({ onLogout }: { onLogout: () => void }) {
  const t = useT()
  const [fatura, setFatura] = useState<ClientBillingOverviewResponse["subscription"]["faturaEmAberto"] | undefined>(undefined)

  useEffect(() => {
    api
      .get<ClientBillingOverviewResponse>("/api/client/billing/overview")
      .then((o) => setFatura(o.subscription.faturaEmAberto))
      .catch(() => setFatura(null))
  }, [])

  const valor =
    fatura && (fatura.valorCents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        className="w-[calc(100%-2rem)] rounded-2xl sm:max-w-md"
      >
        <DialogHeader>
          <div className="mb-1 flex size-11 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <IconAlertTriangle className="size-6" />
          </div>
          <DialogTitle>{t("pagamentoPendente.titulo")}</DialogTitle>
          <DialogDescription>{t("pagamentoPendente.texto")}</DialogDescription>
        </DialogHeader>
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm">{t("pagamentoPendente.volta")}</p>
        <div className="flex flex-col gap-2">
          {fatura ? (
            <Button asChild size="lg">
              <a href={fatura.url} target="_blank" rel="noopener noreferrer">
                <IconCreditCard className="size-4" />
                {t("plano.pagarFaturaEmAberto", { valor: valor ?? "" })}
              </a>
            </Button>
          ) : null}
          <Button asChild variant={fatura ? "outline" : "default"} size="lg">
            <a href="/client/billing">{t("pagamentoPendente.irParaPlano")}</a>
          </Button>
          <Button variant="ghost" onClick={onLogout}>
            <IconLogout className="size-4" />
            {t("pagamentoPendente.sair")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
