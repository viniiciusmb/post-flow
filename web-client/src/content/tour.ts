/**
 * Os passos do tour guiado — o roteiro de quem está mostrando o painel.
 *
 * Cada passo diz em QUAL TELA ele acontece e QUAL CONTROLE ele acende. O
 * seletor é sempre um `data-tour="..."` colocado no elemento de verdade, nunca
 * uma classe do Tailwind: classe de estilo muda no primeiro ajuste visual e
 * levaria o tour a apontar pro nada sem ninguém perceber.
 *
 * A ordem é a ordem em que a configuração precisa acontecer: conta do TikTok →
 * estilo do corte → canal. É a mesma do checklist e da página Tutorial.
 */
import type { Idioma } from "@/i18n"

export type PassoDoTour = {
  /** Tela onde este passo acontece. Se não for a atual, o tour navega até ela. */
  pagina: string
  /** Seletor do controle que fica aceso. Sem alvo, a caixa vem centralizada. */
  alvo?: string
  /** Clica nisto antes de medir — usado pra abrir painel fechado. */
  abrir?: string
  titulo: Record<Idioma, string>
  texto: Record<Idioma, string>
}

export const PASSOS_DO_TOUR: PassoDoTour[] = [
  {
    pagina: "/client",
    titulo: {
      pt: "Bem-vindo ao Post Flow",
      en: "Welcome to Post Flow",
      es: "Bienvenido a Post Flow",
    },
    texto: {
      pt: "Vou te mostrar o painel em 1 minuto. São três coisas para configurar, e depois o sistema trabalha sozinho: ele vê vídeo novo no seu canal, corta e publica. Use “Próximo” para seguir — ou as setas do teclado.",
      en: "Let me show you around in about a minute. There are three things to set up, then the system works on its own: it spots a new video on your channel, cuts it and publishes. Use “Next” to continue — or the arrow keys.",
      es: "Te muestro el panel en 1 minuto. Son tres cosas para configurar y luego el sistema trabaja solo: ve un vídeo nuevo en tu canal, lo corta y lo publica. Usa “Siguiente” para seguir — o las flechas del teclado.",
    },
  },
  {
    pagina: "/client",
    alvo: '[data-tour="menu-lateral"]',
    titulo: { pt: "O menu", en: "The menu", es: "El menú" },
    texto: {
      pt: "Tudo fica aqui. “Canais” é onde você diz qual canal do YouTube monitorar, “Cortes” é onde configura como o corte fica, e “Publicação” é onde conecta o TikTok e define os horários. No celular, esse menu abre no botão do canto.",
      en: "Everything lives here. “Channels” is where you pick which YouTube channel to watch, “Clips” is where you set how the clip looks, and “Publishing” is where you connect TikTok and set the times. On a phone, this menu opens from the corner button.",
      es: "Todo está aquí. “Canales” es donde eliges qué canal de YouTube monitorear, “Clips” donde configuras cómo queda el clip, y “Publicación” donde conectas TikTok y defines los horarios. En el móvil, este menú se abre con el botón de la esquina.",
    },
  },
  {
    pagina: "/client",
    alvo: '[data-tour="checklist"]',
    titulo: { pt: "Seus três passos", en: "Your three steps", es: "Tus tres pasos" },
    texto: {
      pt: "Este quadro acompanha o que falta configurar e some sozinho quando você termina os três. O botão “Ir” de cada linha leva direto para a tela certa.",
      en: "This card tracks what's left to set up and disappears once you finish all three. The “Go” button on each row takes you straight to the right screen.",
      es: "Este cuadro sigue lo que falta configurar y desaparece solo cuando terminas los tres. El botón “Ir” de cada línea te lleva directo a la pantalla correcta.",
    },
  },
  {
    pagina: "/client/tiktok-account",
    alvo: '[data-tour="conectar-tiktok"]',
    titulo: {
      pt: "Passo 1: conecte o TikTok",
      en: "Step 1: connect TikTok",
      es: "Paso 1: conecta TikTok",
    },
    texto: {
      pt: "Clique aqui e o próprio TikTok abre para você autorizar. Sua senha é digitada lá dentro, nunca aqui. Comece por este passo: é a conta que vai receber os cortes, e o canal do YouTube aponta para ela depois.",
      en: "Click here and TikTok itself opens for you to authorize. Your password is typed there, never here. Start with this step: it's the account that receives the clips, and the YouTube channel points to it later.",
      es: "Haz clic aquí y el propio TikTok se abre para que autorices. Tu contraseña se escribe allí, nunca aquí. Empieza por este paso: es la cuenta que recibe los clips, y el canal de YouTube apunta a ella después.",
    },
  },
  {
    pagina: "/client/tiktok-account",
    titulo: {
      pt: "Depois de conectar",
      en: "After connecting",
      es: "Después de conectar",
    },
    texto: {
      pt: "Aqui nesta tela aparecem: as opções que o TikTok exige (quem pode ver, comentários, dueto), os horários de publicação, e as abas Fila, Postados e Erro. A aba Fila mostra a que horas cada corte vai sair — e sai naquela hora mesmo.",
      en: "Once connected, this screen shows: the options TikTok requires (who can view, comments, duet), the publishing times, and the Queue, Posted and Error tabs. The Queue tab shows what time each clip goes out — and it goes out at that exact time.",
      es: "Aquí aparecen: las opciones que TikTok exige (quién puede ver, comentarios, dúo), los horarios de publicación, y las pestañas Cola, Publicados y Error. La pestaña Cola muestra a qué hora sale cada clip — y sale a esa hora exacta.",
    },
  },
  {
    pagina: "/client/videos-clips",
    alvo: '[data-tour="abrir-config-cortes"]',
    titulo: {
      pt: "Passo 2: o estilo do corte",
      en: "Step 2: the clip style",
      es: "Paso 2: el estilo del clip",
    },
    texto: {
      pt: "Este botão abre tudo sobre o corte num painel só: quantos sair de cada vídeo, quanto tempo cada um tem e como ele aparece na tela. Vou abrir para você ver por dentro.",
      en: "This button opens everything about the clip in one panel: how many come out of each video, how long each one is, and how it looks on screen. Let me open it so you can see inside.",
      es: "Este botón abre todo sobre el clip en un solo panel: cuántos salen de cada vídeo, cuánto dura cada uno y cómo se ve en pantalla. Lo abro para que veas por dentro.",
    },
  },
  {
    pagina: "/client/videos-clips",
    abrir: '[data-tour="abrir-config-cortes"]',
    alvo: '[data-tour="como-funcionam-cortes"]',
    titulo: {
      pt: "Quantos cortes e de que tamanho",
      en: "How many clips and how long",
      es: "Cuántos clips y de qué tamaño",
    },
    texto: {
      pt: "“Melhores partes” deixa a IA escolher os trechos mais fortes. “Cortar o vídeo inteiro em partes” não descarta nada e vira uma série (Parte 1, Parte 2...). “Escolher quantidade” dá exatamente o número que você pedir. Logo abaixo você define a duração e a legenda da publicação.",
      en: "“Best parts” lets the AI pick the strongest moments. “Split the whole video into parts” discards nothing and turns it into a series (Part 1, Part 2...). “Pick a number” gives exactly the count you ask for. Below it you set the length and the post caption.",
      es: "“Mejores partes” deja que la IA elija los momentos más fuertes. “Cortar el vídeo entero en partes” no descarta nada y lo vuelve una serie (Parte 1, Parte 2...). “Elegir cantidad” da exactamente el número que pidas. Debajo defines la duración y el texto de la publicación.",
    },
  },
  {
    pagina: "/client/videos-clips",
    abrir: '[data-tour="abrir-config-cortes"]',
    alvo: '[data-tour="estilo-visual"]',
    titulo: {
      pt: "A aparência do corte",
      en: "How the clip looks",
      es: "La apariencia del clip",
    },
    texto: {
      pt: "Em “Automático” usamos o padrão e você não precisa decidir nada. Em “Manual” abrem o fundo, o enquadramento, o estilo da legenda, o título e a numeração — com uma prévia ao lado mostrando o resultado enquanto você escolhe.",
      en: "On “Automatic” we use the default and you decide nothing. On “Manual” you get background, framing, caption style, title and numbering — with a preview beside it showing the result as you choose.",
      es: "En “Automático” usamos el estándar y no decides nada. En “Manual” se abren el fondo, el encuadre, el estilo del subtítulo, el título y la numeración — con una vista previa al lado que muestra el resultado mientras eliges.",
    },
  },
  {
    pagina: "/client/youtube-channels",
    alvo: '[data-tour="canal-endereco"]',
    titulo: {
      pt: "Passo 3: o canal do YouTube",
      en: "Step 3: the YouTube channel",
      es: "Paso 3: el canal de YouTube",
    },
    texto: {
      pt: "Cole aqui o endereço do canal que você quer clipar. Funciona com o @arroba ou com o endereço completo da página do canal.",
      en: "Paste the address of the channel you want to clip. Works with the @handle or the full channel page URL.",
      es: "Pega aquí la dirección del canal que quieres clipar. Funciona con el @arroba o con la dirección completa de la página del canal.",
    },
  },
  {
    pagina: "/client/youtube-channels",
    alvo: '[data-tour="canal-adicionar"]',
    titulo: {
      pt: "E é só adicionar",
      en: "And just add it",
      es: "Y solo añádelo",
    },
    texto: {
      pt: "O canal entra PAUSADO de propósito, para você conferir tudo antes. No cartão dele você liga a chave “Baixar e cortar automaticamente”, escolhe em qual conta do TikTok publicar e, se quiser, uma pasta do Google Drive para receber os cortes prontos.",
      en: "The channel starts PAUSED on purpose, so you can check everything first. On its card you flip the “Download and cut automatically” switch, choose which TikTok account to publish to and, if you want, a Google Drive folder to receive the finished clips.",
      es: "El canal entra PAUSADO a propósito, para que compruebes todo antes. En su tarjeta activas el interruptor “Descargar y cortar automáticamente”, eliges en qué cuenta de TikTok publicar y, si quieres, una carpeta de Google Drive para recibir los clips listos.",
    },
  },
  {
    pagina: "/client/youtube-channels",
    alvo: '[data-tour="freio-de-fila"]',
    titulo: {
      pt: "O freio contra fila entupida",
      en: "The anti-pile-up brake",
      es: "El freno contra la cola atascada",
    },
    texto: {
      pt: "Já vem ligado. Com ele, o canal só busca um vídeo novo quando restar no máximo 1 corte esperando publicação. Sem ele, um canal que publica todo dia gera cortes mais rápido do que a fila posta — a fila só cresce e o corte que sai já é de assunto velho. Enquanto segura, nada fica acumulado: quando a fila baixa, ele pega o vídeo mais recente daquele momento.",
      en: "On by default. With it, the channel only fetches a new video when at most 1 clip is still waiting to be published. Without it, a daily channel produces clips faster than the queue posts them — the queue only grows and the clip that goes out is already old news. While it holds, nothing piles up: when the queue drops, it picks the most recent video at that moment.",
      es: "Ya viene activado. Con él, el canal solo busca un vídeo nuevo cuando queda como máximo 1 clip esperando publicación. Sin él, un canal que publica a diario genera clips más rápido de lo que la cola publica — la cola solo crece y el clip que sale ya es de tema viejo. Mientras frena, nada se acumula: cuando la cola baja, toma el vídeo más reciente de ese momento.",
    },
  },
  {
    pagina: "/client/billing",
    alvo: '[data-tour="creditos"]',
    titulo: {
      pt: "Seu crédito de processamento",
      en: "Your processing credit",
      es: "Tu crédito de procesamiento",
    },
    texto: {
      pt: "Cortar vídeo custa: baixar, transcrever e renderizar. Seu plano dá uma cota semanal em minutos de vídeo, e é ela que roda quando o download sai pela nossa internet. Do lado, a cota BÔNUS — extra, liberada quando o programa do seu computador está conectado.",
      en: "Cutting video costs money: downloading, transcribing and rendering. Your plan gives a weekly quota in minutes of video, and that's what runs when the download goes through our internet. Beside it, the BONUS quota — extra, unlocked when the program on your computer is connected.",
      es: "Cortar vídeo cuesta: descargar, transcribir y renderizar. Tu plan da una cuota semanal en minutos de vídeo, y es la que corre cuando la descarga sale por nuestra internet. Al lado, la cuota BONO — extra, liberada cuando el programa de tu ordenador está conectado.",
    },
  },
  {
    pagina: "/client/billing",
    alvo: '[data-tour="nao-ficar-sem-credito"]',
    titulo: {
      pt: "Não parar no meio do mês",
      en: "Not stopping mid-month",
      es: "No parar a mitad de mes",
    },
    texto: {
      pt: "Duas saídas quando a cota acaba. Com um cartão cadastrado, o processamento continua e você paga só o que passou do plano. Ou compre um pacote avulso, que não expira. Sem nenhum dos dois, os vídeos ficam esperando em vez de serem cortados.",
      en: "Two ways out when the quota runs out. With a card on file, processing continues and you only pay for what went over the plan. Or buy a one-off package, which never expires. With neither, videos wait instead of being cut.",
      es: "Dos salidas cuando se acaba la cuota. Con una tarjeta registrada, el procesamiento continúa y pagas solo lo que pasó del plan. O compra un paquete suelto, que no caduca. Sin ninguno de los dos, los vídeos esperan en vez de ser cortados.",
    },
  },
  {
    pagina: "/client/billing",
    alvo: '[data-tour="planos"]',
    titulo: { pt: "Trocar de plano", en: "Changing plan", es: "Cambiar de plan" },
    texto: {
      pt: "Aqui você compara os planos e troca quando quiser. O plano define a cota semanal, quantos canais e contas do TikTok você pode ter, e a prioridade na fila quando há vários vídeos processando ao mesmo tempo.",
      en: "Here you compare plans and switch whenever you like. The plan sets your weekly quota, how many channels and TikTok accounts you can have, and your priority in the queue when several videos are processing at once.",
      es: "Aquí comparas los planes y cambias cuando quieras. El plan define la cuota semanal, cuántos canales y cuentas de TikTok puedes tener, y la prioridad en la cola cuando hay varios vídeos procesándose a la vez.",
    },
  },
  {
    pagina: "/client/tunnel",
    alvo: '[data-tour="conexao-explicacao"]',
    titulo: {
      pt: "Sua conexão (opcional, mas vale a pena)",
      en: "Your connection (optional, but worth it)",
      es: "Tu conexión (opcional, pero vale la pena)",
    },
    texto: {
      pt: "O YouTube limita downloads vindos de servidores. Instalando um programinha no seu computador, os downloads dos SEUS vídeos passam a sair pela sua internet: falham bem menos e liberam a cota bônus, que é mais barata. É só baixar, abrir e colar o código de pareamento aqui.",
      en: "YouTube throttles downloads coming from servers. By installing a small program on your computer, YOUR downloads start going out through your own internet: they fail far less and unlock the bonus quota, which is cheaper. Just download it, open it and paste the pairing code here.",
      es: "YouTube limita las descargas que vienen de servidores. Instalando un programita en tu ordenador, las descargas de TUS vídeos pasan a salir por tu internet: fallan mucho menos y liberan la cuota bono, que es más barata. Solo descárgalo, ábrelo y pega aquí el código de emparejamiento.",
    },
  },
  {
    pagina: "/client",
    titulo: { pt: "É isso!", en: "That's it!", es: "¡Eso es todo!" },
    texto: {
      pt: "Feitos os três passos, o sistema toca sozinho: vídeo novo no canal vira cortes e sai no TikTok nos seus horários. “Plano e uso” mostra quanto crédito resta, e “Sua conexão” é o jeito de gastar menos. Se quiser rever qualquer detalhe, o menu “Tutorial” tem tudo explicado com imagens — e você pode repetir este tour por lá quando quiser.",
      en: "With those three done, the system runs itself: a new video on the channel becomes clips and goes out on TikTok at your times. “Plan and usage” shows how much credit is left, and “Your connection” is how you spend less. To revisit any detail, the “Tutorial” menu explains everything with pictures — and you can replay this tour from there any time.",
      es: "Con los tres pasos hechos, el sistema funciona solo: un vídeo nuevo en el canal se vuelve clips y sale en TikTok en tus horarios. “Plan y uso” muestra cuánto crédito queda, y “Tu conexión” es la forma de gastar menos. Para repasar cualquier detalle, el menú “Tutorial” lo explica todo con imágenes — y puedes repetir este tour desde allí cuando quieras.",
    },
  },
]
