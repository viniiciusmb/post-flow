import { useEffect, useState } from "react"
import { IconBookmark, IconCheck, IconCopy, IconLayoutGrid, IconSparkles, IconTrash } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { CenaDePrevia, TextoNoModelo, letraPelaCaixa } from "@/components/estilos/estilosDeTexto"
import { api, ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import type { ClientVideoSettingsResponse, VideoCaptionStyle } from "@/types/api"

type Campos = Record<string, string | number | boolean | null>
type Padrao = { chave: string; nome: string; descricao: string; campos: Campos }
type Meu = { id: number; nome: string; campos: Campos }
type Selecionado = { tipo: "padrao"; chave: string } | { tipo: "meu"; id: number }

export type AlvoDoModelo = { channelId?: number; sourceVideoId?: number }

/** O modelo está em uso quando cada campo dele bate com o que está salvo. */
function emUso(campos: Campos, atual: ClientVideoSettingsResponse) {
  const a = atual as unknown as Record<string, unknown>
  return Object.entries(campos).every(([k, v]) => String(a[k]) === String(v))
}

/** Mini tela 9:16 com o título em cima, a legenda embaixo e o fundo do modelo. */
export function MiniaturaDoModelo({ campos, className }: { campos: Campos; className?: string }) {
  const cor = String(campos.titleBoxColor || "#D92323")
  const fundo = String(campos.backgroundStyle || "blur")
  return (
    <CenaDePrevia
      className={cn("w-full rounded-lg", className)}
      style={{ ["--cor-da-caixa" as string]: cor, ["--cor-da-letra-cartao" as string]: letraPelaCaixa(cor) }}
    >
      {/* Fundo liso (preto/branco): o vídeo fica numa faixa no meio. */}
      {(fundo === "black" || fundo === "white") && (
        <>
          <div className={cn("absolute inset-x-0 top-0 h-[24%]", fundo === "black" ? "bg-black" : "bg-white")} />
          <div className={cn("absolute inset-x-0 bottom-0 h-[24%]", fundo === "black" ? "bg-black" : "bg-white")} />
        </>
      )}
      {campos.showTitle !== false && campos.titleStyle && (
        <div className="absolute inset-x-0 top-[9%] flex justify-center px-[6%] text-center" style={{ fontSize: "10cqw" }}>
          <TextoNoModelo modelo={campos.titleStyle as VideoCaptionStyle} texto="Título do corte" fonte={String(campos.titleFont || "")} />
        </div>
      )}
      {campos.captionStyle && (
        <div className="absolute inset-x-0 bottom-[27%] flex justify-center px-[6%] text-center" style={{ fontSize: "13cqw" }}>
          <TextoNoModelo modelo={campos.captionStyle as VideoCaptionStyle} texto="legenda aqui" fonte={String(campos.captionFont || "")} />
        </div>
      )}
      {campos.showPartLabel === true && (
        <span className="absolute right-[6%] top-[3%] rounded bg-black/70 px-[0.4em] py-[0.15em] font-semibold text-white" style={{ fontSize: "6cqw" }}>
          Parte 1
        </span>
      )}
    </CenaDePrevia>
  )
}

export function ModelosDeCorte({
  alvo,
  atual,
  onAplicado,
}: {
  alvo: AlvoDoModelo
  atual: ClientVideoSettingsResponse
  onAplicado: () => void
}) {
  const [padroes, setPadroes] = useState<Padrao[] | null>(null)
  const [meus, setMeus] = useState<Meu[]>([])
  const [aba, setAba] = useState<"prontos" | "meus">("prontos")
  const [sel, setSel] = useState<Selecionado | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [nome, setNome] = useState("")
  const [outros, setOutros] = useState(false)

  async function carregar() {
    const d = await api.get<{ padroes: Padrao[]; meus: Meu[] }>("/api/client/video-settings/modelos")
    setPadroes(d.padroes)
    setMeus(d.meus.map((m) => ({ ...m, id: Number(m.id) })))
    return d
  }

  useEffect(() => {
    void carregar()
  }, [])

  const ondeAqui = alvo.sourceVideoId ? "neste vídeo" : alvo.channelId ? "neste canal" : "em todos os canais"
  const escolhido =
    sel?.tipo === "padrao"
      ? padroes?.find((p) => p.chave === sel.chave)
      : sel?.tipo === "meu"
        ? meus.find((m) => m.id === sel.id)
        : undefined

  async function aplicar(alvos: { padraoDoCliente?: boolean; channelIds?: number[]; sourceVideoId?: number }, descricao: string) {
    if (!sel) return
    setOcupado(true)
    setAviso(null)
    try {
      const r = await api.post<{ aplicados: number; avisos: string[] }>("/api/client/video-settings/modelos/aplicar", {
        ...(sel.tipo === "padrao" ? { padrao: sel.chave } : { modeloId: sel.id }),
        alvos,
      })
      const extra = r.avisos.includes("fundo_de_imagem")
        ? " O fundo de imagem ficou desfocado onde não havia imagem enviada."
        : ""
      setAviso({ tipo: "ok", texto: `Modelo "${escolhido?.nome}" aplicado ${descricao}.${extra}` })
      onAplicado()
      return true
    } catch (err) {
      setAviso({ tipo: "erro", texto: err instanceof ApiError ? err.message : "Não foi possível aplicar o modelo." })
      return false
    } finally {
      setOcupado(false)
    }
  }

  function aplicarAqui() {
    if (alvo.sourceVideoId) return aplicar({ sourceVideoId: alvo.sourceVideoId }, ondeAqui)
    if (alvo.channelId) return aplicar({ channelIds: [alvo.channelId] }, ondeAqui)
    return aplicar({ padraoDoCliente: true }, ondeAqui)
  }

  async function salvarComoModelo() {
    const n = nome.trim()
    if (!n) return
    setOcupado(true)
    setAviso(null)
    try {
      const r = await api.post<{ modelo: Meu; substituido: boolean }>("/api/client/video-settings/modelos", {
        nome: n,
        ...(alvo.sourceVideoId ? { sourceVideoId: alvo.sourceVideoId } : alvo.channelId ? { channelId: alvo.channelId } : {}),
      })
      await carregar()
      setAba("meus")
      setSel({ tipo: "meu", id: Number(r.modelo.id) })
      setSalvando(false)
      setNome("")
      setAviso({
        tipo: "ok",
        texto: r.substituido
          ? `Modelo "${r.modelo.nome}" atualizado com o estilo atual.`
          : `Modelo "${r.modelo.nome}" salvo. Use "Aplicar em outros canais" pra levar este estilo pra onde quiser.`,
      })
    } catch (err) {
      setAviso({ tipo: "erro", texto: err instanceof ApiError ? err.message : "Não foi possível salvar o modelo." })
    } finally {
      setOcupado(false)
    }
  }

  async function apagar(m: Meu) {
    setOcupado(true)
    try {
      await api.delete(`/api/client/video-settings/modelos/${m.id}`)
      setSel(null)
      await carregar()
      setAviso({ tipo: "ok", texto: `Modelo "${m.nome}" apagado. Os canais que já usavam continuam com o estilo.` })
    } finally {
      setOcupado(false)
    }
  }

  const lista: { key: string; nome: string; descricao?: string; campos: Campos; s: Selecionado }[] =
    aba === "prontos"
      ? (padroes ?? []).map((p) => ({ key: p.chave, nome: p.nome, descricao: p.descricao, campos: p.campos, s: { tipo: "padrao", chave: p.chave } }))
      : meus.map((m) => ({ key: String(m.id), nome: m.nome, campos: m.campos, s: { tipo: "meu", id: m.id } }))

  const mesmo = (a: Selecionado | null, b: Selecionado) =>
    !!a && a.tipo === b.tipo && (a.tipo === "padrao" ? a.chave === (b as { chave: string }).chave : a.id === (b as { id: number }).id)

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-tone-violet-ink/20 bg-gradient-to-b from-tone-violet-wash/70 to-transparent p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-tone-violet-ink text-white">
            <IconLayoutGrid className="size-5" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">Modelos de estilo</p>
            <p className="text-xs text-muted-foreground">
              Escolha um modelo e aplique {ondeAqui}, ou salve o estilo atual pra usar nos outros canais.
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 bg-card" onClick={() => setSalvando((v) => !v)}>
          <IconBookmark className="size-4" />
          Salvar estilo atual
        </Button>
      </div>

      {salvando && (
        <form
          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault()
            void salvarComoModelo()
          }}
        >
          <Input
            autoFocus
            maxLength={60}
            placeholder="Nome do modelo, ex.: Cortes do podcast"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            className="min-w-0 flex-1"
          />
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setSalvando(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={ocupado || !nome.trim()}>
              Salvar modelo
            </Button>
          </div>
        </form>
      )}

      <div className="inline-flex w-fit rounded-lg bg-card p-0.5 text-xs font-medium shadow-[var(--shadow-flat)]">
        {(
          [
            ["prontos", `Prontos · ${padroes?.length ?? 0}`],
            ["meus", `Meus modelos · ${meus.length}`],
          ] as const
        ).map(([v, r]) => (
          <button
            key={v}
            type="button"
            onClick={() => {
              setAba(v)
              setSel(null)
            }}
            className={cn(
              "rounded-md px-3 py-1.5 transition-colors",
              aba === v ? "bg-tone-violet-ink text-white" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {r}
          </button>
        ))}
      </div>

      {aba === "meus" && meus.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/60 px-4 py-8 text-center">
          <IconSparkles className="mx-auto size-6 text-tone-violet-ink" />
          <p className="mt-2 text-sm font-medium">Nenhum modelo salvo ainda</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Deixe o estilo do jeito que você gosta e clique em "Salvar estilo atual".
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 xl:grid-cols-6">
          {lista.map((item) => {
            const ativo = mesmo(sel, item.s)
            const usando = emUso(item.campos, atual)
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setSel(ativo ? null : item.s)}
                aria-pressed={ativo}
                className={cn(
                  "group relative flex min-w-0 flex-col gap-1.5 rounded-xl bg-card p-1.5 text-left shadow-[var(--shadow-flat)] transition",
                  ativo ? "ring-2 ring-tone-violet-ink" : "hover:ring-1 hover:ring-border",
                )}
              >
                <MiniaturaDoModelo campos={item.campos} />
                <span className="line-clamp-2 px-0.5 text-[11.5px] font-medium leading-tight">{item.nome}</span>
                {usando && (
                  <span className="inline-flex w-fit items-center gap-0.5 rounded-full bg-tone-success-wash px-1.5 py-0.5 text-[9.5px] font-semibold text-tone-success-ink">
                    <IconCheck className="size-2.5" /> em uso
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {escolhido && sel && (
        <div className="flex flex-col gap-3 rounded-lg border border-tone-violet-ink/30 bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium">{escolhido.nome}</p>
            <p className="text-xs text-muted-foreground">
              {"descricao" in escolhido && escolhido.descricao
                ? escolhido.descricao
                : "Seu modelo: leva o estilo e o jeito de cortar. Idioma e descrição de cada canal não mudam."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {sel.tipo === "meu" && (
              <Button
                size="sm"
                variant="ghost"
                className="gap-1 text-destructive"
                disabled={ocupado}
                onClick={() => {
                  const m = meus.find((x) => x.id === sel.id)
                  if (m) void apagar(m)
                }}
              >
                <IconTrash className="size-3.5" /> Apagar
              </Button>
            )}
            {(atual.channels?.length ?? 0) > 0 && (
              <Button size="sm" variant="outline" className="gap-1" disabled={ocupado} onClick={() => setOutros(true)}>
                <IconCopy className="size-3.5" /> Aplicar em outros canais
              </Button>
            )}
            <Button size="sm" className="gap-1 bg-tone-violet-ink text-white hover:bg-tone-violet-ink/90" disabled={ocupado} onClick={() => void aplicarAqui()}>
              {ocupado ? "Aplicando..." : `Aplicar ${ondeAqui}`}
            </Button>
          </div>
        </div>
      )}

      {aviso && (
        <p
          className={cn(
            "rounded-md px-3 py-2 text-sm",
            aviso.tipo === "ok" ? "bg-tone-success-wash text-tone-success-ink" : "bg-tone-danger-wash text-tone-danger-ink",
          )}
        >
          {aviso.texto}
        </p>
      )}

      <AplicarEmOutros
        aberto={outros}
        nomeDoModelo={escolhido?.nome ?? ""}
        canais={atual.channels ?? []}
        atualId={alvo.channelId}
        onFechar={() => setOutros(false)}
        onAplicar={async (alvos, n) => {
          const ok = await aplicar(alvos, n === 1 ? "em 1 lugar" : `em ${n} lugares`)
          if (ok) setOutros(false)
        }}
        ocupado={ocupado}
      />
    </div>
  )
}

function AplicarEmOutros({
  aberto,
  nomeDoModelo,
  canais,
  atualId,
  onFechar,
  onAplicar,
  ocupado,
}: {
  aberto: boolean
  nomeDoModelo: string
  canais: { id: number; name: string; hasOwnStyle: boolean }[]
  atualId?: number
  onFechar: () => void
  onAplicar: (alvos: { padraoDoCliente?: boolean; channelIds?: number[] }, n: number) => void
  ocupado: boolean
}) {
  const [marcados, setMarcados] = useState<Set<number>>(new Set())
  const [padrao, setPadrao] = useState(false)

  useEffect(() => {
    if (aberto) {
      setMarcados(new Set(atualId ? [atualId] : []))
      setPadrao(false)
    }
  }, [aberto, atualId])

  const total = marcados.size + (padrao ? 1 : 0)
  const alternar = (id: number) =>
    setMarcados((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Aplicar "{nomeDoModelo}"</DialogTitle>
          <DialogDescription>
            Marque onde usar este modelo. Cada canal recebe uma cópia: mudar o modelo depois não altera o que já foi aplicado.
          </DialogDescription>
        </DialogHeader>
        <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5", padrao ? "border-tone-violet-ink bg-tone-violet-wash/50" : "border-border")}>
            <Checkbox checked={padrao} onCheckedChange={(c) => setPadrao(c === true)} className="mt-0.5" />
            <span className="min-w-0">
              <span className="block text-sm font-medium">Padrão de todos os canais</span>
              <span className="block text-xs text-muted-foreground">Vale pros canais que não têm estilo próprio e pros canais que você conectar depois.</span>
            </span>
          </label>
          {canais.map((c) => {
            const on = marcados.has(Number(c.id))
            return (
              <label
                key={c.id}
                className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5", on ? "border-tone-violet-ink bg-tone-violet-wash/50" : "border-border")}
              >
                <Checkbox checked={on} onCheckedChange={() => alternar(Number(c.id))} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.name}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">{c.hasOwnStyle ? "estilo próprio" : "segue o padrão"}</span>
              </label>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={ocupado || total === 0}
            className="bg-tone-violet-ink text-white hover:bg-tone-violet-ink/90"
            onClick={() => onAplicar({ padraoDoCliente: padrao || undefined, channelIds: [...marcados] }, total)}
          >
            {ocupado ? "Aplicando..." : total > 1 ? `Aplicar em ${total}` : "Aplicar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
