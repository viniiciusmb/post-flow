/**
 * Conteúdo do Tutorial.
 *
 * Fica FORA do dicionário de tradução de propósito. O dicionário é uma lista
 * plana de rótulos curtos ("Salvar", "Cancelar"); o tutorial é texto corrido
 * com estrutura — seções, listas, avisos, ilustrações numeradas. Enfiar isso
 * lá dentro daria centenas de chaves soltas impossíveis de revisar como texto.
 *
 * O tipo `Record<Idioma, Conteudo>` obriga os três idiomas a existirem: um
 * tutorial que só abre em português num painel trilíngue seria pior do que não
 * ter tutorial, porque a pessoa clica e encontra uma língua que não fala.
 */
import type { Idioma } from "@/i18n"

/** Qual ilustração de tela desenhar (ver components/tutorial/Mockups.tsx). */
export type TelaKey =
  | "redesSociais"
  | "conectarRede"
  | "opcoesDePublicacao"
  | "modelos"
  | "comoEscolherCortes"
  | "videoEmPartes"
  | "estiloVisual"
  | "canalYoutube"
  | "monitoramento"
  | "reguaDoDia"
  | "horarios"
  | "filaDePostagem"
  | "lives"
  | "feed"
  | "linhaDeProducao"
  | "planoEUso"

export type Bloco =
  | { tipo: "p"; texto: string }
  | { tipo: "lista"; itens: string[] }
  | { tipo: "tela"; qual: TelaKey; legenda: { n: number; texto: string }[] }
  | { tipo: "aviso"; titulo: string; texto: string }

export type Passo = {
  id: string
  /** Qual passo do checklist esta seção conclui (quando conclui algum). */
  marco?: "tiktokConectado" | "estiloConfigurado" | "canalMonitorado"
  titulo: string
  resumo: string
  ondeFica: string
  link?: { texto: string; url: string }
  blocos: Bloco[]
}

export type Conteudo = {
  intro: string
  introSemPlano: string
  passos: Passo[]
  fim: { titulo: string; texto: string }
}


// Reescrito em 12/10/2026 para o painel novo (Vídeos do YouTube, Lives, Redes
// sociais, Feed, Início em linha de produção). Os nomes de menu e botão aqui
// são os que aparecem na tela - se um mudar, mude aqui também.

const pt: Conteudo = {
  intro:
    "Configure nesta ordem e o Post Flow passa a trabalhar sozinho: acha os vídeos novos, corta, legenda e publica nas suas redes nos horários que você escolher. Leva uns 15 minutos.",
  introSemPlano:
    "Você ainda não tem um plano ativo, então algumas telas vão aparecer bloqueadas. Pode ler tudo mesmo assim: quando ativar o plano, é só seguir os passos na ordem.",
  fim: {
    titulo: "Pronto. E agora?",
    texto:
      "Daqui pra frente o sistema trabalha sozinho. Você acompanha tudo no Início e só precisa voltar às configurações se quiser mudar o estilo, os horários, ou adicionar outro canal, live ou rede.",
  },
  passos: [
    {
      id: "redes",
      marco: "tiktokConectado",
      titulo: "Conectar suas redes sociais",
      resumo: "São as contas onde os cortes vão ser publicados. Comece por aqui: o resto precisa saber para onde mandar.",
      ondeFica: "Menu Redes sociais",
      link: { texto: "Abrir Redes sociais", url: "/client/social" },
      blocos: [
        {
          tipo: "p",
          texto:
            "O Post Flow publica no TikTok, Instagram, Facebook, YouTube Shorts, Threads, LinkedIn, Pinterest e Bluesky. Cada conta conectada ganha a própria fila e os próprios horários.",
        },
        {
          tipo: "tela",
          qual: "redesSociais",
          legenda: [
            { n: 1, texto: "Filtro por rede: veja todas as contas juntas ou só as de uma rede." },
            { n: 2, texto: "Conectar rede: abre a lista de redes. Você autoriza dentro da própria rede, sem passar sua senha pra gente." },
            { n: 3, texto: "Cada conta mostra se está publicando sozinha, quantos cortes estão na fila e quando sai o próximo. Clique nela para ver a fila e os horários." },
          ],
        },
        {
          tipo: "tela",
          qual: "conectarRede",
          legenda: [
            { n: 1, texto: "Antes de conectar, a janela mostra o que a rede exige. Leia: é o motivo mais comum de uma conexão falhar." },
            { n: 2, texto: "Conectar: você vai para a tela da rede, autoriza, e volta para o Post Flow com a conta já na lista." },
          ],
        },
        {
          tipo: "lista",
          itens: [
            "TikTok: qualquer conta. Para publicar direto no perfil, escolha antes quem pode ver e as interações (é exigência do TikTok).",
            "Instagram: precisa ser conta profissional (Criador de conteúdo ou Empresa). Só publica cortes de até 90 segundos.",
            "Facebook: só Páginas, nunca o perfil pessoal. Os cortes saem como Reels.",
            "YouTube: os cortes saem como Shorts (até 3 minutos).",
            "Pinterest: escolha em qual pasta os cortes entram, senão eles não saem.",
          ],
        },
        {
          tipo: "tela",
          qual: "opcoesDePublicacao",
          legenda: [
            { n: 1, texto: "TikTok: quem pode ver o vídeo." },
            { n: 2, texto: "TikTok: comentários, dueto e junção." },
            { n: 3, texto: "TikTok: marque se o vídeo é publicidade. É obrigação legal quando é." },
          ],
        },
        {
          tipo: "aviso",
          titulo: "Quantas contas cabem",
          texto:
            "O plano define quantas contas você conecta em cada rede: Starter 1, Pro 3 e Max 6 (no TikTok vale o limite do plano). Se precisar de mais numa rede só, compre uma conta extra por R$ 9,90/mês em Plano e uso.",
        },
      ],
    },
    {
      id: "estilo",
      marco: "estiloConfigurado",
      titulo: "Escolher o estilo dos cortes",
      resumo: "Como os cortes são escolhidos, quanto duram e como ficam: legenda, título e fundo.",
      ondeFica: "Vídeos do YouTube → aba Estilo do corte",
      link: { texto: "Abrir Vídeos do YouTube", url: "/client/youtube" },
      blocos: [
        {
          tipo: "p",
          texto:
            "O jeito mais rápido é escolher um modelo pronto e ajustar o que quiser. O estilo vale para todos os vídeos cortados daqui pra frente.",
        },
        {
          tipo: "tela",
          qual: "modelos",
          legenda: [
            { n: 1, texto: "Aplicar em: só este canal, ou todos os canais (o seu padrão)." },
            { n: 2, texto: "Modelos prontos: um clique e o estilo inteiro muda." },
            { n: 3, texto: "Salvar como modelo: guarda o seu estilo para usar em outro canal." },
          ],
        },
        {
          tipo: "tela",
          qual: "comoEscolherCortes",
          legenda: [
            { n: 1, texto: "Melhores partes: a IA escolhe os trechos com mais chance de prender. Vídeo inteiro em partes: corta tudo, em sequência. Escolher quantidade: você diz quantos cortes quer." },
            { n: 2, texto: "Quantos cortes por vídeo." },
            { n: 3, texto: "Quanto dura cada corte." },
            { n: 4, texto: "A descrição que vai junto na publicação: escrita pela IA, sempre a mesma, ou nenhuma." },
          ],
        },
        {
          tipo: "tela",
          qual: "videoEmPartes",
          legenda: [
            { n: 1, texto: "No modo de partes: dividir pela duração de cada parte ou pela quantidade." },
            { n: 2, texto: "A duração é uma média: o vídeo é dividido em partes iguais." },
            { n: 3, texto: "\"Parte 1, Parte 2...\" fica sempre ligado nesse modo, senão as partes chegam sem ordem." },
          ],
        },
        {
          tipo: "tela",
          qual: "estiloVisual",
          legenda: [
            { n: 1, texto: "Automático usa o estilo padrão. Manual libera o resto desta tela." },
            { n: 2, texto: "Fundo atrás do vídeo e enquadramento (arraste o vídeo dentro da moldura)." },
            { n: 3, texto: "Modelo da legenda." },
            { n: 4, texto: "Título no começo do corte e o modelo dele." },
          ],
        },
      ],
    },
    {
      id: "canal",
      marco: "canalMonitorado",
      titulo: "Monitorar um canal do YouTube",
      resumo: "O Post Flow passa a olhar o canal e corta cada vídeo novo que sair.",
      ondeFica: "Vídeos do YouTube → Adicionar canal",
      link: { texto: "Abrir Vídeos do YouTube", url: "/client/youtube" },
      blocos: [
        {
          tipo: "tela",
          qual: "canalYoutube",
          legenda: [
            { n: 1, texto: "Seus canais ficam no topo. Envios avulsos é onde ficam os vídeos que você mandou por link ou do computador." },
            { n: 2, texto: "A linha de estado diz se o canal está pegando vídeos, qual estilo usa e em quais contas publica." },
            { n: 3, texto: "Três abas: os vídeos e cortes, o estilo deste canal, e o monitoramento e destinos." },
            { n: 4, texto: "Cada vídeo mostra a etapa em que está. Dá pra pausar e mandar os cortes pra fila." },
          ],
        },
        {
          tipo: "tela",
          qual: "monitoramento",
          legenda: [
            { n: 1, texto: "Liga ou desliga a busca por vídeos novos. Desligado, nada é baixado nem cobrado." },
            { n: 2, texto: "Marque em quais contas os cortes deste canal são publicados. Pode marcar várias redes ao mesmo tempo." },
            { n: 3, texto: "Freio de fila: só pega vídeo novo quando a fila estiver quase vazia, pra os cortes não saírem com assunto velho." },
            { n: 4, texto: "Limite de duração: vídeos mais longos ficam esperando você mandar processar, em vez de gastar créditos sozinhos." },
          ],
        },
        {
          tipo: "aviso",
          titulo: "Só vídeos novos",
          texto:
            "Ao adicionar o canal, o Post Flow pergunta se você quer cortar o vídeo mais recente. Depois disso ele pega só o que sair dali pra frente. Para cortar o último vídeo de novo, use o botão \"Cortar último vídeo\".",
        },
      ],
    },
    {
      id: "horarios",
      titulo: "Escolher quando cada corte sai",
      resumo: "Cada conta tem a própria fila com horários. Você vê na hora quando cada corte vai ser publicado.",
      ondeFica: "Redes sociais → clique numa conta",
      link: { texto: "Abrir Redes sociais", url: "/client/social" },
      blocos: [
        {
          tipo: "tela",
          qual: "reguaDoDia",
          legenda: [
            { n: 1, texto: "A régua mostra as próximas 24 horas e a capinha de cada corte no horário em que ele sai." },
            { n: 2, texto: "Usar estes horários em todas as contas: copia a configuração para todas as redes de uma vez." },
          ],
        },
        {
          tipo: "tela",
          qual: "horarios",
          legenda: [
            { n: 1, texto: "Padrão espalha os cortes entre 8h e 20h em horas cheias. Ou escolha os horários você mesmo." },
            { n: 2, texto: "Quantos cortes por dia nesta conta." },
            { n: 3, texto: "Os horários de publicação." },
            { n: 4, texto: "Publicar sozinho: desligado, os cortes ficam na fila esperando você." },
          ],
        },
        {
          tipo: "tela",
          qual: "filaDePostagem",
          legenda: [
            { n: 1, texto: "Fila, Publicados e Não saíram (as que deram erro, com o motivo e o botão de tentar de novo)." },
            { n: 2, texto: "O horário mostrado é o horário real em que o corte sai." },
            { n: 3, texto: "Postar agora, editar a legenda ou tirar o corte da fila." },
          ],
        },
        {
          tipo: "aviso",
          titulo: "Não publique demais",
          texto:
            "Redes como o TikTok marcam como spam a conta que publica muito de uma vez. O Post Flow respeita o \"quantos por dia\" e não deixa usar o \"Postar agora\" mais de 10 vezes em 24 horas.",
        },
      ],
    },
    {
      id: "lives",
      titulo: "Clipar lives da Twitch e da Kick",
      resumo: "O Post Flow grava a live, acha os melhores momentos com IA e entrega os cortes prontos.",
      ondeFica: "Menu Lives",
      link: { texto: "Abrir Lives", url: "/client/lives" },
      blocos: [
        {
          tipo: "p",
          texto:
            "Adicione o canal do streamer pelo link ou pelo nome. Quando ele entrar ao vivo, a gravação começa sozinha (ou só quando você pedir).",
        },
        {
          tipo: "tela",
          qual: "lives",
          legenda: [
            { n: 1, texto: "Quanto vale o crédito: 3 minutos de live clipada gastam 1 crédito (1 hora = 20 créditos), os mesmos créditos dos vídeos do YouTube." },
            { n: 2, texto: "Clipar sempre que estiver ao vivo: ligado, toda live deste canal vira cortes sozinha." },
            { n: 3, texto: "Parar de clipar: para na hora e para de gastar crédito." },
            { n: 4, texto: "Clipar este momento: viu algo bom? Um clique corta os últimos 2 minutos e meio (1 crédito)." },
          ],
        },
        {
          tipo: "lista",
          itens: [
            "Seu plano acompanha 1 (Starter), 2 (Pro) ou 3 (Max) canais de live, e clipa 1 live por vez.",
            "Se duas lives começarem juntas, a primeira é clipada; quando ela acabar, a outra começa sozinha.",
            "Quando o servidor está cheio, o cartão avisa e a gravação começa assim que abrir vaga.",
            "Os cortes de live ficam disponíveis por 3 dias. Baixe ou publique antes disso.",
          ],
        },
        {
          tipo: "aviso",
          titulo: "Cortes de live vão para o Feed",
          texto:
            "Os cortes de live não entram sozinhos na fila de publicação. Eles aparecem no Feed de cortes, e de lá você escolhe em quais contas publicar.",
        },
      ],
    },
    {
      id: "feed",
      titulo: "Ver e publicar cortes no Feed",
      resumo: "Todos os seus cortes, de vídeos e de lives, um por tela, como numa rede social.",
      ondeFica: "Menu Feed de cortes",
      link: { texto: "Abrir Feed de cortes", url: "/client/feed" },
      blocos: [
        {
          tipo: "tela",
          qual: "feed",
          legenda: [
            { n: 1, texto: "Role para passar de corte. O primeiro toque liga o som." },
            { n: 2, texto: "Curtir (ou dois toques no vídeo): os curtidos ficam na aba Gostei." },
            { n: 3, texto: "Postar: escolha as contas e o corte entra na fila de cada uma, no próximo horário livre." },
          ],
        },
        {
          tipo: "p",
          texto: "Os filtros escolhem a origem (YouTube ou lives), o canal e a ordem. Cortes que você já viu não aparecem de novo.",
        },
      ],
    },
    {
      id: "acompanhar",
      titulo: "Acompanhar tudo e cuidar dos créditos",
      resumo: "O Início mostra a máquina trabalhando; Plano e uso mostra o quanto você está gastando.",
      ondeFica: "Menu Início e menu Plano e uso",
      link: { texto: "Abrir Plano e uso", url: "/client/billing" },
      blocos: [
        {
          tipo: "tela",
          qual: "linhaDeProducao",
          legenda: [
            { n: 1, texto: "Cada etapa mostra o vídeo ou a live que está passando por ela agora." },
            { n: 2, texto: "Quando um corte fica pronto, ele vai para a fila da conta onde vai ser publicado." },
          ],
        },
        {
          tipo: "tela",
          qual: "planoEUso",
          legenda: [
            { n: 1, texto: "Resumo, Comprar, Planos e Faturas." },
            { n: 2, texto: "Quanto cada coisa gasta: 1 minuto de vídeo = 1 crédito, 3 minutos de live = 1 crédito, Clipar este momento = 1 crédito." },
            { n: 3, texto: "Quanto você usa de cada rede e onde comprar conta extra (R$ 9,90/mês por conta)." },
          ],
        },
        {
          tipo: "aviso",
          titulo: "Se uma publicação falhar",
          texto:
            "Ela aparece em \"Não saíram\", na conta, com o motivo em português e o botão de tentar de novo. Se a rede pedir pra reconectar, a conta mostra o aviso e o botão Reconectar.",
        },
      ],
    },
  ],
}

const en: Conteudo = {
  intro:
    "Set things up in this order and Post Flow starts working on its own: it finds new videos, cuts them, adds captions and publishes to your networks at the times you choose. It takes about 15 minutes.",
  introSemPlano:
    "You don't have an active plan yet, so some screens will appear locked. You can still read everything: once your plan is active, just follow the steps in order.",
  fim: {
    titulo: "That's it. What now?",
    texto:
      "From here on the system works on its own. You follow everything on Home and only need to come back to the settings to change the style, the times, or add another channel, live or network.",
  },
  passos: [
    {
      id: "redes",
      marco: "tiktokConectado",
      titulo: "Connect your social networks",
      resumo: "These are the accounts where clips will be published. Start here: everything else needs to know where to send them.",
      ondeFica: "Social networks menu",
      link: { texto: "Open Social networks", url: "/client/social" },
      blocos: [
        {
          tipo: "p",
          texto:
            "Post Flow publishes to TikTok, Instagram, Facebook, YouTube Shorts, Threads, LinkedIn, Pinterest and Bluesky. Each connected account gets its own queue and its own times.",
        },
        {
          tipo: "tela",
          qual: "redesSociais",
          legenda: [
            { n: 1, texto: "Filter by network: see all accounts together or only one network's." },
            { n: 2, texto: "Connect network: opens the list of networks. You authorize inside the network itself, without giving us your password." },
            { n: 3, texto: "Each account shows whether it is publishing on its own, how many clips are queued and when the next one goes out. Click it to see the queue and times." },
          ],
        },
        {
          tipo: "tela",
          qual: "conectarRede",
          legenda: [
            { n: 1, texto: "Before connecting, the window shows what the network requires. Read it: it is the most common reason a connection fails." },
            { n: 2, texto: "Connect: you go to the network's page, authorize, and come back to Post Flow with the account already listed." },
          ],
        },
        {
          tipo: "lista",
          itens: [
            "TikTok: any account. To publish straight to the profile, first choose who can see it and the interactions (TikTok requires this).",
            "Instagram: must be a professional account (Creator or Business). Only clips up to 90 seconds.",
            "Facebook: Pages only, never a personal profile. Clips go out as Reels.",
            "YouTube: clips go out as Shorts (up to 3 minutes).",
            "Pinterest: choose which board the clips go to, otherwise they don't go out.",
          ],
        },
        {
          tipo: "tela",
          qual: "opcoesDePublicacao",
          legenda: [
            { n: 1, texto: "TikTok: who can see the video." },
            { n: 2, texto: "TikTok: comments, duet and stitch." },
            { n: 3, texto: "TikTok: mark whether the video is an ad. It is a legal requirement when it is." },
          ],
        },
        {
          tipo: "aviso",
          titulo: "How many accounts fit",
          texto:
            "Your plan sets how many accounts you can connect on each network: Starter 1, Pro 3 and Max 6 (TikTok follows the plan's own limit). If you need more on just one network, buy an extra account for R$ 9.90/month in Plan & usage.",
        },
      ],
    },
    {
      id: "estilo",
      marco: "estiloConfigurado",
      titulo: "Choose the clip style",
      resumo: "How clips are chosen, how long they last and how they look: captions, title and background.",
      ondeFica: "YouTube videos → Clip style tab",
      link: { texto: "Open YouTube videos", url: "/client/youtube" },
      blocos: [
        {
          tipo: "p",
          texto: "The fastest way is to pick a ready-made template and adjust what you want. The style applies to every video cut from now on.",
        },
        {
          tipo: "tela",
          qual: "modelos",
          legenda: [
            { n: 1, texto: "Apply to: only this channel, or all channels (your default)." },
            { n: 2, texto: "Ready-made templates: one click changes the whole style." },
            { n: 3, texto: "Save as template: keeps your style to reuse on another channel." },
          ],
        },
        {
          tipo: "tela",
          qual: "comoEscolherCortes",
          legenda: [
            { n: 1, texto: "Best parts: AI picks the most engaging moments. Whole video in parts: cuts everything in sequence. Choose amount: you say how many clips you want." },
            { n: 2, texto: "How many clips per video." },
            { n: 3, texto: "How long each clip lasts." },
            { n: 4, texto: "The description that goes with the post: written by AI, always the same, or none." },
          ],
        },
        {
          tipo: "tela",
          qual: "videoEmPartes",
          legenda: [
            { n: 1, texto: "In parts mode: split by the length of each part or by the number of parts." },
            { n: 2, texto: "The length is an average: the video is split into equal parts." },
            { n: 3, texto: "\"Part 1, Part 2...\" is always on in this mode, otherwise the parts arrive out of order." },
          ],
        },
        {
          tipo: "tela",
          qual: "estiloVisual",
          legenda: [
            { n: 1, texto: "Automatic uses the default style. Manual unlocks the rest of this screen." },
            { n: 2, texto: "Background behind the video and framing (drag the video inside the frame)." },
            { n: 3, texto: "Caption template." },
            { n: 4, texto: "Title at the start of the clip and its template." },
          ],
        },
      ],
    },
    {
      id: "canal",
      marco: "canalMonitorado",
      titulo: "Monitor a YouTube channel",
      resumo: "Post Flow starts watching the channel and cuts every new video that comes out.",
      ondeFica: "YouTube videos → Add channel",
      link: { texto: "Open YouTube videos", url: "/client/youtube" },
      blocos: [
        {
          tipo: "tela",
          qual: "canalYoutube",
          legenda: [
            { n: 1, texto: "Your channels are at the top. One-off uploads is where videos you sent by link or from your computer live." },
            { n: 2, texto: "The status line says whether the channel is fetching videos, which style it uses and which accounts it publishes to." },
            { n: 3, texto: "Three tabs: videos and clips, this channel's style, and monitoring and destinations." },
            { n: 4, texto: "Each video shows the stage it is in. You can pause it and send the clips to the queue." },
          ],
        },
        {
          tipo: "tela",
          qual: "monitoramento",
          legenda: [
            { n: 1, texto: "Turns fetching new videos on or off. When off, nothing is downloaded or charged." },
            { n: 2, texto: "Tick which accounts this channel's clips are published to. You can tick several networks at once." },
            { n: 3, texto: "Queue brake: only takes a new video when the queue is almost empty, so clips don't go out with stale topics." },
            { n: 4, texto: "Length limit: longer videos wait for you to send them, instead of spending credits on their own." },
          ],
        },
        {
          tipo: "aviso",
          titulo: "New videos only",
          texto:
            "When you add the channel, Post Flow asks whether you want to cut the latest video. After that it only takes what comes out from then on. To cut the latest video again, use the \"Cut latest video\" button.",
        },
      ],
    },
    {
      id: "horarios",
      titulo: "Choose when each clip goes out",
      resumo: "Each account has its own queue with times. You see right away when each clip will be published.",
      ondeFica: "Social networks → click an account",
      link: { texto: "Open Social networks", url: "/client/social" },
      blocos: [
        {
          tipo: "tela",
          qual: "reguaDoDia",
          legenda: [
            { n: 1, texto: "The timeline shows the next 24 hours and each clip's thumbnail at the time it goes out." },
            { n: 2, texto: "Use these times on all accounts: copies the setup to every network at once." },
          ],
        },
        {
          tipo: "tela",
          qual: "horarios",
          legenda: [
            { n: 1, texto: "Default spreads clips between 8am and 8pm on the hour. Or choose the times yourself." },
            { n: 2, texto: "How many clips per day on this account." },
            { n: 3, texto: "The publishing times." },
            { n: 4, texto: "Publish on its own: when off, clips stay in the queue waiting for you." },
          ],
        },
        {
          tipo: "tela",
          qual: "filaDePostagem",
          legenda: [
            { n: 1, texto: "Queue, Published and Didn't go out (the ones that failed, with the reason and a retry button)." },
            { n: 2, texto: "The time shown is the real time the clip goes out." },
            { n: 3, texto: "Post now, edit the caption or take the clip out of the queue." },
          ],
        },
        {
          tipo: "aviso",
          titulo: "Don't post too much",
          texto:
            "Networks like TikTok flag accounts that post a lot at once as spam. Post Flow respects \"how many per day\" and doesn't allow \"Post now\" more than 10 times in 24 hours.",
        },
      ],
    },
    {
      id: "lives",
      titulo: "Clip Twitch and Kick lives",
      resumo: "Post Flow records the live, finds the best moments with AI and delivers ready clips.",
      ondeFica: "Lives menu",
      link: { texto: "Open Lives", url: "/client/lives" },
      blocos: [
        {
          tipo: "p",
          texto: "Add the streamer's channel by link or by name. When they go live, recording starts on its own (or only when you ask).",
        },
        {
          tipo: "tela",
          qual: "lives",
          legenda: [
            { n: 1, texto: "What a credit is worth: 3 minutes of clipped live use 1 credit (1 hour = 20 credits), the same credits as YouTube videos." },
            { n: 2, texto: "Clip every time it's live: when on, every live of this channel becomes clips on its own." },
            { n: 3, texto: "Stop clipping: stops right away and stops spending credits." },
            { n: 4, texto: "Clip this moment: saw something good? One click cuts the last 2 and a half minutes (1 credit)." },
          ],
        },
        {
          tipo: "lista",
          itens: [
            "Your plan follows 1 (Starter), 2 (Pro) or 3 (Max) live channels, and clips 1 live at a time.",
            "If two lives start together, the first is clipped; when it ends, the other starts on its own.",
            "When the server is full, the card says so and recording starts as soon as a slot opens.",
            "Live clips stay available for 3 days. Download or publish them before that.",
          ],
        },
        {
          tipo: "aviso",
          titulo: "Live clips go to the Feed",
          texto: "Live clips don't enter the publishing queue on their own. They appear in the Clip feed, and from there you choose which accounts to publish to.",
        },
      ],
    },
    {
      id: "feed",
      titulo: "Watch and publish clips in the Feed",
      resumo: "All your clips, from videos and lives, one per screen, like a social network.",
      ondeFica: "Clip feed menu",
      link: { texto: "Open Clip feed", url: "/client/feed" },
      blocos: [
        {
          tipo: "tela",
          qual: "feed",
          legenda: [
            { n: 1, texto: "Scroll to move to the next clip. The first tap turns the sound on." },
            { n: 2, texto: "Like (or double-tap the video): liked clips go to the Liked tab." },
            { n: 3, texto: "Post: choose the accounts and the clip enters each one's queue at the next free time." },
          ],
        },
        {
          tipo: "p",
          texto: "Filters choose the source (YouTube or lives), the channel and the order. Clips you've already seen don't show up again.",
        },
      ],
    },
    {
      id: "acompanhar",
      titulo: "Follow everything and manage your credits",
      resumo: "Home shows the machine working; Plan & usage shows how much you are spending.",
      ondeFica: "Home menu and Plan & usage menu",
      link: { texto: "Open Plan & usage", url: "/client/billing" },
      blocos: [
        {
          tipo: "tela",
          qual: "linhaDeProducao",
          legenda: [
            { n: 1, texto: "Each stage shows the video or live going through it right now." },
            { n: 2, texto: "When a clip is ready, it goes to the queue of the account where it will be published." },
          ],
        },
        {
          tipo: "tela",
          qual: "planoEUso",
          legenda: [
            { n: 1, texto: "Summary, Buy, Plans and Invoices." },
            { n: 2, texto: "What each thing costs: 1 minute of video = 1 credit, 3 minutes of live = 1 credit, Clip this moment = 1 credit." },
            { n: 3, texto: "How much of each network you use and where to buy an extra account (R$ 9.90/month per account)." },
          ],
        },
        {
          tipo: "aviso",
          titulo: "If a post fails",
          texto:
            "It shows up under \"Didn't go out\" on the account, with the reason and a retry button. If the network asks you to reconnect, the account shows the warning and a Reconnect button.",
        },
      ],
    },
  ],
}

const es: Conteudo = {
  intro:
    "Configura en este orden y Post Flow empieza a trabajar solo: encuentra los vídeos nuevos, los recorta, les pone subtítulos y publica en tus redes en los horarios que elijas. Toma unos 15 minutos.",
  introSemPlano:
    "Todavía no tienes un plan activo, así que algunas pantallas aparecerán bloqueadas. Igual puedes leerlo todo: cuando actives el plan, sigue los pasos en orden.",
  fim: {
    titulo: "Listo. ¿Y ahora?",
    texto:
      "A partir de aquí el sistema trabaja solo. Sigues todo en Inicio y solo necesitas volver a la configuración para cambiar el estilo, los horarios, o agregar otro canal, live o red.",
  },
  passos: [
    {
      id: "redes",
      marco: "tiktokConectado",
      titulo: "Conectar tus redes sociales",
      resumo: "Son las cuentas donde se publicarán los clips. Empieza aquí: todo lo demás necesita saber a dónde enviarlos.",
      ondeFica: "Menú Redes sociales",
      link: { texto: "Abrir Redes sociales", url: "/client/social" },
      blocos: [
        {
          tipo: "p",
          texto:
            "Post Flow publica en TikTok, Instagram, Facebook, YouTube Shorts, Threads, LinkedIn, Pinterest y Bluesky. Cada cuenta conectada tiene su propia cola y sus propios horarios.",
        },
        {
          tipo: "tela",
          qual: "redesSociais",
          legenda: [
            { n: 1, texto: "Filtro por red: ve todas las cuentas juntas o solo las de una red." },
            { n: 2, texto: "Conectar red: abre la lista de redes. Autorizas dentro de la propia red, sin darnos tu contraseña." },
            { n: 3, texto: "Cada cuenta muestra si publica sola, cuántos clips hay en la cola y cuándo sale el próximo. Haz clic para ver la cola y los horarios." },
          ],
        },
        {
          tipo: "tela",
          qual: "conectarRede",
          legenda: [
            { n: 1, texto: "Antes de conectar, la ventana muestra lo que exige la red. Léelo: es la causa más común de que una conexión falle." },
            { n: 2, texto: "Conectar: vas a la página de la red, autorizas y vuelves a Post Flow con la cuenta ya en la lista." },
          ],
        },
        {
          tipo: "lista",
          itens: [
            "TikTok: cualquier cuenta. Para publicar directo en el perfil, elige antes quién puede verlo y las interacciones (lo exige TikTok).",
            "Instagram: debe ser una cuenta profesional (Creador o Empresa). Solo clips de hasta 90 segundos.",
            "Facebook: solo Páginas, nunca el perfil personal. Los clips salen como Reels.",
            "YouTube: los clips salen como Shorts (hasta 3 minutos).",
            "Pinterest: elige en qué tablero entran los clips, si no, no salen.",
          ],
        },
        {
          tipo: "tela",
          qual: "opcoesDePublicacao",
          legenda: [
            { n: 1, texto: "TikTok: quién puede ver el vídeo." },
            { n: 2, texto: "TikTok: comentarios, dúo y unión." },
            { n: 3, texto: "TikTok: marca si el vídeo es publicidad. Es obligación legal cuando lo es." },
          ],
        },
        {
          tipo: "aviso",
          titulo: "Cuántas cuentas caben",
          texto:
            "El plan define cuántas cuentas conectas en cada red: Starter 1, Pro 3 y Max 6 (en TikTok vale el límite del plano). Si necesitas más en una sola red, compra una cuenta extra por R$ 9,90/mes en Plan y uso.",
        },
      ],
    },
    {
      id: "estilo",
      marco: "estiloConfigurado",
      titulo: "Elegir el estilo de los clips",
      resumo: "Cómo se eligen los clips, cuánto duran y cómo se ven: subtítulos, título y fondo.",
      ondeFica: "Vídeos de YouTube → pestaña Estilo del clip",
      link: { texto: "Abrir Vídeos de YouTube", url: "/client/youtube" },
      blocos: [
        {
          tipo: "p",
          texto: "Lo más rápido es elegir una plantilla lista y ajustar lo que quieras. El estilo vale para todos los vídeos recortados de aquí en adelante.",
        },
        {
          tipo: "tela",
          qual: "modelos",
          legenda: [
            { n: 1, texto: "Aplicar en: solo este canal, o todos los canales (tu estándar)." },
            { n: 2, texto: "Plantillas listas: un clic y cambia todo el estilo." },
            { n: 3, texto: "Guardar como plantilla: guarda tu estilo para usarlo en otro canal." },
          ],
        },
        {
          tipo: "tela",
          qual: "comoEscolherCortes",
          legenda: [
            { n: 1, texto: "Mejores partes: la IA elige los momentos que más enganchan. Vídeo entero en partes: recorta todo, en secuencia. Elegir cantidad: tú dices cuántos clips quieres." },
            { n: 2, texto: "Cuántos clips por vídeo." },
            { n: 3, texto: "Cuánto dura cada clip." },
            { n: 4, texto: "La descripción que va con la publicación: escrita por la IA, siempre la misma, o ninguna." },
          ],
        },
        {
          tipo: "tela",
          qual: "videoEmPartes",
          legenda: [
            { n: 1, texto: "En modo partes: dividir por la duración de cada parte o por la cantidad." },
            { n: 2, texto: "La duración es un promedio: el vídeo se divide en partes iguales." },
            { n: 3, texto: "\"Parte 1, Parte 2...\" queda siempre activo en este modo, si no, las partes llegan sin orden." },
          ],
        },
        {
          tipo: "tela",
          qual: "estiloVisual",
          legenda: [
            { n: 1, texto: "Automático usa el estilo estándar. Manual habilita el resto de esta pantalla." },
            { n: 2, texto: "Fondo detrás del vídeo y encuadre (arrastra el vídeo dentro del marco)." },
            { n: 3, texto: "Plantilla del subtítulo." },
            { n: 4, texto: "Título al inicio del clip y su plantilla." },
          ],
        },
      ],
    },
    {
      id: "canal",
      marco: "canalMonitorado",
      titulo: "Monitorear un canal de YouTube",
      resumo: "Post Flow empieza a vigilar el canal y recorta cada vídeo nuevo que salga.",
      ondeFica: "Vídeos de YouTube → Agregar canal",
      link: { texto: "Abrir Vídeos de YouTube", url: "/client/youtube" },
      blocos: [
        {
          tipo: "tela",
          qual: "canalYoutube",
          legenda: [
            { n: 1, texto: "Tus canales están arriba. Envíos sueltos es donde quedan los vídeos que mandaste por enlace o desde tu computadora." },
            { n: 2, texto: "La línea de estado dice si el canal está trayendo vídeos, qué estilo usa y en qué cuentas publica." },
            { n: 3, texto: "Tres pestañas: vídeos y clips, el estilo de este canal, y monitoreo y destinos." },
            { n: 4, texto: "Cada vídeo muestra la etapa en la que está. Puedes pausarlo y mandar los clips a la cola." },
          ],
        },
        {
          tipo: "tela",
          qual: "monitoramento",
          legenda: [
            { n: 1, texto: "Activa o desactiva la búsqueda de vídeos nuevos. Desactivado, no se descarga ni se cobra nada." },
            { n: 2, texto: "Marca en qué cuentas se publican los clips de este canal. Puedes marcar varias redes a la vez." },
            { n: 3, texto: "Freno de cola: solo toma un vídeo nuevo cuando la cola está casi vacía, para que los clips no salgan con temas viejos." },
            { n: 4, texto: "Límite de duración: los vídeos más largos esperan a que los mandes, en lugar de gastar créditos solos." },
          ],
        },
        {
          tipo: "aviso",
          titulo: "Solo vídeos nuevos",
          texto:
            "Al agregar el canal, Post Flow pregunta si quieres recortar el vídeo más reciente. Después solo toma lo que salga de ahí en adelante. Para recortar el último vídeo otra vez, usa el botón \"Recortar último vídeo\".",
        },
      ],
    },
    {
      id: "horarios",
      titulo: "Elegir cuándo sale cada clip",
      resumo: "Cada cuenta tiene su propia cola con horarios. Ves al momento cuándo se publicará cada clip.",
      ondeFica: "Redes sociales → haz clic en una cuenta",
      link: { texto: "Abrir Redes sociales", url: "/client/social" },
      blocos: [
        {
          tipo: "tela",
          qual: "reguaDoDia",
          legenda: [
            { n: 1, texto: "La regla muestra las próximas 24 horas y la miniatura de cada clip en el horario en que sale." },
            { n: 2, texto: "Usar estos horarios en todas las cuentas: copia la configuración a todas las redes de una vez." },
          ],
        },
        {
          tipo: "tela",
          qual: "horarios",
          legenda: [
            { n: 1, texto: "Estándar reparte los clips entre las 8h y las 20h en horas en punto. O elige tú los horarios." },
            { n: 2, texto: "Cuántos clips por día en esta cuenta." },
            { n: 3, texto: "Los horarios de publicación." },
            { n: 4, texto: "Publicar solo: desactivado, los clips quedan en la cola esperándote." },
          ],
        },
        {
          tipo: "tela",
          qual: "filaDePostagem",
          legenda: [
            { n: 1, texto: "Cola, Publicados y No salieron (los que fallaron, con el motivo y el botón de reintentar)." },
            { n: 2, texto: "El horario mostrado es el horario real en que sale el clip." },
            { n: 3, texto: "Publicar ahora, editar la descripción o sacar el clip de la cola." },
          ],
        },
        {
          tipo: "aviso",
          titulo: "No publiques demasiado",
          texto:
            "Redes como TikTok marcan como spam la cuenta que publica mucho de golpe. Post Flow respeta \"cuántos por día\" y no deja usar \"Publicar ahora\" más de 10 veces en 24 horas.",
        },
      ],
    },
    {
      id: "lives",
      titulo: "Recortar lives de Twitch y Kick",
      resumo: "Post Flow graba el live, encuentra los mejores momentos con IA y entrega los clips listos.",
      ondeFica: "Menú Lives",
      link: { texto: "Abrir Lives", url: "/client/lives" },
      blocos: [
        {
          tipo: "p",
          texto: "Agrega el canal del streamer por enlace o por nombre. Cuando entre en vivo, la grabación empieza sola (o solo cuando tú lo pidas).",
        },
        {
          tipo: "tela",
          qual: "lives",
          legenda: [
            { n: 1, texto: "Cuánto vale el crédito: 3 minutos de live recortado gastan 1 crédito (1 hora = 20 créditos), los mismos créditos de los vídeos de YouTube." },
            { n: 2, texto: "Recortar siempre que esté en vivo: activado, cada live de este canal se vuelve clips solo." },
            { n: 3, texto: "Dejar de recortar: para al momento y deja de gastar créditos." },
            { n: 4, texto: "Recortar este momento: ¿viste algo bueno? Un clic recorta los últimos 2 minutos y medio (1 crédito)." },
          ],
        },
        {
          tipo: "lista",
          itens: [
            "Tu plan sigue 1 (Starter), 2 (Pro) o 3 (Max) canales de live, y recorta 1 live a la vez.",
            "Si dos lives empiezan juntos, se recorta el primero; cuando termina, el otro empieza solo.",
            "Cuando el servidor está lleno, la tarjeta lo avisa y la grabación empieza en cuanto se libera un lugar.",
            "Los clips de live quedan disponibles 3 días. Descárgalos o publícalos antes.",
          ],
        },
        {
          tipo: "aviso",
          titulo: "Los clips de live van al Feed",
          texto: "Los clips de live no entran solos en la cola de publicación. Aparecen en el Feed de clips, y desde ahí eliges en qué cuentas publicar.",
        },
      ],
    },
    {
      id: "feed",
      titulo: "Ver y publicar clips en el Feed",
      resumo: "Todos tus clips, de vídeos y de lives, uno por pantalla, como en una red social.",
      ondeFica: "Menú Feed de clips",
      link: { texto: "Abrir Feed de clips", url: "/client/feed" },
      blocos: [
        {
          tipo: "tela",
          qual: "feed",
          legenda: [
            { n: 1, texto: "Desliza para pasar de clip. El primer toque activa el sonido." },
            { n: 2, texto: "Me gusta (o dos toques en el vídeo): los que te gustan quedan en la pestaña Me gusta." },
            { n: 3, texto: "Publicar: elige las cuentas y el clip entra en la cola de cada una, en el próximo horario libre." },
          ],
        },
        {
          tipo: "p",
          texto: "Los filtros eligen el origen (YouTube o lives), el canal y el orden. Los clips que ya viste no vuelven a aparecer.",
        },
      ],
    },
    {
      id: "acompanhar",
      titulo: "Seguir todo y cuidar los créditos",
      resumo: "Inicio muestra la máquina trabajando; Plan y uso muestra cuánto estás gastando.",
      ondeFica: "Menú Inicio y menú Plan y uso",
      link: { texto: "Abrir Plan y uso", url: "/client/billing" },
      blocos: [
        {
          tipo: "tela",
          qual: "linhaDeProducao",
          legenda: [
            { n: 1, texto: "Cada etapa muestra el vídeo o el live que está pasando por ella ahora." },
            { n: 2, texto: "Cuando un clip está listo, va a la cola de la cuenta donde se publicará." },
          ],
        },
        {
          tipo: "tela",
          qual: "planoEUso",
          legenda: [
            { n: 1, texto: "Resumen, Comprar, Planes y Facturas." },
            { n: 2, texto: "Cuánto gasta cada cosa: 1 minuto de vídeo = 1 crédito, 3 minutos de live = 1 crédito, Recortar este momento = 1 crédito." },
            { n: 3, texto: "Cuánto usas de cada red y dónde comprar una cuenta extra (R$ 9,90/mes por cuenta)." },
          ],
        },
        {
          tipo: "aviso",
          titulo: "Si una publicación falla",
          texto:
            "Aparece en \"No salieron\", en la cuenta, con el motivo y el botón de reintentar. Si la red pide reconectar, la cuenta muestra el aviso y el botón Reconectar.",
        },
      ],
    },
  ],
}

export const TUTORIAL: Record<Idioma, Conteudo> = { pt, en, es }
