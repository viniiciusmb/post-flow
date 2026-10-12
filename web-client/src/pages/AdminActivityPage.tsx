import { useCallback, useEffect, useState } from "react"
import {
  IconActivity,
  IconAlertTriangle,
  IconBan,
  IconCircleCheck,
  IconClick,
  IconFileText,
  IconRobot,
  IconUsers,
} from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter"
import { StatCard } from "@/components/dashboard/StatCard"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TonePill, type Tone } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { dataHora } from "@/lib/formatoLocal"
import { cn } from "@/lib/utils"
import type { DateRangeKey } from "@/types/api"

/**
 * Atividade: o que as pessoas fazem no painel e se deu certo.
 *
 * Cada página aberta e cada ação (conectar rede, mandar cortar, pagar...) fica
 * registrada com o resultado: deu certo, foi RECUSADA (a tela explicou o
 * motivo ao cliente - limite do plano, campo errado) ou QUEBROU (erro nosso).
 * Junto, o que o sistema fez sozinho (vídeos processados, publicações), porque
 * o cliente pode clicar tudo certo e o trabalho de fundo falhar depois.
 */

type Resultado = "ok" | "recusada" | "falhou"

type Acao = {
  metodo: string
  rota: string
  tipo: "pagina" | "acao"
  area: string
  nome: string
  total: number
  ok: number
  recusadas: number
  falhas: number
  pessoas: number
  duracaoMediaMs: number | null
  ultimaVez: string
  ultimaMensagem: string | null
}

type Pessoa = {
  id: number
  nome: string
  email: string
  admin: boolean
  plano: string | null
  eventos: number
  acoes: number
  paginas: number
  recusadas: number
  falhas: number
  primeiraVez: string
  ultimaVez: string
}

type Visao = {
  totais: { acoes: number; recusadas: number; falhas: number; pessoas: number }
  acoes: Acao[]
  sistema: { nome: string; ok: number; falhas: number }[]
  pessoas: Pessoa[]
}

type Evento = {
  quando: string
  tipo: "pagina" | "acao" | "sistema" | "erro"
  resultado: Resultado
  nome: string
  area: string
  rota: string | null
  itemId?: number | null
  status: number | null
  duracaoMs: number | null
  mensagem: string | null
  pessoa?: string
  pessoaId?: number | null
}

const TOM: Record<Resultado, Tone> = { ok: "success", recusada: "neutral", falhou: "danger" }
const TEXTO: Record<Resultado, string> = { ok: "Deu certo", recusada: "Recusada", falhou: "Quebrou" }

function hoje() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())
}

function ms(v: number | null) {
  if (v === null || v === undefined) return "—"
  return v >= 1000 ? `${(v / 1000).toFixed(1).replace(".", ",")} s` : `${v} ms`
}

function IconeDoTipo({ tipo }: { tipo: Evento["tipo"] }) {
  const cls = "size-4 shrink-0 text-muted-foreground"
  if (tipo === "pagina") return <IconFileText className={cls} />
  if (tipo === "sistema") return <IconRobot className={cls} />
  if (tipo === "erro") return <IconAlertTriangle className="size-4 shrink-0 text-tone-danger-ink" />
  return <IconClick className={cls} />
}

function LinhaDeEvento({ e, comPessoa, onPessoa }: { e: Evento; comPessoa?: boolean; onPessoa?: (id: number) => void }) {
  return (
    <li className="flex gap-3 border-b border-border/60 py-2.5 last:border-0">
      <IconeDoTipo tipo={e.tipo} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium">{e.nome}</span>
          {e.tipo !== "pagina" && (
            <TonePill tone={TOM[e.resultado]} dot={false}>
              {TEXTO[e.resultado]}
            </TonePill>
          )}
        </div>
        {e.mensagem && <p className="mt-0.5 break-words text-xs text-tone-danger-ink">{e.mensagem}</p>}
        <p className="mt-0.5 break-words text-xs text-muted-foreground">
          <span className="tabular-nums">{dataHora(e.quando)}</span>
          {comPessoa && e.pessoa && (
            <>
              {" · "}
              {e.pessoaId && onPessoa ? (
                <button type="button" className="underline-offset-2 hover:underline" onClick={() => onPessoa(e.pessoaId!)}>
                  {e.pessoa}
                </button>
              ) : (
                e.pessoa
              )}
            </>
          )}
          {" · "}
          {e.area}
          {e.rota && e.tipo !== "sistema" && <span className="font-mono text-[11px]"> · {e.rota}</span>}
          {e.itemId ? ` · #${e.itemId}` : ""}
          {e.duracaoMs !== null && e.duracaoMs !== undefined && ` · ${ms(e.duracaoMs)}`}
        </p>
      </div>
    </li>
  )
}

export function AdminActivityPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [range, setRange] = useState<DateRangeKey>("today")
  const [de, setDe] = useState(hoje())
  const [ate, setAte] = useState(hoje())
  const [comAdmin, setComAdmin] = useState(false)
  const [soAcoes, setSoAcoes] = useState(true)
  const [dados, setDados] = useState<Visao | null>(null)
  const [agora, setAgora] = useState<Evento[] | null>(null)
  const [soProblemas, setSoProblemas] = useState(false)
  const [pessoaAberta, setPessoaAberta] = useState<number | null>(null)
  const [linha, setLinha] = useState<Evento[] | null>(null)

  const query = useCallback(() => {
    const p = new URLSearchParams({ range })
    if (range === "custom") {
      p.set("since", de)
      p.set("until", ate)
    }
    if (comAdmin) p.set("admin", "1")
    return p
  }, [range, de, ate, comAdmin])

  useEffect(() => {
    if (!user) return
    setDados(null)
    api.get<Visao>(`/api/admin/atividade?${query()}`).then(setDados).catch(() => setDados(null))
  }, [user, query])

  // "Agora" se atualiza sozinho a cada 15 s enquanto a aba está visível.
  useEffect(() => {
    if (!user) return
    let parar = false
    const carregar = () => {
      if (document.hidden) return
      const p = new URLSearchParams()
      if (soProblemas) p.set("problemas", "1")
      if (comAdmin) p.set("admin", "1")
      api
        .get<{ eventos: Evento[] }>(`/api/admin/atividade/agora?${p}`)
        .then((r) => !parar && setAgora(r.eventos))
        .catch(() => {})
    }
    carregar()
    const t = setInterval(carregar, 15000)
    return () => {
      parar = true
      clearInterval(t)
    }
  }, [user, soProblemas, comAdmin])

  useEffect(() => {
    if (pessoaAberta === null) return
    setLinha(null)
    api
      .get<{ eventos: Evento[] }>(`/api/admin/atividade/pessoas/${pessoaAberta}?${query()}`)
      .then((r) => setLinha(r.eventos))
      .catch(() => setLinha([]))
  }, [pessoaAberta, query])

  if (authLoading || !user) return null

  const acoes = dados ? dados.acoes.filter((a) => !soAcoes || a.tipo === "acao") : []
  const pessoa = dados?.pessoas.find((p) => p.id === pessoaAberta)

  return (
    <DashboardLayout user={user} onLogout={logout} title="Atividade">
      <p className="max-w-3xl text-sm text-muted-foreground">
        O que as pessoas fazem no painel e se deu certo. <strong className="font-medium text-foreground">Recusada</strong> é
        quando a tela explicou o motivo ao cliente (limite do plano, campo errado);{" "}
        <strong className="font-medium text-tone-danger-ink">Quebrou</strong> é erro nosso e merece olhar. Nada do que o
        cliente digita é guardado, só a ação e o resultado.
      </p>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <DateRangeFilter value={range} onChange={setRange} extras={["all", "custom"]} />
          <div className="flex items-center gap-2">
            <Checkbox id="com-admin" checked={comAdmin} onCheckedChange={(v) => setComAdmin(v === true)} />
            <Label htmlFor="com-admin" className="text-sm font-normal">
              Incluir as minhas ações (admin)
            </Label>
          </div>
        </div>
        {range === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} className="w-auto" />
            <span className="text-sm text-muted-foreground">até</span>
            <Input type="date" value={ate} min={de} max={hoje()} onChange={(e) => setAte(e.target.value)} className="w-auto" />
          </div>
        )}
      </div>

      {!dados ? (
        <Skeleton className="h-28 w-full" />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Pessoas que usaram o painel" value={dados.totais.pessoas} icon={<IconUsers />} />
          <StatCard label="Ações feitas" value={dados.totais.acoes} icon={<IconActivity />} />
          <StatCard label="Recusadas (a tela explicou)" value={dados.totais.recusadas} icon={<IconBan />} />
          <StatCard
            label="Quebraram (erro nosso)"
            value={dados.totais.falhas}
            icon={<IconAlertTriangle />}
            href={dados.totais.falhas ? "/admin/errors" : undefined}
            hrefLabel="Ver erros"
          />
        </div>
      )}

      {dados && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Trabalho do sistema no período</CardTitle>
            <CardDescription>O que roda sozinho, depois do clique: aqui aparece o que a tela não mostra.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {dados.sistema.map((s) => {
              const total = s.ok + s.falhas
              return (
                <div key={s.nome} className="rounded-lg border border-border px-3 py-2.5">
                  <p className="text-xs text-muted-foreground">{s.nome}</p>
                  <p className="mt-1 flex items-baseline gap-2 text-lg font-semibold tabular-nums">
                    <IconCircleCheck className="size-4 self-center text-tone-success-ink" />
                    {s.ok}
                    {s.falhas > 0 && <span className="text-sm font-medium text-tone-danger-ink">· {s.falhas} com erro</span>}
                  </p>
                  {total > 0 && (
                    <p className="text-xs text-muted-foreground">{Math.round((s.ok / total) * 100)}% deram certo</p>
                  )}
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="funcionalidades" className="min-w-0">
        <TabsList variant="line" className="justify-start">
          <TabsTrigger value="funcionalidades">Funcionalidades</TabsTrigger>
          <TabsTrigger value="pessoas">Pessoas</TabsTrigger>
          <TabsTrigger value="agora">Agora</TabsTrigger>
        </TabsList>

        <TabsContent value="funcionalidades" className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-2">
            <Checkbox id="so-acoes" checked={soAcoes} onCheckedChange={(v) => setSoAcoes(v === true)} />
            <Label htmlFor="so-acoes" className="text-sm font-normal">
              Esconder páginas abertas (mostrar só ações)
            </Label>
          </div>
          {!dados ? (
            <Skeleton className="h-64 w-full" />
          ) : acoes.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nenhuma ação registrada no período.</p>
          ) : (
            <Card className="py-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ação</TableHead>
                      <TableHead className="text-right">Vezes</TableHead>
                      <TableHead className="text-right">Pessoas</TableHead>
                      <TableHead className="text-right">Deu certo</TableHead>
                      <TableHead className="text-right">Recusadas</TableHead>
                      <TableHead className="text-right">Quebraram</TableHead>
                      <TableHead className="text-right">Tempo médio</TableHead>
                      <TableHead>Última mensagem quando não deu certo</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {acoes.map((a) => (
                      <TableRow key={`${a.metodo} ${a.rota}`} className={cn(a.falhas > 0 && "bg-tone-danger-wash/40")}>
                        <TableCell className="min-w-56">
                          <div className="text-sm font-medium">{a.nome}</div>
                          <div className="text-xs text-muted-foreground">
                            {a.area} · <span className="font-mono text-[11px]">{a.metodo} {a.rota}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{a.total}</TableCell>
                        <TableCell className="text-right tabular-nums">{a.pessoas}</TableCell>
                        <TableCell className="text-right tabular-nums">{a.ok}</TableCell>
                        <TableCell className="text-right tabular-nums">{a.recusadas || "—"}</TableCell>
                        <TableCell className={cn("text-right tabular-nums", a.falhas > 0 && "font-semibold text-tone-danger-ink")}>
                          {a.falhas || "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{ms(a.duracaoMediaMs)}</TableCell>
                        <TableCell className="min-w-64 max-w-md text-xs text-muted-foreground">{a.ultimaMensagem || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="pessoas" className="flex min-w-0 flex-col gap-3">
          {!dados ? (
            <Skeleton className="h-64 w-full" />
          ) : dados.pessoas.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Ninguém usou o painel no período.</p>
          ) : (
            <Card className="py-0">
              <ul className="divide-y divide-border">
                {dados.pessoas.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setPessoaAberta(p.id)}
                      className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.nome}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.admin ? "Admin" : p.plano || "Sem plano"} · última vez {dataHora(p.ultimaVez)}
                        </span>
                      </span>
                      <span className="flex items-center gap-3 text-xs tabular-nums text-muted-foreground">
                        <span>{p.acoes} ações</span>
                        <span>{p.paginas} páginas</span>
                        {p.recusadas > 0 && <span>{p.recusadas} recusadas</span>}
                        {p.falhas > 0 && <span className="font-semibold text-tone-danger-ink">{p.falhas} quebraram</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="agora" className="flex min-w-0 flex-col gap-3">
          <div className="flex items-center gap-2">
            <Checkbox id="so-problemas" checked={soProblemas} onCheckedChange={(v) => setSoProblemas(v === true)} />
            <Label htmlFor="so-problemas" className="text-sm font-normal">
              Só o que não deu certo
            </Label>
            <span className="text-xs text-muted-foreground">· atualiza a cada 15 s</span>
          </div>
          {!agora ? (
            <Skeleton className="h-64 w-full" />
          ) : agora.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Nada por aqui ainda.</p>
          ) : (
            <Card className="py-0">
              <ul className="px-4">
                {agora.map((e, i) => (
                  <LinhaDeEvento key={`${e.quando}-${i}`} e={e} comPessoa onPessoa={setPessoaAberta} />
                ))}
              </ul>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Sheet open={pessoaAberta !== null} onOpenChange={(a) => !a && setPessoaAberta(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{pessoa?.nome ?? "Linha do tempo"}</SheetTitle>
            <SheetDescription>
              {pessoa ? `${pessoa.email} · ${pessoa.admin ? "Admin" : pessoa.plano || "Sem plano"} · ` : ""}
              O que a pessoa fez, o que o sistema fez pra ela e os erros da conta, no período escolhido.
            </SheetDescription>
          </SheetHeader>
          <div className="px-4 pb-6">
            {!linha ? (
              <Skeleton className="h-64 w-full" />
            ) : linha.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Nada no período.</p>
            ) : (
              <ul>
                {linha.map((e, i) => (
                  <LinhaDeEvento key={`${e.quando}-${i}`} e={e} />
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </DashboardLayout>
  )
}
