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
  /**
   * Passo que só existe quando o admin está oferecendo o túnel (o programa que
   * faz os downloads saírem pela internet do cliente). Escondido, ele é
   * retirado do roteiro — um passo que navega pra uma tela que não existe mais
   * deixaria o tour parado numa página em branco.
   */
  soComTunel?: boolean
  /** Texto alternativo pra quando o túnel está escondido. */
  textoSemTunel?: Record<Idioma, string>
}

// Roteiro reescrito em 12/10/2026 para o painel novo (Redes sociais, Vídeos
// do YouTube, Lives, Feed, Início em linha de produção). Mesma ordem do
// Tutorial: redes → estilo → canal → lives → feed → créditos.
export const PASSOS_DO_TOUR: PassoDoTour[] = [
  {
    pagina: "/client",
    titulo: { pt: "Bem-vindo ao Post Flow", en: "Welcome to Post Flow", es: "Bienvenido a Post Flow" },
    texto: {
      pt: "Vou te mostrar o painel em 2 minutos. Você conecta suas redes, escolhe o estilo e diz quais canais e lives acompanhar. Depois o sistema trabalha sozinho. Use “Próximo” para seguir, ou as setas do teclado.",
      en: "Let me show you around in 2 minutes. You connect your networks, choose the style and say which channels and lives to follow. Then the system works on its own. Use “Next” to continue, or the arrow keys.",
      es: "Te muestro el panel en 2 minutos. Conectas tus redes, eliges el estilo y dices qué canales y lives seguir. Después el sistema trabaja solo. Usa “Siguiente” para seguir, o las flechas del teclado.",
    },
  },
  {
    pagina: "/client",
    alvo: '[data-tour="linha-de-producao"]',
    titulo: { pt: "A máquina trabalhando", en: "The machine at work", es: "La máquina trabajando" },
    texto: {
      pt: "Esta é a linha de produção: cada vídeo do YouTube e cada live passa por download, transcrição, escolha dos cortes e montagem. Quando um corte fica pronto, ele vai para a fila da conta onde vai ser publicado.",
      en: "This is the production line: each YouTube video and each live goes through download, transcription, clip selection and editing. When a clip is ready, it goes to the queue of the account where it will be published.",
      es: "Esta es la línea de producción: cada vídeo de YouTube y cada live pasa por descarga, transcripción, elección de clips y montaje. Cuando un clip está listo, va a la cola de la cuenta donde se publicará.",
    },
  },
  {
    pagina: "/client",
    alvo: '[data-tour="menu-lateral"]',
    titulo: { pt: "O menu", en: "The menu", es: "El menú" },
    texto: {
      pt: "Vídeos do YouTube, Lives e Feed de cortes são de onde os cortes vêm. Redes sociais é para onde eles vão. Plano e uso mostra seus créditos. No celular, o menu abre no botão do canto.",
      en: "YouTube videos, Lives and Clip feed are where clips come from. Social networks is where they go. Plan & usage shows your credits. On a phone, the menu opens from the corner button.",
      es: "Vídeos de YouTube, Lives y Feed de clips son de donde vienen los clips. Redes sociales es adonde van. Plan y uso muestra tus créditos. En el móvil, el menú se abre con el botón de la esquina.",
    },
  },
  {
    pagina: "/client/social",
    alvo: '[data-tour="conectar-rede"]',
    titulo: { pt: "Passo 1: conecte suas redes", en: "Step 1: connect your networks", es: "Paso 1: conecta tus redes" },
    texto: {
      pt: "Comece por aqui: TikTok, Instagram, Facebook, YouTube Shorts e outras. Você autoriza dentro da própria rede. Cada conta ganha a própria fila e os próprios horários, que você vê clicando nela.",
      en: "Start here: TikTok, Instagram, Facebook, YouTube Shorts and more. You authorize inside the network itself. Each account gets its own queue and its own times, which you see by clicking it.",
      es: "Empieza aquí: TikTok, Instagram, Facebook, YouTube Shorts y más. Autorizas dentro de la propia red. Cada cuenta tiene su propia cola y sus propios horarios, que ves haciendo clic en ella.",
    },
  },
  {
    pagina: "/client/youtube",
    alvo: '[data-tour="canal-endereco"]',
    titulo: { pt: "Passo 2: o canal do YouTube", en: "Step 2: the YouTube channel", es: "Paso 2: el canal de YouTube" },
    texto: {
      pt: "Cole o link ou o @ do canal que você quer cortar e clique em Conectar canal. O Post Flow pergunta se quer cortar o vídeo mais recente e, daí pra frente, pega cada vídeo novo sozinho.",
      en: "Paste the link or @ of the channel you want to clip and click Connect channel. Post Flow asks whether to cut the latest video and, from then on, takes each new video on its own.",
      es: "Pega el enlace o el @ del canal que quieres recortar y haz clic en Conectar canal. Post Flow pregunta si quieres recortar el vídeo más reciente y, desde ahí, toma cada vídeo nuevo solo.",
    },
  },
  {
    pagina: "/client/youtube",
    alvo: '[data-tour="abas-do-canal"]',
    titulo: { pt: "Estilo e destinos do canal", en: "The channel's style and destinations", es: "Estilo y destinos del canal" },
    texto: {
      pt: "Em “Estilo do corte” você escolhe um modelo pronto ou ajusta legenda, título e quantos cortes saem. Em “Monitoramento e destinos” você marca em quais contas os cortes deste canal são publicados.",
      en: "In “Clip style” you pick a ready-made template or adjust captions, title and how many clips come out. In “Monitoring and destinations” you tick which accounts this channel's clips are published to.",
      es: "En “Estilo del clip” eliges una plantilla lista o ajustas subtítulos, título y cuántos clips salen. En “Monitoreo y destinos” marcas en qué cuentas se publican los clips de este canal.",
    },
  },
  {
    pagina: "/client/lives",
    alvo: '[data-tour="lives-credito"]',
    titulo: { pt: "Lives: quanto vale o crédito", en: "Lives: what a credit is worth", es: "Lives: cuánto vale el crédito" },
    texto: {
      pt: "As lives usam os mesmos créditos dos vídeos: 3 minutos de live clipada = 1 crédito (1 hora = 20 créditos). “Clipar este momento” custa 1 crédito por clique. Só gasta enquanto a live está sendo clipada pra você.",
      en: "Lives use the same credits as videos: 3 minutes of clipped live = 1 credit (1 hour = 20 credits). “Clip this moment” costs 1 credit per click. It only spends while the live is being clipped for you.",
      es: "Los lives usan los mismos créditos que los vídeos: 3 minutos de live recortado = 1 crédito (1 hora = 20 créditos). “Recortar este momento” cuesta 1 crédito por clic. Solo gasta mientras el live se recorta para ti.",
    },
  },
  {
    pagina: "/client/lives",
    alvo: '[data-tour="adicionar-live"]',
    titulo: { pt: "Adicione um streamer", en: "Add a streamer", es: "Agrega un streamer" },
    texto: {
      pt: "Cole o link do canal da Twitch ou da Kick. Com “Clipar sempre que estiver ao vivo” ligado, toda live vira cortes sozinha. Os cortes de live aparecem no Feed de cortes, de onde você escolhe onde publicar.",
      en: "Paste the Twitch or Kick channel link. With “Clip every time it's live” on, every live becomes clips on its own. Live clips appear in the Clip feed, where you choose where to publish.",
      es: "Pega el enlace del canal de Twitch o Kick. Con “Recortar siempre que esté en vivo” activado, cada live se vuelve clips solo. Los clips de live aparecen en el Feed de clips, desde donde eliges dónde publicar.",
    },
  },
  {
    pagina: "/client/feed",
    titulo: { pt: "O Feed de cortes", en: "The Clip feed", es: "El Feed de clips" },
    texto: {
      pt: "Todos os seus cortes, de vídeos e de lives, um por tela. Role para passar, toque para ligar o som, curta os melhores e use “Postar” para mandar um corte para a fila das suas contas.",
      en: "All your clips, from videos and lives, one per screen. Scroll to move on, tap to turn the sound on, like the best ones and use “Post” to send a clip to your accounts' queue.",
      es: "Todos tus clips, de vídeos y de lives, uno por pantalla. Desliza para pasar, toca para activar el sonido, dale me gusta a los mejores y usa “Publicar” para mandar un clip a la cola de tus cuentas.",
    },
  },
  {
    pagina: "/client/billing",
    alvo: '[data-tour="quanto-gasta"]',
    titulo: { pt: "Quanto cada coisa gasta", en: "What each thing costs", es: "Cuánto gasta cada cosa" },
    texto: {
      pt: "1 minuto de vídeo = 1 crédito, 3 minutos de live = 1 crédito. Seu plano renova a cota toda semana, e na aba Comprar você adiciona minutos avulsos ou liga o cartão para não parar quando a cota acaba.",
      en: "1 minute of video = 1 credit, 3 minutes of live = 1 credit. Your plan renews the quota every week, and in the Buy tab you add one-off minutes or turn on the card so nothing stops when the quota runs out.",
      es: "1 minuto de vídeo = 1 crédito, 3 minutos de live = 1 crédito. Tu plan renueva la cuota cada semana, y en la pestaña Comprar agregas minutos sueltos o activas la tarjeta para no parar cuando se acaba la cuota.",
    },
  },
  {
    pagina: "/client/billing",
    alvo: '[data-tour="uso-do-plano"]',
    titulo: { pt: "O que seu plano inclui", en: "What your plan includes", es: "Qué incluye tu plan" },
    texto: {
      pt: "Quantos canais, lives e contas em cada rede você pode ter, e quanto já está usando. Precisa de mais contas numa rede só? Compre uma conta extra por R$ 9,90/mês na aba Comprar.",
      en: "How many channels, lives and accounts per network you can have, and how much you already use. Need more accounts on just one network? Buy an extra account for R$ 9.90/month in the Buy tab.",
      es: "Cuántos canales, lives y cuentas en cada red puedes tener, y cuánto ya usas. ¿Necesitas más cuentas en una sola red? Compra una cuenta extra por R$ 9,90/mes en la pestaña Comprar.",
    },
  },
  {
    pagina: "/client",
    titulo: { pt: "É isso!", en: "That's it!", es: "¡Eso es todo!" },
    texto: {
      pt: "Com as redes conectadas e um canal ou live acompanhado, o sistema toca sozinho. O menu “Tutorial” explica cada tela com imagens, e você pode repetir este tour por lá quando quiser.",
      en: "With your networks connected and a channel or live followed, the system runs itself. The “Tutorial” menu explains every screen with pictures, and you can replay this tour from there any time.",
      es: "Con las redes conectadas y un canal o live seguido, el sistema funciona solo. El menú “Tutorial” explica cada pantalla con imágenes, y puedes repetir este tour desde allí cuando quieras.",
    },
  },
]
