import { useEffect, useMemo, useState, type ComponentType } from "react"
import {
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandTiktok,
  IconCheck,
  IconPlus,
} from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TikTokContasPainel } from "@/pages/TikTokAccountPage"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { data } from "@/lib/formatoLocal"
import type { TikTokAccountSummary } from "@/types/api"

type Rede = "tiktok" | "instagram" | "facebook"

type ContaSocial = {
  id: number
  network: "instagram" | "facebook"
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  accountType: string | null
  connectedAt: string
}

type PaginaDoFacebook = { id: string; name: string; username: string | null; pictureUrl: string | null; category: string | null }

/**
 * O que cada rede exige. É a parte da tela que evita a frustração mais comum:
 * conectar, ver tudo "certo" e descobrir depois que a conta era do tipo errado.
 * Cada linha é uma exigência real da rede (ou do nosso jeito de publicar), não
 * texto de venda.
 */
const REDES: Record<
  Rede,
  {
    nome: string
    Icone: ComponentType<{ className?: string }>
    resumo: string
    requisitos: { chave: string; valor: string; detalhe?: string }[]
    comoPreparar?: string[]
  }
> = {
  tiktok: {
    nome: "TikTok",
    Icone: IconBrandTiktok,
    resumo: "Publicação direta pelo app oficial do Post Flow, aprovado pelo TikTok. Cada canal do YouTube publica em uma conta.",
    requisitos: [
      { chave: "Conta", valor: "Qualquer conta", detalhe: "Pessoal ou empresa." },
      { chave: "Formato", valor: "Vertical 9:16", detalhe: "Os cortes já saem nesse formato." },
      { chave: "Várias contas", valor: "Sim", detalhe: "Conecte quantas o seu plano permitir; cada canal escolhe a sua." },
      { chave: "Horários", valor: "Você escolhe", detalhe: "Fila, horários e publicação automática por conta." },
    ],
  },
  instagram: {
    nome: "Instagram",
    Icone: IconBrandInstagram,
    resumo: "Os cortes saem como Reels no perfil conectado.",
    requisitos: [
      { chave: "Conta", valor: "Profissional", detalhe: "Criador de conteúdo ou Empresa. Conta pessoal não pode ser conectada." },
      { chave: "Duração", valor: "Até 90 segundos", detalhe: "Cortes mais longos não são publicados no Instagram." },
      { chave: "Formato", valor: "Reels 9:16" },
      { chave: "Página", valor: "Ligada a uma Página do Facebook", detalhe: "Exigência da Meta para publicar por aplicativo." },
      { chave: "Limite", valor: "100 por dia", detalhe: "Por conta, contando tudo que for publicado por aplicativo." },
    ],
    comoPreparar: [
      "No app do Instagram, abra o seu perfil e toque em ☰.",
      "Entre em Tipo de conta e ferramentas e toque em Mudar para conta profissional.",
      "Escolha Criador de conteúdo ou Empresa e conecte uma Página do Facebook quando o app pedir.",
    ],
  },
  facebook: {
    nome: "Facebook",
    Icone: IconBrandFacebook,
    resumo: "Os cortes são publicados numa Página do Facebook que você administra.",
    requisitos: [
      { chave: "Onde publica", valor: "Somente em Página", detalhe: "Perfil pessoal não pode ser conectado: o Facebook não permite publicar nele por aplicativo." },
      { chave: "Acesso", valor: "Administrador da Página", detalhe: "Quem conecta precisa ter controle total da Página." },
      { chave: "Duração", valor: "Até 90 segundos", detalhe: "Nessa faixa o corte sai como Reels da Página." },
      { chave: "Formato", valor: "Reels 9:16" },
    ],
    comoPreparar: [
      "Se ainda não tem, crie a Página em facebook.com/pages/create.",
      "Ao conectar, entre com o perfil que administra a Página.",
      "Na volta, marque a Página (ou as Páginas) que vão receber os cortes.",
    ],
  },
}

const ERROS: Record<string, string> = {
  sessao: "A autorização demorou demais ou foi aberta em outra janela. Clique em conectar de novo.",
  cancelada: "A conexão foi cancelada antes de terminar. Se a conta não é profissional, mude o tipo de conta e tente de novo.",
  conta: "Não conseguimos confirmar a conta que voltou da autorização. Tente conectar de novo.",
  outro_cliente: "Essa conta já está conectada a outro usuário do Post Flow.",
  servico: "O serviço de conexão não respondeu. Tente de novo em instantes.",
}

function lerUrl() {
  const p = new URLSearchParams(window.location.search)
  const rede = p.get("rede")
  // A volta da conexão do TikTok usa os parâmetros dela (tiktok_connected /
  // tiktok_error). São lidos aqui porque a página limpa a barra de endereço
  // antes de o painel do TikTok montar.
  const tiktokErro = p.get("tiktok_error")
  return {
    rede: (rede === "instagram" || rede === "facebook" || rede === "tiktok" ? rede : "tiktok") as Rede,
    tiktokConectada: p.get("tiktok_connected") === "1",
    tiktokErro,
    conectada: p.get("conectada") === "1",
    erro: p.get("erro"),
    escolher: p.get("escolher") === "1",
  }
}

export function SocialNetworksPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const inicial = useMemo(lerUrl, [])
  const [rede, setRede] = useState<Rede>(inicial.rede)
  const [contas, setContas] = useState<ContaSocial[] | null>(null)
  const [disponivel, setDisponivel] = useState(true)
  const [tiktok, setTiktok] = useState<TikTokAccountSummary[] | null>(null)
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(() => {
    if (inicial.tiktokErro) return { tipo: "erro", texto: `Não foi possível conectar o TikTok: ${inicial.tiktokErro}` }
    if (inicial.tiktokConectada) return { tipo: "ok", texto: "Conta do TikTok conectada." }
    if (inicial.erro) return { tipo: "erro", texto: ERROS[inicial.erro] ?? ERROS.servico }
    if (inicial.conectada) return { tipo: "ok", texto: `${REDES[inicial.rede].nome} conectado.` }
    return null
  })
  const [escolherPagina, setEscolherPagina] = useState(inicial.escolher && inicial.rede === "facebook")

  async function load() {
    const [s, tk] = await Promise.all([
      api.get<{ disponivel: boolean; contas: ContaSocial[] }>("/api/client/social-accounts"),
      api.get<{ accounts: TikTokAccountSummary[] }>("/api/client/tiktok-accounts"),
    ])
    setContas(s.contas)
    setDisponivel(s.disponivel)
    setTiktok(tk.accounts)
  }

  useEffect(() => {
    if (user) void load()
  }, [user])

  // Limpa os avisos da barra de endereço (um F5 não deve repetir "conectado"),
  // mas mantém a rede: recarregar volta pra mesma aba.
  useEffect(() => {
    window.history.replaceState(null, "", `/client/social?rede=${rede}`)
  }, [rede])

  if (authLoading || !user) return null

  const contagem: Record<Rede, number | null> = {
    tiktok: tiktok ? tiktok.length : null,
    instagram: contas ? contas.filter((c) => c.network === "instagram").length : null,
    facebook: contas ? contas.filter((c) => c.network === "facebook").length : null,
  }
  const info = REDES[rede]

  return (
    <DashboardLayout user={user} onLogout={logout} title="Redes sociais">
      <div className="min-w-0">
        <h1 className="font-heading text-[1.65rem] font-semibold leading-tight tracking-[-0.03em]">Redes sociais</h1>
        <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
          Os perfis onde os seus cortes são publicados. Cada rede tem as próprias exigências, listadas ao lado de cada uma.
        </p>
      </div>

      {/* Seletor de rede: cada botão já diz quantas contas estão conectadas,
          então dá pra ver o que falta sem abrir as três. */}
      <div role="tablist" aria-label="Rede" className="grid grid-cols-3 gap-2 sm:max-w-2xl">
        {(Object.keys(REDES) as Rede[]).map((r) => {
          const { nome, Icone } = REDES[r]
          const n = contagem[r]
          const ativa = rede === r
          return (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={ativa}
              onClick={() => {
                setRede(r)
                setAviso(null)
              }}
              className={cn(
                "flex min-w-0 flex-col items-start gap-3 rounded-xl border p-3 text-left transition-colors sm:flex-row sm:items-center",
                ativa
                  ? "border-foreground bg-card shadow-[var(--shadow-raised)]"
                  : "border-border bg-card/60 hover:bg-card",
              )}
            >
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-lg",
                  ativa ? "bg-foreground text-background" : "bg-muted text-foreground",
                )}
              >
                <Icone className="size-5" />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{nome}</span>
                <span className="mt-0.5 block truncate font-mono text-[10.5px] text-muted-foreground">
                  {n === null ? "…" : n === 0 ? "não conectado" : n === 1 ? "1 conta" : `${n} contas`}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {aviso && (
        <p
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            aviso.tipo === "ok"
              ? "border-status-posted/30 bg-status-posted/10 text-status-posted"
              : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {aviso.texto}
        </p>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex min-w-0 flex-col gap-4">
          {rede === "tiktok" ? (
            <TikTokContasPainel voltarPara="/client/social" />
          ) : (
            <ContasDaRede
              rede={rede}
              contas={contas?.filter((c) => c.network === rede) ?? null}
              disponivel={disponivel}
              onMudou={(lista) => setContas(lista)}
              onErro={(texto) => setAviso({ tipo: "erro", texto })}
            />
          )}
        </div>
        <Requisitos rede={rede} info={info} />
      </div>

      <EscolherPaginaDialog
        aberto={escolherPagina}
        onFechar={() => setEscolherPagina(false)}
        onConectado={(lista, n) => {
          setContas(lista)
          setEscolherPagina(false)
          setAviso({ tipo: "ok", texto: n === 1 ? "Página conectada." : `${n} Páginas conectadas.` })
        }}
      />
    </DashboardLayout>
  )
}

function Requisitos({ rede, info }: { rede: Rede; info: (typeof REDES)[Rede] }) {
  return (
    <Card className="gap-0 py-0 xl:sticky xl:top-4">
      <div className="border-b border-border px-5 py-4">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Requisitos · {info.nome}</p>
        <p className="mt-1.5 text-sm text-muted-foreground">{info.resumo}</p>
      </div>
      <dl className="divide-y divide-border">
        {info.requisitos.map((r) => (
          <div key={r.chave} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 px-5 py-3">
            <dt className="pt-px font-mono text-[11px] text-muted-foreground">{r.chave}</dt>
            <dd className="min-w-0">
              <p className="text-sm font-medium">{r.valor}</p>
              {r.detalhe && <p className="mt-0.5 text-xs text-muted-foreground">{r.detalhe}</p>}
            </dd>
          </div>
        ))}
      </dl>
      {info.comoPreparar && (
        <div className="border-t border-border bg-muted/40 px-5 py-4">
          <p className="text-xs font-medium">{rede === "instagram" ? "Como deixar a conta profissional" : "Antes de conectar"}</p>
          <ol className="mt-2 flex list-decimal flex-col gap-1.5 pl-4 text-xs text-muted-foreground marker:font-mono">
            {info.comoPreparar.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ol>
        </div>
      )}
    </Card>
  )
}

function ContasDaRede({
  rede,
  contas,
  disponivel,
  onMudou,
  onErro,
}: {
  rede: "instagram" | "facebook"
  contas: ContaSocial[] | null
  disponivel: boolean
  onMudou: (lista: ContaSocial[]) => void
  onErro: (texto: string) => void
}) {
  const { nome, Icone } = REDES[rede]
  const [indo, setIndo] = useState(false)

  async function conectar() {
    setIndo(true)
    try {
      const { url } = await api.post<{ url: string }>(`/api/client/social-accounts/${rede}/conectar`, {})
      window.location.href = url
    } catch (err) {
      onErro(err instanceof ApiError ? err.message : "Não foi possível iniciar a conexão.")
      setIndo(false)
    }
  }

  const botao = (
    <Button onClick={conectar} disabled={indo || !disponivel} className="gap-1.5">
      <IconPlus className="size-4" />
      {indo ? "Abrindo..." : contas && contas.length > 0 ? `Conectar outra ${rede === "facebook" ? "Página" : "conta"}` : `Conectar ${nome}`}
    </Button>
  )

  if (!contas) return <Skeleton className="h-40" />

  return (
    <>
      {!disponivel && (
        <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          A conexão com {nome} ainda não está disponível nesta instalação.
        </p>
      )}

      {contas.length === 0 ? (
        <Card className="items-center gap-0 px-6 py-12 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-muted">
            <Icone className="size-6" />
          </span>
          <p className="mt-4 font-medium">
            {rede === "facebook" ? "Nenhuma Página conectada" : "Nenhuma conta do Instagram conectada"}
          </p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {rede === "facebook"
              ? "Você entra com o seu perfil do Facebook e escolhe em quais Páginas os cortes vão ser publicados."
              : "Você entra com a conta do Instagram e autoriza o Post Flow a publicar Reels nela."}
          </p>
          <div className="mt-5">{botao}</div>
        </Card>
      ) : (
        <>
          <div className="flex justify-end">{botao}</div>
          <div className="flex flex-col gap-2.5">
            {contas.map((c) => (
              <LinhaDaConta key={c.id} conta={c} rede={rede} onMudou={onMudou} onErro={onErro} />
            ))}
          </div>
        </>
      )}

      <p className="text-xs text-muted-foreground">
        A publicação automática dos cortes no {nome} entra na próxima atualização. As contas conectadas agora já ficam prontas pra
        isso.
      </p>
    </>
  )
}

function LinhaDaConta({
  conta,
  rede,
  onMudou,
  onErro,
}: {
  conta: ContaSocial
  rede: "instagram" | "facebook"
  onMudou: (lista: ContaSocial[]) => void
  onErro: (texto: string) => void
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [saindo, setSaindo] = useState(false)
  const { Icone } = REDES[rede]
  const nome = conta.displayName || conta.username || "Conta"

  return (
    <Card className="flex-row items-center gap-4 px-4 py-3.5">
      <div className="relative shrink-0">
        <Avatar className="size-11">
          {conta.avatarUrl && <AvatarImage src={conta.avatarUrl} alt="" />}
          <AvatarFallback>{nome.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="absolute -bottom-1 -right-1 flex size-5 items-center justify-center rounded-full bg-foreground text-background ring-2 ring-card">
          <Icone className="size-3" />
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{nome}</p>
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          {conta.username && rede === "instagram" ? `@${conta.username} · ` : ""}conectada em {data(conta.connectedAt)}
        </p>
      </div>
      {confirmando ? (
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setConfirmando(false)}>
            Manter
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={saindo}
            onClick={async () => {
              setSaindo(true)
              try {
                const r = await api.delete<{ contas: ContaSocial[] }>(`/api/client/social-accounts/${conta.id}`)
                onMudou(r.contas)
              } catch (err) {
                onErro(err instanceof ApiError ? err.message : "Não foi possível desconectar.")
                setSaindo(false)
                setConfirmando(false)
              }
            }}
          >
            {saindo ? "Desconectando..." : "Desconectar"}
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="shrink-0 text-muted-foreground" onClick={() => setConfirmando(true)}>
          Desconectar
        </Button>
      )}
    </Card>
  )
}

/** Segunda etapa do Facebook: um login traz várias Páginas, e o cliente escolhe quais. */
function EscolherPaginaDialog({
  aberto,
  onFechar,
  onConectado,
}: {
  aberto: boolean
  onFechar: () => void
  onConectado: (lista: ContaSocial[], n: number) => void
}) {
  const [paginas, setPaginas] = useState<PaginaDoFacebook[] | null>(null)
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!aberto) return
    api
      .get<{ paginas: PaginaDoFacebook[] }>("/api/client/social-accounts/facebook/paginas")
      .then((d) => {
        setPaginas(d.paginas)
        if (d.paginas.length === 1) setMarcadas(new Set([d.paginas[0].id]))
      })
      .catch((err) => setErro(err instanceof ApiError ? err.message : "Não foi possível listar as Páginas."))
  }, [aberto])

  async function conectar() {
    setEnviando(true)
    setErro(null)
    try {
      const r = await api.post<{ conectadas: number; contas: ContaSocial[] }>("/api/client/social-accounts/facebook/paginas", {
        pageIds: [...marcadas],
      })
      onConectado(r.contas, r.conectadas)
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível conectar as Páginas.")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Em quais Páginas publicar?</DialogTitle>
          <DialogDescription>Estas são as Páginas que o seu perfil administra. Marque as que vão receber os cortes.</DialogDescription>
        </DialogHeader>
        {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}
        {!paginas && !erro && <Skeleton className="h-28" />}
        {paginas && paginas.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Nenhuma Página encontrada neste perfil. Crie uma Página no Facebook (ou peça acesso de administrador) e conecte de novo.
          </p>
        )}
        {paginas && paginas.length > 0 && (
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {paginas.map((p) => {
              const on = marcadas.has(p.id)
              return (
                <label
                  key={p.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                    on ? "border-foreground bg-muted/40" : "border-border hover:bg-muted/30",
                  )}
                >
                  <Checkbox
                    checked={on}
                    onCheckedChange={(c) =>
                      setMarcadas((prev) => {
                        const n = new Set(prev)
                        if (c === true) n.add(p.id)
                        else n.delete(p.id)
                        return n
                      })
                    }
                  />
                  <Avatar className="size-8">
                    {p.pictureUrl && <AvatarImage src={p.pictureUrl} alt="" />}
                    <AvatarFallback className="text-[10px]">{p.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    {p.category && <span className="block truncate text-xs text-muted-foreground">{p.category}</span>}
                  </span>
                  {on && <IconCheck className="size-4 shrink-0" />}
                </label>
              )
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={conectar} disabled={enviando || marcadas.size === 0}>
            {enviando ? "Conectando..." : marcadas.size > 1 ? `Conectar ${marcadas.size} Páginas` : "Conectar Página"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

