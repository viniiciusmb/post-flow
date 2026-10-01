import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { api } from "@/lib/api"
import { useT } from "@/i18n"

type Aviso = { id: number; title: string; body: string; createdAt: string }

/**
 * Aviso escrito para UM cliente (manutenção, crédito devolvido, novidade),
 * mostrado uma vez. Fechar grava no servidor, então ele não volta em outra
 * tela nem em outro aparelho.
 *
 * Montado no DashboardLayout porque o cliente pode entrar por qualquer tela;
 * numa tela só, quem abrisse outra nunca veria o aviso.
 */
export function ClientNoticeDialog() {
  const t = useT()
  const [avisos, setAvisos] = useState<Aviso[]>([])
  const [fechando, setFechando] = useState(false)

  useEffect(() => {
    let vivo = true
    api
      .get<{ notices: Aviso[] }>("/api/client/notices")
      .then((r) => {
        if (vivo) setAvisos(r.notices)
      })
      // Aviso é acessório: falhar ao buscar não pode atrapalhar a tela.
      .catch(() => {})
    return () => {
      vivo = false
    }
  }, [])

  const atual = avisos[0]
  if (!atual) return null

  async function entendi() {
    setFechando(true)
    try {
      await api.post(`/api/client/notices/${atual.id}/dismiss`)
    } catch {
      // Se não gravou, ele aparece de novo na próxima tela — melhor que
      // prender a pessoa num pop-up que não fecha.
    } finally {
      setAvisos((lista) => lista.slice(1))
      setFechando(false)
    }
  }

  return (
    <Dialog open onOpenChange={(aberto) => !aberto && entendi()}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{atual.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-col gap-3 text-left text-sm leading-relaxed text-muted-foreground">
              {atual.body.split(/\n\s*\n/).map((paragrafo, i) => (
                <p key={i}>{paragrafo.trim()}</p>
              ))}
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={fechando} onClick={entendi}>
            {t("aviso.entendi")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
