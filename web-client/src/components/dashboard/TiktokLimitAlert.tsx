import { useEffect, useState } from "react"
import { IconAlertTriangle, IconBrandTiktok } from "@tabler/icons-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { api } from "@/lib/api"
import type { TiktokCapacity } from "@/types/api"

/**
 * Avisa o dono do sistema quando o número de contas do TikTok conectadas se
 * aproxima do teto de CRIADORES ATIVOS que o TikTok concede ao aplicativo.
 *
 * Por que isso merece um pop-up e não uma linha perdida numa tela:
 *
 *  - O teto não aparece em lugar nenhum — nem na API, nem no painel do
 *    TikTok. Só se descobre que bateu quando as publicações começam a ser
 *    recusadas, ou seja, quando os clientes já estão parados.
 *  - Pedir aumento depende de o TikTok analisar, o que leva dias.
 *
 * Juntando as duas coisas: quem espera o sintoma fica dias sem publicar. O
 * aviso precisa chegar enquanto ainda há espaço para crescer durante a espera.
 */
export function TiktokLimitAlert({
  capacidade,
  onMudou,
}: {
  capacidade: TiktokCapacity
  onMudou: () => void
}) {
  const [aberto, setAberto] = useState(false)
  const [limite, setLimite] = useState(String(capacidade.limite))
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (capacidade.alertar) setAberto(true)
  }, [capacidade.alertar])

  async function salvarLimite() {
    setSalvando(true)
    try {
      await api.post("/api/admin/tiktok-limit", { limite: Number(limite) })
      onMudou()
    } finally {
      setSalvando(false)
    }
  }

  async function jaPedi() {
    setSalvando(true)
    try {
      await api.post("/api/admin/tiktok-limit/snooze", { dias: 14 })
      setAberto(false)
      onMudou()
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconAlertTriangle className="size-5 text-amber-500" />
            Peça o aumento do limite do TikTok
          </DialogTitle>
          <DialogDescription>
            Você está usando {capacidade.percentual}% do teto de criadores do seu aplicativo. O pedido de aumento
            leva dias para ser analisado — por isso o aviso vem agora, e não quando estourar.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 text-sm">
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-muted/40 p-3 text-center">
            <div>
              <div className="font-heading text-2xl font-semibold tabular-nums">{capacidade.contas_conectadas}</div>
              <div className="text-xs text-muted-foreground">contas conectadas</div>
            </div>
            <div>
              <div className="font-heading text-2xl font-semibold tabular-nums">{capacidade.pico_30_dias}</div>
              <div className="text-xs text-muted-foreground">pico num só dia</div>
            </div>
            <div>
              <div className="font-heading text-2xl font-semibold tabular-nums">{capacidade.limite}</div>
              <div className="text-xs text-muted-foreground">seu teto</div>
            </div>
          </div>

          <div>
            <p className="mb-2 font-medium">O que fazer, na ordem:</p>
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-muted-foreground">
              <li>
                Entre em <strong>developers.tiktok.com</strong> com a conta de desenvolvedor do Post Flow e abra o
                aplicativo na área <strong>Manage apps</strong>.
              </li>
              <li>
                Vá em <strong>App details → Content Posting API</strong>. É lá que fica a estimativa de uso que você
                declarou na auditoria — o número que virou o seu teto.
              </li>
              <li>
                Peça o aumento pelo formulário de auditoria (ou por <strong>Support → Contact us</strong>, se o
                formulário não estiver disponível). Informe quantos criadores você tem hoje e quantos espera em 6
                meses, com folga.
              </li>
              <li>
                Explique o caso de uso em uma frase: <em>"plataforma que publica cortes de vídeo no perfil do próprio
                criador, com ele revisando legenda e privacidade antes de publicar"</em>. Eles avaliam se o criador tem
                controle do que sai — é o critério que mais pesa.
              </li>
              <li>
                Guarde o novo teto aqui embaixo assim que for aprovado, para o aviso voltar a funcionar com o número
                certo.
              </li>
            </ol>
          </div>

          <div className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
            <IconBrandTiktok className="mr-1 inline size-3.5" />
            O limite de publicações por conta (10 por dia) é outra coisa e já está respeitado. O que este aviso vigia
            é <strong>quantos criadores diferentes</strong> podem publicar num período de 24 horas.
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <label className="text-xs font-medium" htmlFor="tiktok-limite">
              Teto concedido pelo TikTok
              {!capacidade.limiteConfirmado && (
                <span className="ml-1 font-normal text-amber-600">(ainda não confirmado — este é um chute)</span>
              )}
            </label>
            <div className="flex gap-2">
              <Input
                id="tiktok-limite"
                type="number"
                min={1}
                value={limite}
                onChange={(e) => setLimite(e.target.value)}
                className="w-32"
              />
              <Button variant="outline" onClick={salvarLimite} disabled={salvando}>
                Salvar
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" variant="outline" onClick={() => setAberto(false)}>
              Depois
            </Button>
            <Button className="flex-1" onClick={jaPedi} disabled={salvando}>
              Já pedi o aumento
            </Button>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            "Já pedi" esconde o aviso por 14 dias. Ele volta depois — pedido pode ser recusado.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  )
}
