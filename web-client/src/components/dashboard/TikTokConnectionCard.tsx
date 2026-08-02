import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { IconBrandTiktok } from "@tabler/icons-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export function TikTokConnectionCard({
  accounts,
}: {
  accounts: { id: number; displayName: string; avatarUrl: string | null }[]
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base">Publicação no TikTok</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          {accounts.length > 0 ? (
            <>
              <div className="flex items-center gap-2">
                {accounts.map((a) => (
                  <div key={a.id} className="flex items-center gap-1.5 rounded-full border border-border py-1 pr-3 pl-1 text-sm">
                    <Avatar className="size-5 bg-foreground text-background">
                      {a.avatarUrl && <AvatarImage src={a.avatarUrl} alt="" />}
                      <AvatarFallback className="bg-foreground text-background">
                        <IconBrandTiktok className="size-2.5" />
                      </AvatarFallback>
                    </Avatar>
                    {a.displayName}
                  </div>
                ))}
              </div>
              <Button asChild variant="outline" size="sm" className="shrink-0">
                <a href="/client/tiktok-account">Ver contas</a>
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Nenhuma conta TikTok conectada ainda.</p>
              <Button asChild size="sm">
                <a href="/auth/tiktok/connect">Conectar TikTok</a>
              </Button>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
