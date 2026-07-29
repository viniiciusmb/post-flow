import { useEffect, useState, type FormEvent } from "react"
import { IconTrash, IconPlayerPause, IconPlayerPlay } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import type { YoutubeChannel } from "@/types/api"

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

export function YouTubeChannelsPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [channels, setChannels] = useState<YoutubeChannel[] | null>(null)
  const [channelUrl, setChannelUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    const data = await api.get<{ channels: YoutubeChannel[] }>("/api/client/youtube-channels")
    setChannels(data.channels)
  }

  useEffect(() => {
    if (user) load()
  }, [user])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await api.post("/api/client/youtube-channels", { channelUrl })
      setChannelUrl("")
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nao foi possivel adicionar o canal.")
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(channel: YoutubeChannel) {
    await api.post(`/api/client/youtube-channels/${channel.id}/active`, { isActive: !channel.isActive })
    await load()
  }

  async function removeChannel(channel: YoutubeChannel) {
    if (!confirm(`Remover o canal "${channel.channelName}"? Isso nao apaga os cortes ja gerados.`)) return
    await api.delete(`/api/client/youtube-channels/${channel.id}`)
    await load()
  }

  if (authLoading || !user) return null

  return (
    <DashboardLayout user={user} onLogout={logout} title="Canais do YouTube">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Adicionar canal</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              {error && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <Field>
                <FieldLabel htmlFor="channelUrl">Link ou @handle do canal</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="channelUrl"
                    placeholder="https://www.youtube.com/@seucanal"
                    value={channelUrl}
                    onChange={(e) => setChannelUrl(e.target.value)}
                    required
                  />
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Adicionando..." : "Adicionar"}
                  </Button>
                </div>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Canais cadastrados</h2>
        {!channels ? (
          <Skeleton className="h-40" />
        ) : channels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            Nenhum canal cadastrado ainda.
          </div>
        ) : (
          <div className="rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Canal</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ultima checagem</TableHead>
                  <TableHead className="text-right">Acoes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((channel) => (
                  <TableRow key={channel.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8">
                          {channel.avatarUrl && <AvatarImage src={channel.avatarUrl} alt="" />}
                          <AvatarFallback>{initials(channel.channelName || "YT")}</AvatarFallback>
                        </Avatar>
                        <a
                          href={channel.channelUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="font-medium hover:underline"
                        >
                          {channel.channelName || channel.channelUrl}
                        </a>
                      </div>
                    </TableCell>
                    <TableCell>
                      <TonePill tone={channel.isActive ? "success" : "neutral"}>
                        {channel.isActive ? "Ativo" : "Pausado"}
                      </TonePill>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {channel.lastPolledAt
                        ? new Date(channel.lastPolledAt).toLocaleString("pt-BR")
                        : "ainda nao checado"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon-sm" onClick={() => toggleActive(channel)}>
                          {channel.isActive ? <IconPlayerPause /> : <IconPlayerPlay />}
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => removeChannel(channel)}>
                          <IconTrash />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
