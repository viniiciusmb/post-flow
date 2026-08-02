import { useEffect, useState } from "react"
import { IconBrandTiktok } from "@tabler/icons-react"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { api, ApiError } from "@/lib/api"
import type { CreatorOptions, PostingQueueItem } from "@/types/api"

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
 * É por isso que o corte não sai da fila até alguém preencher isto: publicar
 * com um padrão que a pessoa nunca viu é exatamente o que a regra proíbe.
 */

const NOMES_DE_PRIVACIDADE: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Todo mundo",
  MUTUAL_FOLLOW_FRIENDS: "Amigos (quem se segue mútuo)",
  FOLLOWER_OF_CREATOR: "Seus seguidores",
  SELF_ONLY: "Só você",
}

export function DirectPostOptions({
  item,
  accountId,
  onSaved,
}: {
  item: PostingQueueItem
  accountId: number
  onSaved: () => void
}) {
  const [opcoes, setOpcoes] = useState<CreatorOptions | null>(null)
  const [erroCarregar, setErroCarregar] = useState<string | null>(null)

  // Começa tudo em branco/desmarcado de propósito. Não é esquecimento: valor
  // pré-selecionado é o que a auditoria recusa.
  const [privacidade, setPrivacidade] = useState<string>(item.privacyLevel ?? "")
  const [permitirComentario, setPermitirComentario] = useState(!item.disableComment && item.optionsConfirmed)
  const [permitirDuet, setPermitirDuet] = useState(!item.disableDuet && item.optionsConfirmed)
  const [permitirJuncao, setPermitirJuncao] = useState(!item.disableStitch && item.optionsConfirmed)
  const [divulgacao, setDivulgacao] = useState(item.brandOrganicToggle || item.brandContentToggle)
  const [marcaPropria, setMarcaPropria] = useState(item.brandOrganicToggle)
  const [parceriaPaga, setParceriaPaga] = useState(item.brandContentToggle)

  const [salvando, setSalvando] = useState(false)
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
  const listaDePrivacidade = opcoes.privacyLevelOptions.filter(
    (nivel) => !(parceriaBloqueiaPrivado && nivel === "SELF_ONLY")
  )

  async function salvar() {
    setSalvando(true)
    setErro(null)
    try {
      await api.put(`/api/client/postings/${item.id}/options`, {
        privacyLevel: privacidade,
        // A API do TikTok fala em "disable", a tela fala em "permitir".
        // Inverter aqui, num lugar só, evita dupla negação espalhada na UI.
        disableComment: !permitirComentario,
        disableDuet: !permitirDuet,
        disableStitch: !permitirJuncao,
        brandOrganicToggle: divulgacao && marcaPropria,
        brandContentToggle: divulgacao && parceriaPaga,
      })
      onSaved()
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar.")
    } finally {
      setSalvando(false)
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
          <p className="text-xs text-muted-foreground">Vai publicar nesta conta</p>
        </div>
      </div>

      <Field>
        <FieldLabel>Quem pode ver este vídeo</FieldLabel>
        <Select value={privacidade} onValueChange={setPrivacidade}>
          <SelectTrigger className="w-full sm:w-80">
            <SelectValue placeholder="Escolha uma opção" />
          </SelectTrigger>
          <SelectContent>
            {listaDePrivacidade.map((nivel) => (
              <SelectItem key={nivel} value={nivel}>
                {NOMES_DE_PRIVACIDADE[nivel] ?? nivel}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {parceriaBloqueiaPrivado && (
          <p className="text-xs text-muted-foreground">
            Conteúdo de parceria paga não pode ficar visível só pra você.
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
          Este vídeo divulga uma marca, produto ou serviço
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
                Seu vídeo será marcado como{" "}
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

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={salvar} disabled={!privacidade || salvando}>
          {salvando ? "Salvando..." : item.optionsConfirmed ? "Atualizar opções" : "Confirmar e liberar publicação"}
        </Button>
        {!privacidade && (
          <span className="text-xs text-muted-foreground">Escolha quem pode ver o vídeo pra continuar.</span>
        )}
      </div>
    </div>
  )
}
