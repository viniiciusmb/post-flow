import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { IconBrandTiktok } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"

/**
 * Onde os cortes vão ser publicados.
 *
 * Era um cartão inteiro, com moldura e título próprio, para exibir uma linha de
 * informação. Uma tela que empilha caixa atrás de caixa cansa e faz tudo
 * parecer igualmente importante. Agora é uma barra fina: o assunto continua
 * separado do resto, mas ocupa o tamanho do que tem para dizer.
 */
export function TikTokConnectionCard({
  accounts,
}: {
  accounts: { id: number; displayName: string; avatarUrl: string | null }[]
}) {
  const vazio = accounts.length === 0

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-card shadow-[var(--shadow-flat)] dark:border dark:border-border px-4 py-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-medium text-muted-foreground">Publica em</span>
        {vazio ? (
          <span className="text-sm text-muted-foreground">nenhuma conta conectada ainda</span>
        ) : (
          accounts.map((a) => (
            <span key={a.id} className="flex items-center gap-1.5 text-sm font-medium">
              <Avatar className="size-5 bg-foreground text-background">
                {a.avatarUrl && <AvatarImage src={a.avatarUrl} alt="" />}
                <AvatarFallback className="bg-foreground text-background">
                  <IconBrandTiktok className="size-2.5" />
                </AvatarFallback>
              </Avatar>
              {a.displayName}
            </span>
          ))
        )}
      </div>
      <Button asChild variant={vazio ? "default" : "outline"} size="sm" className="shrink-0">
        <a href={vazio ? "/auth/tiktok/connect" : "/client/tiktok-account"}>
          {vazio ? "Conectar TikTok" : "Gerenciar"}
        </a>
      </Button>
    </div>
  )
}
