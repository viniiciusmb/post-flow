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
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandTiktok,
  IconBrandYoutube,
  IconBroadcast,
  IconCheck,
  IconClock,
  IconHeart,
  IconPlus,
  IconPointFilled,
  IconScissors,
  IconSend,
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

// --- Configuração dos cortes ---

export function TelaComoEscolherCortes() {
  return (
    <Tela titulo="Vídeos do YouTube · Estilo do corte">
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
    <Tela titulo="Vídeos do YouTube · Estilo do corte">
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
    <Tela titulo="Vídeos do YouTube · Estilo do corte">
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

export function TelaOpcoesDePublicacao() {
  return (
    <Tela titulo="Redes sociais · TikTok · opções de publicação">
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
    <Tela titulo="Redes sociais · uma conta · Horários e opções">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-[11px] font-semibold">Modo</p>
          <Botao tom="primario">Escolher horários</Botao>
          <Botao>Padrão</Botao>
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
    <Tela titulo="Redes sociais · uma conta · Fila">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          <Botao tom="primario">Fila</Botao>
          <Botao>Publicados</Botao>
          <Botao>Não saíram</Botao>
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

// ---------------------------------------------------------------------------
// Painel novo (12/10/2026): Redes sociais, Vídeos do YouTube, Lives, Feed,
// Início e Plano e uso.

function Selo({ cor, children }: { cor: string; children: ReactNode }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md text-white" style={{ background: cor }}>
      {children}
    </span>
  )
}

export function TelaRedesSociais() {
  const contas = [
    { cor: "#111", Icone: IconBrandTiktok, nome: "Sua marca", rede: "TikTok", estado: "Publicando sozinha", ok: true },
    { cor: "#DD2A7B", Icone: IconBrandInstagram, nome: "Sua marca", rede: "Instagram", estado: "Não publica sozinha", ok: false },
  ]
  return (
    <Tela titulo="Redes sociais">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1 rounded-lg bg-muted p-0.5">
            <span className="rounded-md bg-background px-2 py-0.5 text-[11px] font-medium shadow-sm">Todas 2</span>
            <span className="px-2 py-0.5 text-[11px] text-muted-foreground">TikTok 1</span>
            <span className="px-2 py-0.5 text-[11px] text-muted-foreground">Instagram 1</span>
            <Marca n={1} />
          </div>
          <span className="inline-flex items-center gap-2">
            <Botao tom="primario">
              <IconPlus className="size-3" /> Conectar rede
            </Botao>
            <Marca n={2} />
          </span>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {contas.map((c, i) => (
            <div key={c.rede} className="rounded-lg border border-border p-2">
              <div className="flex items-center gap-2">
                <Selo cor={c.cor}>
                  <c.Icone className="size-3.5" />
                </Selo>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-semibold">{c.nome}</span>
                  <span className="block text-[10px] text-muted-foreground">@suamarca · {c.rede}</span>
                </span>
                {i === 0 && <Marca n={3} />}
              </div>
              <p className={`mt-1.5 flex items-center gap-1 text-[10px] font-medium ${c.ok ? "text-status-posted" : "text-amber-600"}`}>
                <IconPointFilled className="size-3" /> {c.estado}
              </p>
              <p className="mt-1 border-t border-border pt-1 text-[10px] text-muted-foreground">3 na fila · próximo hoje às 16:00</p>
            </div>
          ))}
        </div>
      </div>
    </Tela>
  )
}

export function TelaConectarRede() {
  return (
    <Tela titulo="Redes sociais · Conectar Instagram">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Selo cor="#DD2A7B">
            <IconBrandInstagram className="size-3.5" />
          </Selo>
          <span className="text-[11px] font-semibold">Conectar Instagram · os cortes saem como Reels</span>
        </div>
        <div className="divide-y divide-border rounded-lg border border-border text-[10px]">
          <p className="flex justify-between gap-2 px-2 py-1.5"><span className="text-muted-foreground">Conta</span><span className="font-medium">Profissional (Criador ou Empresa)</span></p>
          <p className="flex justify-between gap-2 px-2 py-1.5"><span className="text-muted-foreground">Duração</span><span className="font-medium">Até 90 segundos</span></p>
          <span className="flex items-center justify-between gap-2 px-2 py-1.5"><span className="text-muted-foreground">Exigências da rede</span><Marca n={1} /></span>
        </div>
        <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-700 dark:text-amber-400">
          Rede cheia? Seu plano mostra quantas contas cabem em cada rede. Dá pra comprar conta extra por R$ 9,90/mês.
        </p>
        <span className="flex flex-wrap items-center justify-end gap-2">
          <Botao>Agora não</Botao>
          <Botao tom="primario">Conectar Instagram</Botao>
          <Marca n={2} />
        </span>
      </div>
    </Tela>
  )
}

export function TelaReguaDoDia() {
  const horas = ["agora", "16h", "20h", "amanhã", "08h", "12h"]
  return (
    <Tela titulo="Redes sociais · uma conta · próximas 24 horas">
      <div className="space-y-2">
        <div className="relative flex items-end justify-between gap-1 border-b border-border pb-1">
          {horas.map((h, i) => (
            <span key={h} className="flex flex-col items-center gap-1">
              <span className={`h-7 w-4 rounded ${i === 1 || i === 2 || i === 4 ? "bg-primary/60" : "bg-muted"}`} />
              <span className="text-[9px] text-muted-foreground">{h}</span>
            </span>
          ))}
          <Marca n={1} />
        </div>
        <p className="text-[10px] text-muted-foreground">Cada capinha é um corte, no horário em que vai sair.</p>
        <span className="flex items-center gap-2">
          <Botao>Usar estes horários em todas as contas</Botao>
          <Marca n={2} />
        </span>
      </div>
    </Tela>
  )
}

export function TelaCanalYoutube() {
  return (
    <Tela titulo="Vídeos do YouTube · um canal">
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-md border border-primary bg-primary/5 px-2 py-1 text-[11px] font-medium">
            <IconBrandYoutube className="size-3 text-red-500" /> Canal de exemplo
          </span>
          <span className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground">Envios avulsos</span>
          <Botao>
            <IconPlus className="size-3" /> Adicionar canal
          </Botao>
          <Marca n={1} />
        </div>
        <p className="flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
          <IconPointFilled className="size-3 text-status-posted" /> Pegando vídeos novos · estilo próprio · publica em @suamarca (TikTok, Instagram)
          <Marca n={2} />
        </p>
        <div className="flex flex-wrap gap-3 border-b border-border text-[11px]">
          <span className="border-b-2 border-foreground pb-1 font-medium">Vídeos e cortes</span>
          <span className="pb-1 text-muted-foreground">Estilo do corte</span>
          <span className="pb-1 text-muted-foreground">Monitoramento e destinos</span>
          <Marca n={3} />
        </div>
        <div className="rounded-lg border border-border p-2">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-[11px] font-medium">Vídeo de exemplo</span>
            <span className="rounded-full bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">Cortando 3 de 8</span>
          </div>
          <div className="mt-1.5 flex gap-1">
            {["Baixando", "Transcrevendo", "Escolhendo", "Cortando"].map((e, i) => (
              <span key={e} className={`h-1 flex-1 rounded-full ${i < 3 ? "bg-status-posted" : "bg-blue-500"}`} />
            ))}
          </div>
          <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <Botao>Pausar</Botao>
            <Botao>Enviar cortes pra fila de postagem</Botao>
            <Marca n={4} />
          </span>
        </div>
      </div>
    </Tela>
  )
}

export function TelaMonitoramento() {
  return (
    <Tela titulo="Vídeos do YouTube · Monitoramento e destinos">
      <div className="space-y-2.5">
        <div className="flex items-center gap-2 rounded-lg border border-border p-2">
          <Chave ligado />
          <span className="text-[11px]">Pegar vídeos novos deste canal</span>
          <Marca n={1} />
        </div>
        <div className="space-y-1.5 rounded-lg border border-border p-2">
          <p className="text-[10px] font-semibold text-muted-foreground">Onde publicar os cortes deste canal</p>
          {[
            { cor: "#111", Icone: IconBrandTiktok, nome: "@suamarca · TikTok", on: true },
            { cor: "#DD2A7B", Icone: IconBrandInstagram, nome: "@suamarca · Instagram", on: true },
            { cor: "#1877F2", Icone: IconBrandFacebook, nome: "Sua Página · Facebook", on: false },
          ].map((c) => (
            <span key={c.nome} className="flex items-center gap-2 text-[11px]">
              <span className={`flex size-3.5 items-center justify-center rounded-sm ${c.on ? "bg-primary text-primary-foreground" : "border border-border"}`}>
                {c.on && <IconCheck className="size-2.5" />}
              </span>
              <Selo cor={c.cor}>
                <c.Icone className="size-3" />
              </Selo>
              {c.nome}
            </span>
          ))}
          <Marca n={2} />
        </div>
        <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2">
          <span className="mt-0.5 flex size-3.5 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <IconCheck className="size-2.5" />
          </span>
          <span className="min-w-0 text-[10px] leading-snug">Só pegar vídeo novo quando a fila estiver quase vazia</span>
          <Marca n={3} />
        </div>
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-[10px]">
          Não processar vídeos acima de <Campo valor="60" largura="w-12" /> minutos
          <Marca n={4} />
        </div>
      </div>
    </Tela>
  )
}

export function TelaModelos() {
  const modelos = ["Viral amarelo", "Clean", "Podcast", "Série em partes"]
  return (
    <Tela titulo="Vídeos do YouTube · Estilo do corte · modelos">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold">Aplicar em</p>
          <Botao tom="primario">Só este canal</Botao>
          <Botao>Todos os canais</Botao>
          <Marca n={1} />
        </div>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
          {modelos.map((m, i) => (
            <span key={m} className={`rounded border p-1.5 text-center text-[9px] ${i === 0 ? "border-primary bg-primary/5" : "border-border"}`}>
              <span className="mx-auto mb-1 block h-10 w-6 rounded bg-neutral-800" />
              {m}
            </span>
          ))}
        </div>
        <span className="flex items-center gap-2">
          <Marca n={2} />
          <Botao>Salvar como modelo</Botao>
          <Marca n={3} />
        </span>
      </div>
    </Tela>
  )
}

export function TelaLives() {
  return (
    <Tela titulo="Lives · seus canais">
      <div className="space-y-2.5">
        <div className="grid gap-px overflow-hidden rounded-lg border bg-border text-[10px] sm:grid-cols-3">
          <span className="bg-card px-2 py-1.5"><b>3 min de live = 1 crédito</b><br />1 hora gasta 20 créditos</span>
          <span className="bg-card px-2 py-1.5"><b>Clipar este momento</b><br />1 crédito por clique</span>
          <span className="flex items-center justify-between bg-card px-2 py-1.5"><span><b>180 créditos</b><br />≈ 9 h de live</span><Marca n={1} /></span>
        </div>
        <div className="mx-auto max-w-xs rounded-xl border border-red-500/40 p-3 text-center">
          <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-muted ring-2 ring-red-500">
            <IconBroadcast className="size-5 text-muted-foreground" />
          </span>
          <span className="mx-auto mt-1 inline-block rounded bg-red-600 px-1.5 text-[9px] font-bold text-white">AO VIVO</span>
          <p className="mt-1 text-[11px] font-semibold">Streamer de exemplo</p>
          <p className="text-[10px] text-muted-foreground">Clipando há 12 min · 4 créditos</p>
          <div className="mt-2 flex items-center justify-between gap-2 text-left">
            <span className="text-[10px]">Clipar sempre que estiver ao vivo</span>
            <Chave ligado />
            <Marca n={2} />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="flex-1 rounded-md border border-red-500/60 py-1 text-[11px] font-medium text-red-600">Parar de clipar</span>
            <Marca n={3} />
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="flex flex-1 items-center justify-center gap-1 rounded-md bg-neutral-900 py-1 text-[11px] text-white">
              <IconScissors className="size-3" /> Clipar este momento · 1 crédito
            </span>
            <Marca n={4} />
          </div>
        </div>
      </div>
    </Tela>
  )
}

export function TelaFeed() {
  return (
    <Tela titulo="Feed de cortes">
      <div className="mx-auto flex max-w-[11rem] gap-2">
        <span className="relative block aspect-[9/16] flex-1 overflow-hidden rounded-lg bg-neutral-800">
          <span className="absolute inset-x-2 bottom-2 text-[9px] text-white">Título do corte · Canal de exemplo</span>
          <span className="absolute left-2 top-2"><Marca n={1} /></span>
        </span>
        <span className="flex flex-col items-center justify-end gap-2 pb-2 text-muted-foreground">
          <IconHeart className="size-4" />
          <Marca n={2} />
          <IconSend className="size-4" />
          <Marca n={3} />
        </span>
      </div>
    </Tela>
  )
}

export function TelaLinhaDeProducao() {
  const etapas = ["Download", "Transcrição", "Seleção dos cortes", "Corte e legenda"]
  return (
    <Tela titulo="Início · linha de produção">
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2 text-[10px]">
          <span className="rounded-md border border-red-500/40 px-2 py-1"><IconBrandYoutube className="mr-1 inline size-3 text-red-500" />Vigia do YouTube</span>
          <span className="rounded-md border border-violet-500/40 px-2 py-1"><IconBroadcast className="mr-1 inline size-3 text-violet-500" />Lives monitoradas</span>
        </div>
        <div className="flex flex-col items-center gap-1">
          {etapas.map((e, i) => (
            <span key={e} className="flex w-full max-w-[14rem] items-center justify-between gap-2 rounded-md border border-border px-2 py-1 text-[10px]">
              {e}
              {i === 3 ? <Marca n={1} /> : <span className="size-1.5 rounded-full bg-primary/60" />}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-1.5 text-[10px]">
          <span className="rounded-md border border-border px-2 py-1">Fila do TikTok</span>
          <span className="rounded-md border border-border px-2 py-1">Fila do Instagram</span>
          <span className="rounded-md border border-border px-2 py-1">Feed de cortes</span>
          <Marca n={2} />
        </div>
      </div>
    </Tela>
  )
}

export function TelaPlanoEUso() {
  return (
    <Tela titulo="Plano e uso · Resumo">
      <div className="space-y-2">
        <div className="flex flex-wrap gap-3 border-b border-border text-[11px]">
          <span className="border-b-2 border-foreground pb-1 font-medium">Resumo</span>
          <span className="pb-1 text-muted-foreground">Comprar</span>
          <span className="pb-1 text-muted-foreground">Planos</span>
          <span className="pb-1 text-muted-foreground">Faturas</span>
          <Marca n={1} />
        </div>
        <div className="grid gap-1.5 text-[10px] sm:grid-cols-3">
          <span className="rounded-md border border-border px-2 py-1.5"><b>1 min de vídeo = 1 crédito</b></span>
          <span className="rounded-md border border-border px-2 py-1.5"><b>3 min de live = 1 crédito</b></span>
          <span className="flex items-center justify-between rounded-md border border-border px-2 py-1.5"><b>Clipar momento = 1</b><Marca n={2} /></span>
        </div>
        <div className="space-y-1 rounded-md border border-border p-2 text-[10px]">
          <span className="flex justify-between"><span><IconBrandInstagram className="mr-1 inline size-3" />Instagram</span><b>1 de 1</b></span>
          <span className="flex justify-between"><span><IconBrandTiktok className="mr-1 inline size-3" />TikTok</span><b>1 de 1</b></span>
          <span className="flex items-center justify-between text-primary">Comprar conta extra → R$ 9,90/mês<Marca n={3} /></span>
        </div>
      </div>
    </Tela>
  )
}
