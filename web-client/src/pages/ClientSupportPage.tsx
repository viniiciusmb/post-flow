import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react"
import { IconSend, IconPlus, IconCircleCheck, IconRefresh, IconUsers, IconLoader2 } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader } from "@/components/dashboard/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import { useT } from "@/i18n"
import type { SupportAction, SupportConversationStatus, SupportCurrentResponse, SupportMessage, SupportSendResponse } from "@/types/api"

type Linha = { chave: string; autor: "cliente" | "suporte"; texto: string; acoes?: SupportAction[] }

function Balao({ linha }: { linha: Linha }) {
  const t = useT()
  const doCliente = linha.autor === "cliente"
  return (
    <div className={`flex flex-col gap-1 ${doCliente ? "items-end" : "items-start"}`}>
      <span className="px-1 text-xs text-muted-foreground">{doCliente ? t("suporte.voce") : t("suporte.assistente")}</span>
      {/* Texto puro: o React escapa tudo, então nada que a IA ou o cliente
          escreva vira HTML na tela. */}
      <div
        className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
          doCliente ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
        }`}
      >
        {linha.texto}
      </div>
      {linha.acoes?.map((a, i) => (
        <span key={i} className="flex items-center gap-1.5 rounded-full bg-tone-success-wash px-3 py-1 text-xs font-medium text-tone-success-ink">
          {a.tipo === "devolucao" && (
            <>
              <IconCircleCheck className="size-3.5" />
              {t("suporte.devolvidos", { minutos: a.minutos })}
            </>
          )}
          {a.tipo === "reprocessamento" && (
            <>
              <IconRefresh className="size-3.5" />
              {t("suporte.reprocessando")}
            </>
          )}
          {a.tipo === "encaminhado" && (
            <>
              <IconUsers className="size-3.5" />
              {t("suporte.encaminhada")}
            </>
          )}
        </span>
      ))}
    </div>
  )
}

function deMensagens(mensagens: SupportMessage[]): Linha[] {
  return mensagens.map((m) => ({ chave: `m${m.id}`, autor: m.autor, texto: m.texto }))
}

export function ClientSupportPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const [carregando, setCarregando] = useState(true)
  const [conversaId, setConversaId] = useState<number | null>(null)
  const [status, setStatus] = useState<SupportConversationStatus>("aberta")
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [texto, setTexto] = useState("")
  const [maxChars, setMaxChars] = useState(1500)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const fimRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!user) return
    api
      .get<SupportCurrentResponse>("/api/client/support")
      .then((r) => {
        setMaxChars(r.limits.maxChars)
        if (r.conversation) {
          setConversaId(r.conversation.id)
          setStatus(r.conversation.status)
          setLinhas(deMensagens(r.conversation.mensagens))
        }
      })
      .catch(() => setErro(t("comum.erroGenerico")))
      .finally(() => setCarregando(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [linhas, enviando])

  if (authLoading || !user) return null

  async function enviar(e?: FormEvent) {
    e?.preventDefault()
    const mensagem = texto.trim()
    if (!mensagem || enviando) return
    setErro(null)
    setEnviando(true)
    setTexto("")
    setLinhas((l) => [...l, { chave: `c${Date.now()}`, autor: "cliente", texto: mensagem }])
    try {
      const r = await api.post<SupportSendResponse>("/api/client/support/messages", { conversationId: conversaId, message: mensagem })
      setConversaId(r.conversationId)
      setStatus(r.status)
      setLinhas((l) => [...l, { chave: `s${Date.now()}`, autor: "suporte", texto: r.resposta, acoes: r.acoes }])
    } catch (err) {
      // A mensagem não foi aceita: devolve pro campo pra não perder o que foi escrito.
      setLinhas((l) => l.slice(0, -1))
      setTexto(mensagem)
      setErro(err instanceof ApiError ? err.message : t("comum.erroGenerico"))
    } finally {
      setEnviando(false)
    }
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  function novaConversa() {
    setConversaId(null)
    setStatus("aberta")
    setLinhas([])
    setErro(null)
  }

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("suporte.titulo")}>
      <PageHeader
        title={t("suporte.titulo")}
        description={t("suporte.descricao")}
        action={
          linhas.length > 0 ? (
            <Button variant="outline" size="sm" onClick={novaConversa} disabled={enviando}>
              <IconPlus className="size-4" />
              {t("suporte.novaConversa")}
            </Button>
          ) : undefined
        }
      />

      <Card className="mx-auto w-full max-w-3xl">
        <CardContent className="flex flex-col gap-4 py-4">
          <div className="flex max-h-[60vh] min-h-64 flex-col gap-4 overflow-y-auto pr-1">
            {carregando ? (
              <Skeleton className="h-16 w-2/3" />
            ) : (
              <>
                <Balao linha={{ chave: "boas-vindas", autor: "suporte", texto: t("suporte.boasVindas") }} />
                {linhas.map((l) => (
                  <Balao key={l.chave} linha={l} />
                ))}
                {enviando && (
                  <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                    <IconLoader2 className="size-4 animate-spin" />
                    {t("suporte.pensando")}
                  </div>
                )}
                {status === "encaminhada" && !enviando && (
                  <p className="rounded-md border border-status-pending/40 bg-status-pending/10 px-3 py-2 text-sm">{t("suporte.encaminhada")}</p>
                )}
              </>
            )}
            <div ref={fimRef} />
          </div>

          <form onSubmit={enviar} className="flex flex-col gap-2">
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={aoTeclar}
              placeholder={t("suporte.placeholder")}
              rows={3}
              maxLength={maxChars}
              disabled={enviando || carregando}
              className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
            />
            {erro && <p className="text-sm text-destructive">{erro}</p>}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{t("suporte.aviso")}</p>
              <div className="flex items-center gap-3">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {t("suporte.caracteres", { usados: texto.length, max: maxChars })}
                </span>
                <Button type="submit" size="sm" disabled={enviando || carregando || !texto.trim()}>
                  <IconSend className="size-4" />
                  {t("suporte.enviar")}
                </Button>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </DashboardLayout>
  )
}
