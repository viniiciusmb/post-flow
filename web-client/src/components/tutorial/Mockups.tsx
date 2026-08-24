/**
 * Ilustrações das telas do painel, usadas no Tutorial.
 *
 * São RÉPLICAS EM HTML, não capturas de imagem. Três motivos, nesta ordem:
 *
 * 1. Privacidade. A tela de um cliente real mostra o nome do canal dele, o
 *    @ da conta de TikTok e os títulos dos cortes. Publicar isso num tutorial
 *    que todo mundo abre entregaria dado de um cliente para os outros.
 * 2. Elas acompanham o produto. Uma captura envelhece no primeiro botão que
 *    muda de lugar e vira um tutorial que ensina errado; a réplica usa os
 *    mesmos tokens de cor e tipografia do painel, então segue o tema claro/
 *    escuro e não desalinha.
 * 3. Responsividade. Imagem de tela larga ou vira ilegível no celular ou
 *    empurra a página de lado. Aqui o conteúdo reflui, e o que não cabe rola
 *    dentro da própria moldura.
 */
import type { ReactNode } from "react"
import {
  IconBrandTiktok,
  IconBrandYoutube,
  IconCheck,
  IconClock,
  IconPointFilled,
} from "@tabler/icons-react"

/**
 * Moldura comum. O `overflow-x-auto` é o que garante que uma ilustração
 * apertada role dentro dela em vez de alargar a página inteira - a regra que
 * este projeto já quebrou uma vez no editor de enquadramento.
 */
export function Tela({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <figure className="my-4 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-3 py-2">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-muted-foreground/25" />
          <span className="size-2.5 rounded-full bg-muted-foreground/25" />
          <span className="size-2.5 rounded-full bg-muted-foreground/25" />
        </span>
        <figcaption className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">
          {titulo}
        </figcaption>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[17rem] p-3 sm:p-4">{children}</div>
      </div>
    </figure>
  )
}

/** Rótulo numerado que aparece grudado no controle que o texto está explicando. */
export function Marca({ n }: { n: number }) {
  return (
    <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
      {n}
    </span>
  )
}

/** Lista "número → o que aquele controle faz", logo abaixo da ilustração. */
export function Legenda({ itens }: { itens: { n: number; texto: ReactNode }[] }) {
  return (
    <ul className="-mt-1 mb-5 space-y-2">
      {itens.map((i) => (
        <li key={i.n} className="flex gap-2.5 text-sm text-muted-foreground">
          <Marca n={i.n} />
          <span className="min-w-0">{i.texto}</span>
        </li>
      ))}
    </ul>
  )
}

function Botao({ children, tom = "normal" }: { children: ReactNode; tom?: "normal" | "primario" | "perigo" }) {
  const cor =
    tom === "primario"
      ? "bg-primary text-primary-foreground"
      : tom === "perigo"
        ? "border border-destructive/40 text-destructive"
        : "border border-border bg-background"
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium ${cor}`}>
      {children}
    </span>
  )
}

function Campo({ valor, largura = "w-full" }: { valor: string; largura?: string }) {
  return (
    <span className={`inline-block truncate rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground ${largura}`}>
      {valor}
    </span>
  )
}

function Chave({ ligado }: { ligado: boolean }) {
  return (
    <span
      className={`inline-flex h-4 w-7 shrink-0 items-center rounded-full px-0.5 ${ligado ? "justify-end bg-primary" : "justify-start bg-muted-foreground/30"}`}
    >
      <span className="size-3 rounded-full bg-white" />
    </span>
  )
}

// --- Canais do YouTube ---

export function TelaAdicionarCanal() {
  return (
    <Tela titulo="Canais · adicionar">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold">Endereço do canal no YouTube</p>
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1">
            <Campo valor="https://youtube.com/@nomedocanal" />
          </span>
          <Marca n={1} />
          <Botao tom="primario">Adicionar canal</Botao>
          <Marca n={2} />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Cole o endereço da página inicial do canal. Também aceita @arroba.
        </p>
      </div>
    </Tela>
  )
}

export function TelaCartaoDoCanal() {
  return (
    <Tela titulo="Canais · um canal monitorado">
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
            <IconBrandYoutube className="size-4" />
          </span>
          <span className="min-w-0 flex-1 truncate text-xs font-semibold">Canal de exemplo</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-status-posted/10 px-1.5 py-0.5 text-[10px] font-medium text-status-posted">
            <IconPointFilled className="size-3" /> Ativo
          </span>
          <Marca n={1} />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
          <Chave ligado />
          <span className="text-[11px]">Baixar e cortar automaticamente</span>
          <Marca n={2} />
        </div>

        <div className="space-y-1.5 rounded-lg border border-border p-2">
          <p className="text-[10px] font-semibold text-muted-foreground">Postar no TikTok em</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px]">
              <IconBrandTiktok className="size-3" /> @suaconta
            </span>
            <Marca n={3} />
          </div>
        </div>

        <div className="space-y-1.5 rounded-lg border border-border p-2">
          <p className="text-[10px] font-semibold text-muted-foreground">Pasta no Google Drive</p>
          <div className="flex flex-wrap items-center gap-2">
            <Campo valor="Cortes / Canal de exemplo" largura="w-40" />
            <Botao>Enviar sozinho</Botao>
            <Marca n={4} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-border pt-2">
          <Botao tom="perigo">Remover canal</Botao>
          <Marca n={5} />
        </div>
      </div>
    </Tela>
  )
}

// --- Configuração dos cortes ---

export function TelaEscopoDoEstilo() {
  return (
    <Tela titulo="Cortes · onde este estilo vale">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold">Aplicar em</p>
        <div className="flex flex-wrap items-center gap-2">
          <Campo valor="Todos os canais" largura="w-48" />
          <Marca n={1} />
          <Botao>Voltar a seguir todos os canais</Botao>
          <Marca n={2} />
        </div>
        <p className="text-[10px] text-muted-foreground">
          Vale para todo canal que não tenha um estilo próprio, e para vídeos enviados avulsos.
        </p>
      </div>
    </Tela>
  )
}

export function TelaComoEscolherCortes() {
  return (
    <Tela titulo="Cortes · como funcionam">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold">Como escolher os cortes</p>
          <div className="flex flex-wrap gap-1.5">
            <Botao tom="primario">Melhores partes</Botao>
            <Botao>Cortar o vídeo inteiro em partes</Botao>
            <Botao>Escolher quantidade</Botao>
            <Marca n={1} />
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold">Quantidade de cortes (1 a 30)</p>
          <div className="flex items-center gap-2">
            <Campo valor="4" largura="w-14" />
            <Marca n={2} />
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold">Duração de cada corte</p>
          <div className="flex flex-wrap gap-1.5">
            <Botao>Curtos</Botao>
            <Botao tom="primario">Equilibrados</Botao>
            <Botao>Longos</Botao>
            <Botao>3 a 4 minutos</Botao>
            <Marca n={3} />
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold">Descrição do corte</p>
          <div className="flex flex-wrap gap-1.5">
            <Botao tom="primario">IA escreve</Botao>
            <Botao>Sempre a mesma</Botao>
            <Botao>Sem descrição</Botao>
            <Marca n={4} />
          </div>
        </div>
      </div>
    </Tela>
  )
}

export function TelaVideoEmPartes() {
  return (
    <Tela titulo="Cortes · vídeo inteiro em partes">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold">Como dividir o vídeo</p>
          <div className="flex flex-wrap gap-1.5">
            <Botao tom="primario">Pela duração de cada parte</Botao>
            <Botao>Pela quantidade de partes</Botao>
            <Marca n={1} />
          </div>
        </div>
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold">Duração média de cada parte (minutos)</p>
          <div className="flex items-center gap-2">
            <Campo valor="3" largura="w-14" />
            <Marca n={2} />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Um vídeo de 24 minutos com partes de 3 minutos dá 8 cortes.
          </p>
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2">
          <span className="mt-0.5 flex size-3.5 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <IconCheck className="size-2.5" />
          </span>
          <span className="min-w-0 text-[10px] text-muted-foreground">
            Numerar os cortes (Parte 1, Parte 2...) — ligado sozinho neste modo.
          </span>
          <Marca n={3} />
        </div>
      </div>
    </Tela>
  )
}

export function TelaEstiloVisual() {
  const estilos = ["Clássica", "Chamativa", "Balão escuro", "Neon verde", "Caixa (cor sua)", "Papel rasgado"]
  return (
    <Tela titulo="Cortes · estilo visual">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-[11px] font-semibold">Estilo visual do corte</p>
          <Botao>Automático</Botao>
          <Botao tom="primario">Manual</Botao>
          <Marca n={1} />
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold">Fundo do corte</p>
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
            {["Desfocado", "Preto", "Branco", "Sua imagem", "Capa", "Frame"].map((f, i) => (
              <span
                key={f}
                className={`rounded border p-1 text-center text-[9px] leading-tight ${i === 0 ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <span className="mb-1 block h-5 w-full rounded bg-muted-foreground/15" />
                {f}
              </span>
            ))}
          </div>
          <Marca n={2} />
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold">Estilo da legenda</p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {estilos.map((e, i) => (
              <span
                key={e}
                className={`rounded border p-1.5 text-center text-[9px] ${i === 0 ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <span className="mb-1 block rounded bg-neutral-800 py-1 text-[9px] font-bold text-white">Exemplo</span>
                {e}
              </span>
            ))}
          </div>
          <Marca n={3} />
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
          <span className="flex size-3.5 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <IconCheck className="size-2.5" />
          </span>
          <span className="text-[10px]">Mostrar o título no começo do vídeo</span>
          <Marca n={4} />
        </div>
      </div>
    </Tela>
  )
}

// --- Publicação ---

export function TelaConectarTiktok() {
  return (
    <Tela titulo="Publicação · conectar conta">
      <div className="space-y-2 text-center">
        <span className="mx-auto flex size-9 items-center justify-center rounded-full bg-foreground text-background">
          <IconBrandTiktok className="size-5" />
        </span>
        <p className="text-[11px] font-semibold">Nenhuma conta do TikTok conectada</p>
        <p className="mx-auto max-w-xs text-[10px] text-muted-foreground">
          Conecte a conta onde os cortes serão publicados. Você autoriza dentro do próprio TikTok.
        </p>
        <span className="inline-flex items-center gap-2">
          <Botao tom="primario">Conectar conta do TikTok</Botao>
          <Marca n={1} />
        </span>
      </div>
    </Tela>
  )
}

export function TelaOpcoesDePublicacao() {
  return (
    <Tela titulo="Publicação · opções obrigatórias">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold">Quem pode ver</p>
          <div className="flex flex-wrap gap-1.5">
            <Botao tom="primario">Todo mundo</Botao>
            <Botao>Só amigos</Botao>
            <Botao>Só eu</Botao>
            <Marca n={1} />
          </div>
        </div>
        <div className="space-y-1.5 rounded-lg border border-border p-2">
          {[
            { rotulo: "Permitir comentários", ligado: true },
            { rotulo: "Permitir dueto", ligado: true },
            { rotulo: "Permitir junção", ligado: false },
          ].map((o) => (
            <div key={o.rotulo} className="flex items-center gap-2">
              <Chave ligado={o.ligado} />
              <span className="text-[10px]">{o.rotulo}</span>
            </div>
          ))}
          <Marca n={2} />
        </div>
        <div className="space-y-1.5 rounded-lg border border-border p-2">
          <div className="flex items-center gap-2">
            <Chave ligado={false} />
            <span className="text-[10px]">Este vídeo é publicidade</span>
            <Marca n={3} />
          </div>
        </div>
      </div>
    </Tela>
  )
}

export function TelaHorarios() {
  return (
    <Tela titulo="Publicação · horários">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-[11px] font-semibold">Modo</p>
          <Botao tom="primario">Escolher horários</Botao>
          <Botao>Automático</Botao>
          <Marca n={1} />
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold">Quantos por dia</p>
          <div className="flex items-center gap-2">
            <Campo valor="4" largura="w-14" />
            <Marca n={2} />
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold">Horários</p>
          <div className="flex flex-wrap items-center gap-1.5">
            {["08:00", "12:00", "16:00", "20:00"].map((h) => (
              <span key={h} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px]">
                <IconClock className="size-3" />
                {h}
              </span>
            ))}
            <Botao>+ Adicionar</Botao>
            <Marca n={3} />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
          <Chave ligado />
          <span className="text-[10px]">Publicar sozinho nesses horários</span>
          <Marca n={4} />
        </div>
      </div>
    </Tela>
  )
}

export function TelaFilaDePostagem() {
  const linhas = [
    { hora: "hoje às 08:00", titulo: "Parte 1 · o começo da história" },
    { hora: "hoje às 12:00", titulo: "Parte 2 · a virada" },
    { hora: "hoje às 16:00", titulo: "Parte 3 · o final" },
  ]
  return (
    <Tela titulo="Publicação · fila">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <Botao tom="primario">Fila</Botao>
          <Botao>Postados</Botao>
          <Botao>Erro</Botao>
          <Marca n={1} />
        </div>
        {linhas.map((l, i) => (
          <div key={l.titulo} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="h-8 w-5 shrink-0 rounded bg-muted-foreground/15" />
            <span className="min-w-0 flex-1 truncate text-[11px]">{l.titulo}</span>
            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
              <IconClock className="size-3" /> {l.hora}
            </span>
            {i === 0 && <Marca n={2} />}
          </div>
        ))}
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Botao>Postar agora</Botao>
          <Botao>Editar legenda</Botao>
          <Botao tom="perigo">Não postar</Botao>
          <Marca n={3} />
        </div>
      </div>
    </Tela>
  )
}

export function TelaPostados() {
  return (
    <Tela titulo="Publicação · postados">
      <div className="space-y-2">
        {["Parte 1 · o começo da história", "Parte 2 · a virada"].map((t) => (
          <div key={t} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
            <span className="h-8 w-5 shrink-0 rounded bg-muted-foreground/15" />
            <span className="min-w-0 flex-1 truncate text-[11px]">{t}</span>
            <span className="inline-flex items-center gap-1 rounded-full bg-status-posted/10 px-1.5 py-0.5 text-[10px] font-medium text-status-posted">
              <IconCheck className="size-3" /> Postado
            </span>
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground">
          O arquivo do corte é apagado do servidor 3 dias depois de publicado. O vídeo no TikTok continua no ar.
        </p>
      </div>
    </Tela>
  )
}

export function TelaAcompanharCortes() {
  return (
    <Tela titulo="Cortes · acompanhamento">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <Botao tom="primario">Em andamento</Botao>
          <Botao>Prontos</Botao>
          <Marca n={1} />
        </div>
        <div className="space-y-1.5 rounded-lg border border-border p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] font-medium">Vídeo de exemplo</span>
            <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">
              Cortando
            </span>
          </div>
          <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <span className="block h-full w-2/3 rounded-full bg-primary" />
          </span>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground">3 de 8 cortes prontos</span>
            <Botao>Pausar</Botao>
            <Marca n={2} />
          </div>
        </div>
      </div>
    </Tela>
  )
}
