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
  | "adicionarCanal"
  | "cartaoDoCanal"
  | "escopoDoEstilo"
  | "comoEscolherCortes"
  | "videoEmPartes"
  | "estiloVisual"
  | "conectarTiktok"
  | "opcoesDePublicacao"
  | "horarios"
  | "filaDePostagem"
  | "postados"
  | "acompanharCortes"

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

const pt: Conteudo = {
  intro:
    "Três configurações e o Post Flow começa a trabalhar sozinho. Faça na ordem abaixo: cada passo depende do anterior. Leva uns 10 minutos no total.",
  introSemPlano:
    "Você ainda não tem um plano ativo, então algumas telas vão aparecer bloqueadas. Pode ler tudo mesmo assim: quando ativar o plano, é só seguir os passos na ordem.",
  fim: {
    titulo: "Pronto. E agora?",
    texto:
      "Daqui pra frente o sistema trabalha sozinho: vê que saiu vídeo novo no canal, baixa, transcreve, corta, legenda e publica nos horários que você escolheu. Você só precisa voltar aqui se quiser mudar o estilo, trocar os horários ou adicionar outro canal.",
  },
  passos: [
    {
      id: "tiktok",
      marco: "tiktokConectado",
      titulo: "Conectar a conta do TikTok",
      resumo: "É a conta onde os cortes vão ser publicados. Sem ela, o resto não tem para onde ir.",
      ondeFica: "Menu Publicação",
      link: { texto: "Abrir Publicação", url: "/client/tiktok-account" },
      blocos: [
        {
          tipo: "p",
          texto:
            "Comece por aqui, e não pelo canal. A conta do TikTok é o destino dos cortes, e é ela que o canal do YouTube vai apontar depois — se você adicionar o canal antes, vai ter que voltar para amarrar os dois.",
        },
        {
          tipo: "tela",
          qual: "conectarTiktok",
          legenda: [
            {
              n: 1,
              texto:
                "Abre o próprio TikTok para você autorizar. A senha é digitada lá dentro, nunca aqui — o Post Flow recebe só uma autorização, que você pode revogar quando quiser pelo aplicativo do TikTok.",
            },
          ],
        },
        {
          tipo: "p",
          texto:
            "Você pode conectar mais de uma conta. Cada canal do YouTube publica em uma delas, e vídeos avulsos podem ir para várias ao mesmo tempo.",
        },
        {
          tipo: "p",
          texto:
            "Depois de conectar, o TikTok exige que você escolha manualmente as opções abaixo antes da primeira publicação. Não dá para o sistema escolher por você: é regra deles, e sem isso a publicação é recusada.",
        },
        {
          tipo: "tela",
          qual: "opcoesDePublicacao",
          legenda: [
            {
              n: 1,
              texto:
                "Quem pode ver o vídeo. Para crescer, é “Todo mundo”. Se a sua conta do TikTok for privada, o próprio TikTok só libera “Só eu”.",
            },
            {
              n: 2,
              texto:
                "Comentários, dueto e junção. É o mesmo que você marcaria ao postar pelo aplicativo — vale para todos os cortes dessa conta, e dá para mudar em um corte específico depois.",
            },
            {
              n: 3,
              texto:
                "Marque só se o vídeo for publicidade paga ou divulgação de marca. Marcar sem precisar coloca um selo de publicidade no seu vídeo.",
            },
          ],
        },
        {
          tipo: "p",
          texto:
            "Agora os horários. É aqui que você decide quando cada corte sai — e o que estiver marcado na tela é exatamente o que acontece.",
        },
        {
          tipo: "tela",
          qual: "horarios",
          legenda: [
            {
              n: 1,
              texto:
                "“Escolher horários”: você define a que horas publica. “Automático”: o sistema espalha as publicações sozinho ao longo do dia, entre 8h e 22h.",
            },
            {
              n: 2,
              texto:
                "O teto de publicações por dia nessa conta. Se sobrarem cortes, eles esperam o dia seguinte em vez de sair todos de uma vez.",
            },
            {
              n: 3,
              texto:
                "Os horários, no seu fuso. Cada corte ocupa um horário livre, na ordem em que ficou pronto — dois cortes nunca dividem o mesmo horário.",
            },
            {
              n: 4,
              texto:
                "Desligue esta chave para pausar tudo. Os cortes continuam sendo gerados e ficam esperando na fila, sem publicar nada.",
            },
          ],
        },
        {
          tipo: "aviso",
          titulo: "O horário mostrado é o horário real",
          texto:
            "Se a fila diz “hoje às 12:00”, o corte sai às 12:00. Ele não sai antes por haver espaço livre, e não se adianta porque outro falhou.",
        },
      ],
    },
    {
      id: "estilo",
      marco: "estiloConfigurado",
      titulo: "Configurar o estilo dos cortes",
      resumo: "Quantos cortes sair de cada vídeo, quanto dura cada um e como ele aparece na tela.",
      ondeFica: "Menu Cortes → botão “Configurar cortes”",
      link: { texto: "Abrir Cortes", url: "/client/videos-clips" },
      blocos: [
        {
          tipo: "p",
          texto:
            "Tudo sobre o corte fica num painel só. A primeira decisão é onde essa configuração vale.",
        },
        {
          tipo: "tela",
          qual: "escopoDoEstilo",
          legenda: [
            {
              n: 1,
              texto:
                "“Todos os canais” é o padrão e vale para tudo. Escolhendo um canal específico, você cria um estilo só dele — útil quando um canal é de humor e outro de entrevista, por exemplo.",
            },
            {
              n: 2,
              texto:
                "Aparece só quando o canal tem estilo próprio. Apaga a exceção e faz o canal voltar a seguir a configuração geral.",
            },
          ],
        },
        {
          tipo: "aviso",
          titulo: "Confira isto antes de mexer",
          texto:
            "É o erro mais comum: passar meia hora ajustando achando que está mexendo num canal, quando na verdade está mudando o padrão de todos.",
        },
        {
          tipo: "p",
          texto:
            "Em seguida, como os cortes são escolhidos. São três modos, e eles mudam o resto do painel.",
        },
        {
          tipo: "tela",
          qual: "comoEscolherCortes",
          legenda: [
            {
              n: 1,
              texto:
                "“Melhores partes”: a IA lê a transcrição e escolhe os trechos mais fortes, até o limite que você der. “Cortar o vídeo inteiro em partes”: nada é descartado, o vídeo vira uma série. “Escolher quantidade”: exatamente o número que você pedir.",
            },
            {
              n: 2,
              texto:
                "Nos modos com IA, é o teto de cortes por vídeo. Sem ele, um vídeo de uma hora pode virar mais de vinte cortes.",
            },
            {
              n: 3,
              texto:
                "A duração que a IA busca em cada corte. Curtos rendem mais no TikTok; longos preservam a resposta inteira em entrevista e podcast.",
            },
            {
              n: 4,
              texto:
                "A legenda que acompanha a publicação. “IA escreve” gera uma para cada corte, com hashtags; “Sempre a mesma” usa um texto fixo seu.",
            },
          ],
        },
        {
          tipo: "p",
          texto:
            "Se escolher “Cortar o vídeo inteiro em partes”, aparece uma decisão a mais: o que você quer fixar.",
        },
        {
          tipo: "tela",
          qual: "videoEmPartes",
          legenda: [
            {
              n: 1,
              texto:
                "“Pela duração”: você diz o tamanho de cada parte e o número sai da conta. “Pela quantidade”: você diz quantas partes quer e a duração sai da conta. Uma decide a outra.",
            },
            {
              n: 2,
              texto:
                "As partes saem todas do mesmo tamanho, sem sobrar uma parte curtinha no fim.",
            },
            {
              n: 3,
              texto:
                "A numeração liga sozinha e não pode ser desligada aqui. Sem “Parte 1, Parte 2”, quem assiste não sabe por onde começar.",
            },
          ],
        },
        {
          tipo: "p",
          texto:
            "Por último, a aparência. Em “Automático” o sistema usa o padrão — recorte central, legenda clássica. Em “Manual”, tudo abre.",
        },
        {
          tipo: "tela",
          qual: "estiloVisual",
          legenda: [
            {
              n: 1,
              texto:
                "“Manual” libera fundo, enquadramento, legenda, título e numeração. Em “Automático” nada disso aparece, e o corte sai no padrão.",
            },
            {
              n: 2,
              texto:
                "O que aparece atrás do vídeo quando ele não ocupa a tela toda: vídeo desfocado, cor lisa, uma imagem sua, a capa do vídeo ou um quadro dele.",
            },
            {
              n: 3,
              texto:
                "O estilo da legenda queimada no vídeo. A prévia ao lado mostra o resultado enquanto você escolhe — vale conferir antes de gerar um lote grande.",
            },
            {
              n: 4,
              texto:
                "Mostra o título nos primeiros segundos. A IA escreve um título diferente para cada corte, no idioma falado no vídeo.",
            },
          ],
        },
      ],
    },
    {
      id: "canal",
      marco: "canalMonitorado",
      titulo: "Monitorar um canal do YouTube",
      resumo: "É o que liga a máquina: daqui pra frente, todo vídeo novo do canal vira cortes sozinho.",
      ondeFica: "Menu Canais",
      link: { texto: "Abrir Canais", url: "/client/youtube-channels" },
      blocos: [
        {
          tipo: "p",
          texto:
            "Deixe este passo por último. Assim que o canal fica ativo, o primeiro vídeo já entra na fila usando o estilo e a conta que você acabou de configurar.",
        },
        {
          tipo: "tela",
          qual: "adicionarCanal",
          legenda: [
            {
              n: 1,
              texto:
                "Cole o endereço da página do canal. Funciona com o formato @arroba e com o endereço completo.",
            },
            {
              n: 2,
              texto:
                "O canal entra pausado, de propósito: você confere as configurações antes de qualquer download começar.",
            },
          ],
        },
        {
          tipo: "p",
          texto: "Cada canal adicionado vira um cartão com os controles dele.",
        },
        {
          tipo: "tela",
          qual: "cartaoDoCanal",
          legenda: [
            {
              n: 1,
              texto:
                "“Ativo” quer dizer que estamos de olho no canal. “Pausado” quer dizer que ninguém vai baixar nada dali.",
            },
            {
              n: 2,
              texto:
                "A chave principal. Ligada, todo vídeo novo publicado no canal é baixado e cortado sozinho. Desligada, o canal fica parado sem perder nenhuma configuração.",
            },
            {
              n: 3,
              texto:
                "O freio contra fila entupida, ligado por padrão. Com ele, o canal só busca um vídeo novo quando restar no máximo 1 corte esperando publicação. Sem ele, um canal que publica todo dia gera cortes mais rápido do que a fila consegue postar, a fila só cresce, e o corte que finalmente sai já é de assunto velho.",
            },
            {
              n: 4,
              texto:
                "Em qual conta do TikTok os cortes deste canal são publicados. Se você tem várias contas, cada canal aponta para uma.",
            },
            {
              n: 5,
              texto:
                "Opcional: uma pasta no seu Google Drive para receber os cortes prontos. “Enviar sozinho” manda cada corte assim que fica pronto; no modo manual, você escolhe um a um.",
            },
            {
              n: 6,
              texto:
                "Remove o canal do monitoramento. Os cortes já gerados continuam onde estão.",
            },
          ],
        },
        {
          tipo: "aviso",
          titulo: "Só vídeos novos",
          texto:
            "Ativar um canal não baixa o catálogo antigo dele. Vale do momento da ativação em diante — o sistema oferece processar o vídeo mais recente na hora do cadastro, se você quiser começar por ele.",
        },
        {
          tipo: "aviso",
          titulo: "Como o freio de fila funciona na prática",
          texto:
            "Enquanto a fila estiver cheia, o canal simplesmente não busca nada — nenhum vídeo fica acumulado esperando. Assim que a fila baixa para 1 ou 0, a próxima checagem (a cada 20 minutos) pega o vídeo mais recente do canal NAQUELE momento. É de propósito: o objetivo é publicar assunto fresco, não desengavetar o que ficou para trás.",
        },
      ],
    },
    {
      id: "acompanhar",
      titulo: "Acompanhar o que está acontecendo",
      resumo: "Onde ver o vídeo sendo processado, o corte pronto, o que já foi publicado e o que falhou.",
      ondeFica: "Menus Cortes e Publicação",
      blocos: [
        {
          tipo: "p",
          texto:
            "Do vídeo novo até a publicação, o caminho é: baixar → transcrever → escolher os trechos → cortar e legendar → entrar na fila → publicar. A tela de Cortes mostra as quatro primeiras etapas.",
        },
        {
          tipo: "tela",
          qual: "acompanharCortes",
          legenda: [
            {
              n: 1,
              texto:
                "“Em andamento” traz o que está sendo processado agora; “Prontos”, os cortes já gerados, com prévia e opção de baixar.",
            },
            {
              n: 2,
              texto:
                "Pausar de verdade interrompe o que estiver rodando. Ao retomar, o sistema continua de onde parou — não refaz o que já estava pronto.",
            },
          ],
        },
        {
          tipo: "p",
          texto:
            "Quando o corte fica pronto, ele entra na fila de publicação com um horário definido.",
        },
        {
          tipo: "tela",
          qual: "filaDePostagem",
          legenda: [
            {
              n: 1,
              texto:
                "Três abas: o que está esperando, o que já saiu e o que falhou. A aba “Erro” só aparece quando há algo lá.",
            },
            {
              n: 2,
              texto:
                "O horário em que aquele corte vai ser publicado. É o horário real, não uma estimativa.",
            },
            {
              n: 3,
              texto:
                "“Postar agora” fura a fila e publica na hora. “Editar legenda” muda o texto só daquele corte. “Não postar” tira da fila sem apagar o arquivo.",
            },
          ],
        },
        {
          tipo: "tela",
          qual: "postados",
          legenda: [],
        },
        {
          tipo: "aviso",
          titulo: "Se uma publicação falhar",
          texto:
            "Falha de internet não desiste do corte: o sistema tenta de novo sozinho, com intervalos crescentes, sem furar a ordem das partes. Só depois de várias tentativas o corte vai para a aba “Erro”, onde você pode reenviá-lo com um clique.",
        },
      ],
    },
  ],
}

const en: Conteudo = {
  intro:
    "Three settings and Post Flow starts working on its own. Do them in the order below — each step depends on the one before it. About 10 minutes in total.",
  introSemPlano:
    "You don't have an active plan yet, so some screens will appear locked. Feel free to read everything: once your plan is active, just follow the steps in order.",
  fim: {
    titulo: "That's it. What now?",
    texto:
      "From here the system works on its own: it notices a new video on the channel, downloads it, transcribes, cuts, captions and publishes at the times you chose. You only need to come back to change the style, change the times or add another channel.",
  },
  passos: [
    {
      id: "tiktok",
      marco: "tiktokConectado",
      titulo: "Connect your TikTok account",
      resumo: "This is where the clips get published. Without it, everything else has nowhere to go.",
      ondeFica: "Publishing menu",
      link: { texto: "Open Publishing", url: "/client/tiktok-account" },
      blocos: [
        {
          tipo: "p",
          texto:
            "Start here, not with the channel. The TikTok account is where clips land, and it's what the YouTube channel points to later — add the channel first and you'll have to come back to link the two.",
        },
        {
          tipo: "tela",
          qual: "conectarTiktok",
          legenda: [
            {
              n: 1,
              texto:
                "Opens TikTok itself so you can authorize. Your password is typed there, never here — Post Flow only receives an authorization, which you can revoke any time from the TikTok app.",
            },
          ],
        },
        {
          tipo: "p",
          texto:
            "You can connect more than one account. Each YouTube channel publishes to one of them, and standalone videos can go to several at once.",
        },
        {
          tipo: "p",
          texto:
            "After connecting, TikTok requires you to choose the options below manually before the first publish. The system can't choose for you: it's their rule, and without it the publish is rejected.",
        },
        {
          tipo: "tela",
          qual: "opcoesDePublicacao",
          legenda: [
            {
              n: 1,
              texto:
                "Who can see the video. To grow, pick “Everyone”. If your TikTok account is private, TikTok itself only allows “Only me”.",
            },
            {
              n: 2,
              texto:
                "Comments, duet and stitch. Same choices you'd make posting from the app — they apply to every clip on this account, and you can change them on a specific clip later.",
            },
            {
              n: 3,
              texto:
                "Only tick this if the video is paid promotion or brand content. Ticking it without needing to puts an ad label on your video.",
            },
          ],
        },
        {
          tipo: "p",
          texto:
            "Now the times. This is where you decide when each clip goes out — and what the screen shows is exactly what happens.",
        },
        {
          tipo: "tela",
          qual: "horarios",
          legenda: [
            {
              n: 1,
              texto:
                "“Pick times”: you set the publishing hours. “Automatic”: the system spreads posts through the day on its own, between 8am and 10pm.",
            },
            {
              n: 2,
              texto:
                "The daily cap for this account. Extra clips wait for the next day instead of going out all at once.",
            },
            {
              n: 3,
              texto:
                "The times, in your timezone. Each clip takes a free slot, in the order it finished — two clips never share the same time.",
            },
            {
              n: 4,
              texto:
                "Turn this off to pause everything. Clips keep being generated and wait in the queue, without publishing anything.",
            },
          ],
        },
        {
          tipo: "aviso",
          titulo: "The time shown is the real time",
          texto:
            "If the queue says “today at 12:00”, the clip goes out at 12:00. It doesn't go early because there's room, and it doesn't move up because another one failed.",
        },
      ],
    },
    {
      id: "estilo",
      marco: "estiloConfigurado",
      titulo: "Set up the clip style",
      resumo: "How many clips come out of each video, how long each one is, and how it looks on screen.",
      ondeFica: "Clips menu → “Configure clips” button",
      link: { texto: "Open Clips", url: "/client/videos-clips" },
      blocos: [
        {
          tipo: "p",
          texto: "Everything about the clip lives in one panel. The first decision is where this setting applies.",
        },
        {
          tipo: "tela",
          qual: "escopoDoEstilo",
          legenda: [
            {
              n: 1,
              texto:
                "“All channels” is the default and covers everything. Picking a specific channel creates a style just for it — useful when one channel is comedy and another is interviews.",
            },
            {
              n: 2,
              texto:
                "Only shows when the channel has its own style. It removes the exception and makes the channel follow the general setting again.",
            },
          ],
        },
        {
          tipo: "aviso",
          titulo: "Check this before changing anything",
          texto:
            "It's the most common mistake: spending half an hour tuning what you think is one channel, when you're actually changing the default for all of them.",
        },
        {
          tipo: "p",
          texto: "Next, how clips are chosen. Three modes, and they change the rest of the panel.",
        },
        {
          tipo: "tela",
          qual: "comoEscolherCortes",
          legenda: [
            {
              n: 1,
              texto:
                "“Best parts”: the AI reads the transcript and picks the strongest moments, up to your limit. “Split the whole video into parts”: nothing is discarded, the video becomes a series. “Pick a number”: exactly the count you ask for.",
            },
            {
              n: 2,
              texto:
                "In the AI modes, this is the cap per video. Without it, an hour-long video can turn into twenty-plus clips.",
            },
            {
              n: 3,
              texto:
                "The length the AI aims for. Short ones perform better on TikTok; long ones keep a whole answer intact in interviews and podcasts.",
            },
            {
              n: 4,
              texto:
                "The caption that goes with the post. “AI writes” generates one per clip, with hashtags; “Always the same” uses a fixed text of yours.",
            },
          ],
        },
        {
          tipo: "p",
          texto: "If you pick “Split the whole video into parts”, one more decision appears: what you want to fix.",
        },
        {
          tipo: "tela",
          qual: "videoEmPartes",
          legenda: [
            {
              n: 1,
              texto:
                "“By length”: you set the size of each part and the count follows. “By number of parts”: you set how many and the length follows. One decides the other.",
            },
            { n: 2, texto: "All parts come out the same size, with no tiny leftover part at the end." },
            {
              n: 3,
              texto:
                "Numbering turns on by itself and can't be turned off here. Without “Part 1, Part 2”, viewers don't know where to start.",
            },
          ],
        },
        {
          tipo: "p",
          texto:
            "Finally, the look. On “Automatic” the system uses the default — centered crop, classic captions. On “Manual”, everything opens up.",
        },
        {
          tipo: "tela",
          qual: "estiloVisual",
          legenda: [
            {
              n: 1,
              texto:
                "“Manual” unlocks background, framing, captions, title and numbering. On “Automatic” none of it shows, and the clip comes out with the default.",
            },
            {
              n: 2,
              texto:
                "What appears behind the video when it doesn't fill the screen: blurred video, a solid color, your own image, the video cover or a frame from it.",
            },
            {
              n: 3,
              texto:
                "The style of the burned-in captions. The preview beside it shows the result as you choose — worth checking before generating a big batch.",
            },
            {
              n: 4,
              texto:
                "Shows the title in the first seconds. The AI writes a different title for each clip, in the language spoken in the video.",
            },
          ],
        },
      ],
    },
    {
      id: "canal",
      marco: "canalMonitorado",
      titulo: "Monitor a YouTube channel",
      resumo: "This starts the machine: from now on, every new video on the channel becomes clips by itself.",
      ondeFica: "Channels menu",
      link: { texto: "Open Channels", url: "/client/youtube-channels" },
      blocos: [
        {
          tipo: "p",
          texto:
            "Leave this step for last. As soon as the channel goes active, the first video enters the queue using the style and account you just set up.",
        },
        {
          tipo: "tela",
          qual: "adicionarCanal",
          legenda: [
            { n: 1, texto: "Paste the channel page address. Works with the @handle format and the full URL." },
            {
              n: 2,
              texto:
                "The channel starts paused on purpose: you check the settings before any download begins.",
            },
          ],
        },
        { tipo: "p", texto: "Each channel you add becomes a card with its own controls." },
        {
          tipo: "tela",
          qual: "cartaoDoCanal",
          legenda: [
            { n: 1, texto: "“Active” means we're watching the channel. “Paused” means nothing will be downloaded from it." },
            {
              n: 2,
              texto:
                "The main switch. On, every new video published on the channel is downloaded and cut automatically. Off, the channel sits still without losing any settings.",
            },
            {
              n: 3,
              texto:
                "The anti-pile-up brake, on by default. With it, the channel only fetches a new video when at most 1 clip is still waiting to be published. Without it, a channel that publishes daily produces clips faster than the queue can post them, the queue only grows, and the clip that finally goes out is already old news.",
            },
            {
              n: 4,
              texto:
                "Which TikTok account this channel's clips get published to. If you have several accounts, each channel points to one.",
            },
            {
              n: 5,
              texto:
                "Optional: a folder in your Google Drive to receive finished clips. “Send automatically” uploads each clip as soon as it's ready; in manual mode you pick them one by one.",
            },
            { n: 6, texto: "Removes the channel from monitoring. Clips already generated stay where they are." },
          ],
        },
        {
          tipo: "aviso",
          titulo: "New videos only",
          texto:
            "Activating a channel does not download its back catalogue. It applies from activation onwards — the system offers to process the most recent video right when you add it, if you want to start with that one.",
        },
        {
          tipo: "aviso",
          titulo: "How the queue brake actually works",
          texto:
            "While the queue is full the channel simply fetches nothing — no videos pile up waiting. As soon as the queue drops to 1 or 0, the next check (every 20 minutes) picks up the channel's most recent video AT THAT MOMENT. That's deliberate: the goal is to publish fresh material, not to dig out what was left behind.",
        },
      ],
    },
    {
      id: "acompanhar",
      titulo: "Follow what's happening",
      resumo: "Where to see the video being processed, the finished clip, what got published and what failed.",
      ondeFica: "Clips and Publishing menus",
      blocos: [
        {
          tipo: "p",
          texto:
            "From new video to publish, the path is: download → transcribe → pick the moments → cut and caption → join the queue → publish. The Clips screen shows the first four stages.",
        },
        {
          tipo: "tela",
          qual: "acompanharCortes",
          legenda: [
            {
              n: 1,
              texto:
                "“In progress” shows what's being processed now; “Ready”, the clips already generated, with preview and download.",
            },
            {
              n: 2,
              texto:
                "Pausing really stops whatever is running. When you resume, the system continues where it left off — it doesn't redo what was already done.",
            },
          ],
        },
        { tipo: "p", texto: "When a clip is ready, it joins the publishing queue with a set time." },
        {
          tipo: "tela",
          qual: "filaDePostagem",
          legenda: [
            {
              n: 1,
              texto:
                "Three tabs: what's waiting, what went out and what failed. The “Error” tab only appears when there's something in it.",
            },
            { n: 2, texto: "The time that clip will be published. It's the real time, not an estimate." },
            {
              n: 3,
              texto:
                "“Post now” skips the queue and publishes immediately. “Edit caption” changes the text of that clip only. “Don't post” removes it from the queue without deleting the file.",
            },
          ],
        },
        { tipo: "tela", qual: "postados", legenda: [] },
        {
          tipo: "aviso",
          titulo: "If a publish fails",
          texto:
            "A network glitch doesn't give up on the clip: the system retries on its own, with growing gaps, without breaking the order of the parts. Only after several attempts does the clip move to the “Error” tab, where you can resend it with one click.",
        },
      ],
    },
  ],
}

const es: Conteudo = {
  intro:
    "Tres ajustes y Post Flow empieza a trabajar solo. Hazlos en el orden de abajo: cada paso depende del anterior. Unos 10 minutos en total.",
  introSemPlano:
    "Todavía no tienes un plan activo, así que algunas pantallas aparecerán bloqueadas. Puedes leerlo todo igual: cuando actives el plan, solo sigue los pasos en orden.",
  fim: {
    titulo: "Listo. ¿Y ahora?",
    texto:
      "De aquí en adelante el sistema trabaja solo: ve que salió un vídeo nuevo en el canal, lo descarga, transcribe, corta, subtitula y publica en los horarios que elegiste. Solo necesitas volver si quieres cambiar el estilo, cambiar los horarios o añadir otro canal.",
  },
  passos: [
    {
      id: "tiktok",
      marco: "tiktokConectado",
      titulo: "Conectar la cuenta de TikTok",
      resumo: "Es la cuenta donde se publicarán los clips. Sin ella, el resto no tiene adónde ir.",
      ondeFica: "Menú Publicación",
      link: { texto: "Abrir Publicación", url: "/client/tiktok-account" },
      blocos: [
        {
          tipo: "p",
          texto:
            "Empieza por aquí, no por el canal. La cuenta de TikTok es el destino de los clips, y es a la que apunta el canal de YouTube después — si añades el canal antes, tendrás que volver para enlazar los dos.",
        },
        {
          tipo: "tela",
          qual: "conectarTiktok",
          legenda: [
            {
              n: 1,
              texto:
                "Abre el propio TikTok para que autorices. La contraseña se escribe allí, nunca aquí — Post Flow recibe solo una autorización, que puedes revocar cuando quieras desde la app de TikTok.",
            },
          ],
        },
        {
          tipo: "p",
          texto:
            "Puedes conectar más de una cuenta. Cada canal de YouTube publica en una de ellas, y los vídeos sueltos pueden ir a varias a la vez.",
        },
        {
          tipo: "p",
          texto:
            "Tras conectar, TikTok exige que elijas manualmente las opciones de abajo antes de la primera publicación. El sistema no puede elegir por ti: es regla suya, y sin eso la publicación se rechaza.",
        },
        {
          tipo: "tela",
          qual: "opcoesDePublicacao",
          legenda: [
            {
              n: 1,
              texto:
                "Quién puede ver el vídeo. Para crecer, elige “Todo el mundo”. Si tu cuenta de TikTok es privada, el propio TikTok solo permite “Solo yo”.",
            },
            {
              n: 2,
              texto:
                "Comentarios, dúo y unión. Es lo mismo que marcarías al publicar desde la app — vale para todos los clips de esa cuenta, y puedes cambiarlo en un clip concreto después.",
            },
            {
              n: 3,
              texto:
                "Marca solo si el vídeo es publicidad pagada o contenido de marca. Marcarlo sin necesidad pone un sello de anuncio en tu vídeo.",
            },
          ],
        },
        {
          tipo: "p",
          texto:
            "Ahora los horarios. Aquí decides cuándo sale cada clip — y lo que muestra la pantalla es exactamente lo que ocurre.",
        },
        {
          tipo: "tela",
          qual: "horarios",
          legenda: [
            {
              n: 1,
              texto:
                "“Elegir horarios”: tú defines a qué hora se publica. “Automático”: el sistema reparte las publicaciones solo a lo largo del día, entre las 8h y las 22h.",
            },
            {
              n: 2,
              texto:
                "El tope de publicaciones por día en esa cuenta. Si sobran clips, esperan al día siguiente en vez de salir todos de golpe.",
            },
            {
              n: 3,
              texto:
                "Los horarios, en tu zona horaria. Cada clip ocupa un horario libre, en el orden en que quedó listo — dos clips nunca comparten el mismo horario.",
            },
            {
              n: 4,
              texto:
                "Apaga este interruptor para pausar todo. Los clips se siguen generando y esperan en la cola, sin publicar nada.",
            },
          ],
        },
        {
          tipo: "aviso",
          titulo: "El horario mostrado es el horario real",
          texto:
            "Si la cola dice “hoy a las 12:00”, el clip sale a las 12:00. No sale antes por haber hueco libre, y no se adelanta porque otro falló.",
        },
      ],
    },
    {
      id: "estilo",
      marco: "estiloConfigurado",
      titulo: "Configurar el estilo de los clips",
      resumo: "Cuántos clips salen de cada vídeo, cuánto dura cada uno y cómo se ve en pantalla.",
      ondeFica: "Menú Clips → botón “Configurar clips”",
      link: { texto: "Abrir Clips", url: "/client/videos-clips" },
      blocos: [
        { tipo: "p", texto: "Todo sobre el clip está en un solo panel. La primera decisión es dónde vale esta configuración." },
        {
          tipo: "tela",
          qual: "escopoDoEstilo",
          legenda: [
            {
              n: 1,
              texto:
                "“Todos los canales” es lo predeterminado y vale para todo. Al elegir un canal concreto creas un estilo solo suyo — útil cuando un canal es de humor y otro de entrevistas.",
            },
            {
              n: 2,
              texto:
                "Aparece solo cuando el canal tiene estilo propio. Borra la excepción y hace que el canal vuelva a seguir la configuración general.",
            },
          ],
        },
        {
          tipo: "aviso",
          titulo: "Comprueba esto antes de tocar nada",
          texto:
            "Es el error más común: pasar media hora ajustando creyendo que tocas un canal, cuando en realidad cambias el estándar de todos.",
        },
        { tipo: "p", texto: "Después, cómo se eligen los clips. Son tres modos, y cambian el resto del panel." },
        {
          tipo: "tela",
          qual: "comoEscolherCortes",
          legenda: [
            {
              n: 1,
              texto:
                "“Mejores partes”: la IA lee la transcripción y elige los momentos más fuertes, hasta tu límite. “Cortar el vídeo entero en partes”: no se descarta nada, el vídeo se vuelve una serie. “Elegir cantidad”: exactamente el número que pidas.",
            },
            {
              n: 2,
              texto:
                "En los modos con IA, es el tope de clips por vídeo. Sin él, un vídeo de una hora puede volverse más de veinte clips.",
            },
            {
              n: 3,
              texto:
                "La duración que busca la IA en cada clip. Los cortos rinden más en TikTok; los largos preservan la respuesta entera en entrevistas y pódcast.",
            },
            {
              n: 4,
              texto:
                "El texto que acompaña a la publicación. “La IA escribe” genera uno para cada clip, con hashtags; “Siempre el mismo” usa un texto fijo tuyo.",
            },
          ],
        },
        { tipo: "p", texto: "Si eliges “Cortar el vídeo entero en partes”, aparece una decisión más: qué quieres fijar." },
        {
          tipo: "tela",
          qual: "videoEmPartes",
          legenda: [
            {
              n: 1,
              texto:
                "“Por duración”: tú dices el tamaño de cada parte y la cantidad sale de la cuenta. “Por cantidad de partes”: tú dices cuántas quieres y la duración sale de la cuenta. Una decide la otra.",
            },
            { n: 2, texto: "Las partes salen todas del mismo tamaño, sin que sobre una parte cortita al final." },
            {
              n: 3,
              texto:
                "La numeración se activa sola y no se puede desactivar aquí. Sin “Parte 1, Parte 2”, quien mira no sabe por dónde empezar.",
            },
          ],
        },
        {
          tipo: "p",
          texto:
            "Por último, la apariencia. En “Automático” el sistema usa el estándar — recorte central, subtítulo clásico. En “Manual” se abre todo.",
        },
        {
          tipo: "tela",
          qual: "estiloVisual",
          legenda: [
            {
              n: 1,
              texto:
                "“Manual” libera fondo, encuadre, subtítulo, título y numeración. En “Automático” nada de eso aparece, y el clip sale con el estándar.",
            },
            {
              n: 2,
              texto:
                "Lo que aparece detrás del vídeo cuando no ocupa toda la pantalla: vídeo desenfocado, color liso, una imagen tuya, la portada del vídeo o un fotograma.",
            },
            {
              n: 3,
              texto:
                "El estilo del subtítulo quemado en el vídeo. La vista previa al lado muestra el resultado mientras eliges — conviene comprobarlo antes de generar un lote grande.",
            },
            {
              n: 4,
              texto:
                "Muestra el título en los primeros segundos. La IA escribe un título distinto para cada clip, en el idioma hablado en el vídeo.",
            },
          ],
        },
      ],
    },
    {
      id: "canal",
      marco: "canalMonitorado",
      titulo: "Monitorear un canal de YouTube",
      resumo: "Es lo que enciende la máquina: de aquí en adelante, cada vídeo nuevo del canal se vuelve clips solo.",
      ondeFica: "Menú Canales",
      link: { texto: "Abrir Canales", url: "/client/youtube-channels" },
      blocos: [
        {
          tipo: "p",
          texto:
            "Deja este paso para el final. En cuanto el canal se activa, el primer vídeo entra en la cola usando el estilo y la cuenta que acabas de configurar.",
        },
        {
          tipo: "tela",
          qual: "adicionarCanal",
          legenda: [
            { n: 1, texto: "Pega la dirección de la página del canal. Funciona con el formato @arroba y con la dirección completa." },
            { n: 2, texto: "El canal entra pausado, a propósito: compruebas los ajustes antes de que empiece ninguna descarga." },
          ],
        },
        { tipo: "p", texto: "Cada canal añadido se vuelve una tarjeta con sus controles." },
        {
          tipo: "tela",
          qual: "cartaoDoCanal",
          legenda: [
            { n: 1, texto: "“Activo” significa que estamos vigilando el canal. “Pausado” significa que no se descargará nada de allí." },
            {
              n: 2,
              texto:
                "El interruptor principal. Encendido, cada vídeo nuevo publicado en el canal se descarga y se corta solo. Apagado, el canal se queda quieto sin perder ninguna configuración.",
            },
            {
              n: 3,
              texto:
                "El freno contra la cola atascada, activado por defecto. Con él, el canal solo busca un vídeo nuevo cuando queda como máximo 1 clip esperando publicación. Sin él, un canal que publica a diario genera clips más rápido de lo que la cola logra publicar, la cola solo crece, y el clip que por fin sale ya es de tema viejo.",
            },
            {
              n: 4,
              texto:
                "En qué cuenta de TikTok se publican los clips de este canal. Si tienes varias cuentas, cada canal apunta a una.",
            },
            {
              n: 5,
              texto:
                "Opcional: una carpeta en tu Google Drive para recibir los clips listos. “Enviar solo” sube cada clip en cuanto está listo; en modo manual los eliges uno a uno.",
            },
            { n: 6, texto: "Quita el canal del monitoreo. Los clips ya generados se quedan donde están." },
          ],
        },
        {
          tipo: "aviso",
          titulo: "Solo vídeos nuevos",
          texto:
            "Activar un canal no descarga su catálogo antiguo. Vale desde el momento de la activación en adelante — el sistema ofrece procesar el vídeo más reciente al darlo de alta, si quieres empezar por ese.",
        },
        {
          tipo: "aviso",
          titulo: "Cómo funciona el freno de cola en la práctica",
          texto:
            "Mientras la cola esté llena el canal simplemente no busca nada — ningún vídeo se acumula esperando. En cuanto la cola baja a 1 o 0, la siguiente comprobación (cada 20 minutos) toma el vídeo más reciente del canal EN ESE MOMENTO. Es a propósito: el objetivo es publicar tema fresco, no desenterrar lo que quedó atrás.",
        },
      ],
    },
    {
      id: "acompanhar",
      titulo: "Seguir lo que está pasando",
      resumo: "Dónde ver el vídeo procesándose, el clip listo, lo que ya se publicó y lo que falló.",
      ondeFica: "Menús Clips y Publicación",
      blocos: [
        {
          tipo: "p",
          texto:
            "Del vídeo nuevo hasta la publicación, el camino es: descargar → transcribir → elegir los momentos → cortar y subtitular → entrar en la cola → publicar. La pantalla de Clips muestra las cuatro primeras etapas.",
        },
        {
          tipo: "tela",
          qual: "acompanharCortes",
          legenda: [
            {
              n: 1,
              texto:
                "“En curso” trae lo que se está procesando ahora; “Listos”, los clips ya generados, con vista previa y opción de descargar.",
            },
            {
              n: 2,
              texto:
                "Pausar de verdad interrumpe lo que esté corriendo. Al retomar, el sistema sigue desde donde paró — no rehace lo que ya estaba listo.",
            },
          ],
        },
        { tipo: "p", texto: "Cuando el clip está listo, entra en la cola de publicación con un horario definido." },
        {
          tipo: "tela",
          qual: "filaDePostagem",
          legenda: [
            {
              n: 1,
              texto:
                "Tres pestañas: lo que espera, lo que ya salió y lo que falló. La pestaña “Error” solo aparece cuando hay algo allí.",
            },
            { n: 2, texto: "El horario en que ese clip se publicará. Es el horario real, no una estimación." },
            {
              n: 3,
              texto:
                "“Publicar ahora” se salta la cola y publica al momento. “Editar texto” cambia el texto solo de ese clip. “No publicar” lo saca de la cola sin borrar el archivo.",
            },
          ],
        },
        { tipo: "tela", qual: "postados", legenda: [] },
        {
          tipo: "aviso",
          titulo: "Si una publicación falla",
          texto:
            "Un fallo de red no descarta el clip: el sistema lo intenta de nuevo solo, con intervalos crecientes, sin romper el orden de las partes. Solo tras varios intentos el clip va a la pestaña “Error”, donde puedes reenviarlo con un clic.",
        },
      ],
    },
  ],
}

export const TUTORIAL: Record<Idioma, Conteudo> = { pt, en, es }
