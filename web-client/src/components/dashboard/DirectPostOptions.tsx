import { useEffect, useState } from "react"
import { IconBrandTiktok } from "@tabler/icons-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { api, ApiError } from "@/lib/api"
import type { CreatorOptions, PostingQueueItem, PublishDefaults } from "@/types/api"

/**
 * Opções de publicação exigidas pelo TikTok na publicação direta.
 *
 * Isto não é uma tela de conveniência: as diretrizes da Content Posting API
 * listam item por item o que precisa aparecer aqui, e um app que não cumpre
 * reprova na auditoria. Em resumo:
 *
 *   - o apelido e a foto da conta de destino têm que estar visíveis, para o
 *     criador saber em qual perfil o vídeo vai sair;
 *   - a privacidade é escolhida numa lista com as opções que a conta permite,
 *     e NENHUMA pode vir marcada por padrão;
 *   - comentários, duetos e junções começam DESMARCADOS, e ficam desabilitados
 *     quando a própria conta do criador não permite;
 *   - a divulgação comercial começa desligada, e conteúdo de parceria paga não
 *     pode ficar privado;
 *   - a frase da Confirmação de Uso de Música precisa aparecer antes de publicar.
 *
 * A escolha é feita UMA vez, no nível da conta, e vale pra todos os cortes: o
 * produto existe pra rodar sozinho, e obrigar a confirmar corte a corte
 * acabaria com isso. A regra da TikTok continua cumprida — ela proíbe publicar
 * com uma configuração que o criador nunca viu, não publicar com a
 * configuração que ele mesmo definiu. Enquanto ele não definir, nada sai.
 *
 * O mesmo formulário serve pra tratar um corte específico diferente do padrão.
 */

const NOMES_DE_PRIVACIDADE: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Todo mundo",
  MUTUAL_FOLLOW_FRIENDS: "Amigos (quem se segue mútuo)",
  FOLLOWER_OF_CREATOR: "Seus seguidores",
  SELF_ONLY: "Só você",
}

export function nomeDaPrivacidade(nivel: string | null) {
  if (!nivel) return null
  return NOMES_DE_PRIVACIDADE[nivel] ?? nivel
}

type Valores = {
  privacyLevel: string | null
  disableComment: boolean
  disableDuet: boolean
  disableStitch: boolean
  brandOrganicToggle: boolean
  brandContentToggle: boolean
}

/** O padrão da conta: escolhido uma vez, vale pra todo corte. */
export function PublishDefaultsForm({
  accountId,
  defaults,
  onSaved,
}: {
  accountId: number
  defaults: PublishDefaults
  onSaved: (novo: PublishDefaults) => void
}) {
  return (
    <FormularioDeOpcoes
      accountId={accountId}
      // Nada pré-selecionado enquanto o criador não tiver escolhido: é
      // exatamente isso que a auditoria procura na primeira vez.
      valores={defaults.definido ? defaults : null}
      rotuloSalvar={defaults.definido ? "Salvar opções" : "Confirmar e liberar publicação"}
      salvar={async (v) => {
        const novo = await api.put<PublishDefaults>(
          `/api/client/tiktok-accounts/${accountId}/publish-defaults`,
          v
        )
        onSaved(novo)
      }}
    />
  )
}

/** As opções de UM corte, quando ele precisa sair diferente do padrão. */
export function DirectPostOptions({
  item,
  accountId,
  onSaved,
  onVoltarAoPadrao,
}: {
  item: PostingQueueItem
  accountId: number
  onSaved: () => void
  onVoltarAoPadrao: () => void
}) {
  return (
    <FormularioDeOpcoes
      accountId={accountId}
      item={item}
      valores={item.optionsCustom ? item : null}
      rotuloSalvar={item.optionsCustom ? "Salvar opções deste corte" : "Usar estas opções só neste corte"}
      salvar={async (v) => {
        await api.put(`/api/client/postings/${item.id}/options`, v)
        onSaved()
      }}
      voltarAoPadrao={
        item.optionsCustom
          ? async () => {
              await api.delete(`/api/client/postings/${item.id}/options`)
              onVoltarAoPadrao()
            }
          : undefined
      }
    />
  )
}

function FormularioDeOpcoes({
  accountId,
  item,
  valores,
  rotuloSalvar,
  salvar,
  voltarAoPadrao,
}: {
  accountId: number
  item?: PostingQueueItem
  valores: Valores | null
  rotuloSalvar: string
  salvar: (v: Valores) => Promise<void>
  voltarAoPadrao?: () => Promise<void>
}) {
  const [opcoes, setOpcoes] = useState<CreatorOptions | null>(null)
  const [erroCarregar, setErroCarregar] = useState<string | null>(null)

  // Começa tudo em branco/desmarcado quando ainda não há escolha. Não é
  // esquecimento: valor pré-selecionado é o que a auditoria recusa.
  const [privacidade, setPrivacidade] = useState<string>(valores?.privacyLevel ?? "")
  const [permitirComentario, setPermitirComentario] = useState(Boolean(valores) && !valores!.disableComment)
  const [permitirDuet, setPermitirDuet] = useState(Boolean(valores) && !valores!.disableDuet)
  const [permitirJuncao, setPermitirJuncao] = useState(Boolean(valores) && !valores!.disableStitch)
  const [divulgacao, setDivulgacao] = useState(
    Boolean(valores?.brandOrganicToggle || valores?.brandContentToggle)
  )
  const [marcaPropria, setMarcaPropria] = useState(Boolean(valores?.brandOrganicToggle))
  const [parceriaPaga, setParceriaPaga] = useState(Boolean(valores?.brandContentToggle))

  const [salvando, setSalvando] = useState(false)
  const [voltando, setVoltando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    // Busca sempre ao abrir, nunca de cache: o criador pode ter mudado as
    // permissões dele no aplicativo do TikTok a qualquer momento, e oferecer
    // uma opção que ele desativou faz a publicação falhar depois do envio.
    api
      .get<CreatorOptions>(`/api/client/postings/accounts/${accountId}/creator-options`)
      .then(setOpcoes)
      .catch((e) => setErroCarregar(e instanceof ApiError ? e.message : "Não foi possível falar com o TikTok."))
  }, [accountId])

  if (erroCarregar) {
    return <p className="text-sm text-destructive">{erroCarregar}</p>
  }
  if (!opcoes) return <Skeleton className="h-64" />

  const parceriaBloqueiaPrivado = parceriaPaga
  // A regra do TikTok é DESABILITAR "só você" com o motivo à vista, não sumir
  // com a opção: quem procura por ela precisa entender por que não pode.
  const listaDePrivacidade = opcoes.privacyLevelOptions

  // Vídeo mais longo do que a conta aceita é recusado pelo TikTok depois do
  // upload inteiro já ter subido. Barrar aqui evita gastar banda e tempo pra
  // receber um "não" no fim. Só faz sentido quando há um corte concreto.
  const duracaoSegundos = item ? Math.max(0, Math.round(item.endSeconds - item.startSeconds)) : null
  const limite = opcoes.maxVideoPostDurationSec
  const longoDemais = duracaoSegundos !== null && limite !== null && duracaoSegundos > limite

  // A divulgação comercial exige escolher pelo menos um tipo. Com o interruptor
  // ligado e nenhum marcado, a regra manda o botão de publicar ficar desligado.
  const divulgacaoIncompleta = divulgacao && !marcaPropria && !parceriaPaga

  const podeSalvar = Boolean(privacidade) && !divulgacaoIncompleta && !longoDemais

  async function aoSalvar() {
    setSalvando(true)
    setErro(null)
    try {
      await salvar({
        privacyLevel: privacidade,
        // A API do TikTok fala em "disable", a tela fala em "permitir".
        // Inverter aqui, num lugar só, evita dupla negação espalhada na UI.
        disableComment: !permitirComentario,
        disableDuet: !permitirDuet,
        disableStitch: !permitirJuncao,
        brandOrganicToggle: divulgacao && marcaPropria,
        brandContentToggle: divulgacao && parceriaPaga,
      })
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.")
    } finally {
      setSalvando(false)
    }
  }

  async function aoVoltarAoPadrao() {
    if (!voltarAoPadrao) return
    setVoltando(true)
    setErro(null)
    try {
      await voltarAoPadrao()
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível voltar ao padrão.")
    } finally {
      setVoltando(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 rounded-xl bg-muted/60 p-4">
      {/* Obrigatório: o criador precisa ver em qual conta o vídeo vai sair. */}
      <div className="flex items-center gap-2.5">
        <Avatar className="size-8 bg-foreground text-background">
          {opcoes.creatorAvatarUrl && <AvatarImage src={opcoes.creatorAvatarUrl} alt="" />}
          <AvatarFallback className="bg-foreground text-background">
            <IconBrandTiktok className="size-4" />
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{opcoes.creatorNickname ?? opcoes.creatorUsername}</p>
          <p className="text-xs text-muted-foreground">
            {item ? "Vai publicar nesta conta" : "Vale pra todos os cortes desta conta"}
          </p>
        </div>
      </div>

      {/* Exigido: o criador tem que ver o vídeo antes de autorizar a publicação. */}
      {item && (
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">Prévia do que vai ser publicado</p>
          <video
            src={`/api/client/source-videos/clips/${item.clipId}/download`}
            controls
            preload="metadata"
            poster={item.thumbnailUrl ?? undefined}
            className="aspect-[9/16] w-40 rounded-md bg-black"
          />
        </div>
      )}

      <Field>
        <FieldLabel>{item ? "Quem pode ver este vídeo" : "Quem pode ver os vídeos"}</FieldLabel>
        <Select value={privacidade} onValueChange={setPrivacidade}>
          <SelectTrigger className="w-full sm:w-80">
            <SelectValue placeholder="Escolha uma opção" />
          </SelectTrigger>
          <SelectContent>
            {listaDePrivacidade.map((nivel) => {
              const bloqueado = parceriaBloqueiaPrivado && nivel === "SELF_ONLY"
              return (
                <SelectItem key={nivel} value={nivel} disabled={bloqueado}>
                  {NOMES_DE_PRIVACIDADE[nivel] ?? nivel}
                  {/* O motivo fica escrito na própria linha, não num tooltip:
                      quem só olha a tela (inclusive quem revisa o app) precisa
                      enxergar por que a opção está apagada. */}
                  {bloqueado && (
                    <span className="text-xs text-muted-foreground">
                      — parceria paga não pode ficar privada
                    </span>
                  )}
                </SelectItem>
              )
            })}
          </SelectContent>
        </Select>
        {parceriaBloqueiaPrivado && (
          <p className="text-xs text-muted-foreground">
            Conteúdo de parceria não pode ficar visível só pra você.
          </p>
        )}
      </Field>

      <Field>
        <FieldLabel>O que as pessoas podem fazer</FieldLabel>
        <div className="flex flex-col gap-2.5">
          <label className="flex items-center gap-2.5 text-sm">
            <Checkbox
              checked={permitirComentario}
              disabled={opcoes.commentDisabled}
              onCheckedChange={(v) => setPermitirComentario(v === true)}
            />
            Comentar
            {opcoes.commentDisabled && (
              <span className="text-xs text-muted-foreground">(desativado na sua conta do TikTok)</span>
            )}
          </label>
          <label className="flex items-center gap-2.5 text-sm">
            <Checkbox
              checked={permitirDuet}
              disabled={opcoes.duetDisabled}
              onCheckedChange={(v) => setPermitirDuet(v === true)}
            />
            Fazer dueto
            {opcoes.duetDisabled && (
              <span className="text-xs text-muted-foreground">(desativado na sua conta do TikTok)</span>
            )}
          </label>
          <label className="flex items-center gap-2.5 text-sm">
            <Checkbox
              checked={permitirJuncao}
              disabled={opcoes.stitchDisabled}
              onCheckedChange={(v) => setPermitirJuncao(v === true)}
            />
            Fazer junção (stitch)
            {opcoes.stitchDisabled && (
              <span className="text-xs text-muted-foreground">(desativado na sua conta do TikTok)</span>
            )}
          </label>
        </div>
      </Field>

      <Field>
        <label className="flex items-center gap-2.5 text-sm font-medium">
          <Checkbox checked={divulgacao} onCheckedChange={(v) => setDivulgacao(v === true)} />
          {item
            ? "Este vídeo divulga uma marca, produto ou serviço"
            : "Meus vídeos divulgam uma marca, produto ou serviço"}
        </label>
        {divulgacao && (
          <div className="mt-1 flex flex-col gap-2.5 pl-6">
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox checked={marcaPropria} onCheckedChange={(v) => setMarcaPropria(v === true)} />
              Sua marca
            </label>
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox
                checked={parceriaPaga}
                onCheckedChange={(v) => {
                  const marcado = v === true
                  setParceriaPaga(marcado)
                  // Parceria paga não pode ser privado: em vez de deixar salvar
                  // e falhar depois, a opção some da lista e a escolha é
                  // desfeita na hora.
                  if (marcado && privacidade === "SELF_ONLY") setPrivacidade("")
                }}
              />
              Conteúdo de parceria (marca de outra pessoa)
            </label>
            {(marcaPropria || parceriaPaga) && (
              <p className="text-xs text-muted-foreground">
                {item ? "Seu vídeo será marcado" : "Seus vídeos serão marcados"} como{" "}
                <strong className="text-foreground">
                  {parceriaPaga ? "Parceria paga" : "Conteúdo promocional"}
                </strong>
                .
              </p>
            )}
          </div>
        )}
      </Field>

      {/* Frase obrigatória antes de publicar. */}
      <p className="text-xs text-muted-foreground">
        Ao publicar, você concorda com a{" "}
        <a
          href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
        >
          Confirmação de Uso de Música
        </a>{" "}
        do TikTok
        {parceriaPaga && (
          <>
            {" "}
            e com a{" "}
            <a
              href="https://www.tiktok.com/legal/page/global/bc-policy/en"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Política de Conteúdo de Parceria
            </a>
          </>
        )}
        .
      </p>

      {longoDemais && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Este corte tem {duracaoSegundos}s e sua conta do TikTok aceita no máximo {limite}s. Gere um corte
          mais curto pra publicar por aqui.
        </p>
      )}

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {/* Exigido: avisar que a publicação não aparece na hora. */}
      <p className="text-xs text-muted-foreground">
        Depois de publicar, o TikTok pode levar alguns minutos pra processar o vídeo antes de ele
        aparecer no perfil.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={aoSalvar} disabled={!podeSalvar || salvando}>
          {salvando ? "Salvando..." : rotuloSalvar}
        </Button>
        {voltarAoPadrao && (
          <Button size="sm" variant="outline" onClick={aoVoltarAoPadrao} disabled={voltando}>
            {voltando ? "Voltando..." : "Voltar ao padrão da conta"}
          </Button>
        )}
        {!privacidade && (
          <span className="text-xs text-muted-foreground">
            Escolha quem pode ver {item ? "o vídeo" : "os vídeos"} pra continuar.
          </span>
        )}
        {divulgacaoIncompleta && (
          <span className="text-xs text-muted-foreground">
            Marque se é a sua marca, uma parceria, ou desligue a divulgação.
          </span>
        )}
      </div>
    </div>
  )
}
