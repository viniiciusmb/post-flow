'use strict';

// English. Keys mirror pt.js; a missing one falls back to Portuguese.

const { CONTACT } = require('../config/constants');
const legal = require('./legal-en');

module.exports = {
  nav: {
    comoFunciona: 'How it works',
    recursos: 'Features',
    planos: 'Pricing',
    duvidas: 'FAQ',
    entrar: 'Sign in',
    criarConta: 'Create account',
    meuPainel: 'My dashboard',
    inicio: 'Post Flow, home page',
    idioma: 'Language',
  },

  rodape: {
    descricao: 'Automatic clips from your YouTube channel, published to your TikTok.',
    produto: 'Product',
    empresa: 'Company',
    legal: 'Legal',
    contato: 'Contact',
    termos: 'Terms of Use',
    privacidade: 'Privacy Policy',
    direitos: 'All rights reserved.',
    naoAfiliado:
      'Post Flow is not affiliated with YouTube, TikTok or Google. All trademarks belong to their owners.',
  },

  landing: {
    tituloPagina: 'Automatic YouTube-to-TikTok clips',
    metaDescricao:
      'Post Flow watches your YouTube channel, cuts the best moments with AI and publishes them to your TikTok automatically.',

    selo: '100% automatic',
    h1a: 'New video on the monitored channel.',
    h1b: 'The rest happens',
    h1c: 'on its own',
    lead:
      'You publish on YouTube and Post Flow notices right away. It downloads the video, the AI reads the whole transcript and picks the best moments, renders them vertically with burned-in captions, and publishes to your TikTok.',
    leadForte: 'No editor to open, no TikTok to open.',
    verComoFunciona: 'See how it works',
    notaHero: 'Built for people who already make their own content and want to stop cutting clips by hand.',
    provaOlho: 'Automatic growth',
    provaTitulo: "See the numbers grow every day, without you doing a thing",
    provaTexto:
      'Simulation of an account using Post Flow since its very first clip. Followers, videos and views climb on their own, straight from the automatic work.',
    provaNome: 'Auto Clips',
    provaVivo: 'growing right now',
    provaSeguidores: 'followers',
    provaVideos: 'videos',
    provaViews: 'views',
    altComputador:
      'Post Flow\'s queue of ready clips on a computer, with a preview of each finished clip',
    altCelular: 'The same queue of ready clips open on a phone',
    tutorialVideoAlt:
      'Tutorial video with real platform screenshots: step 1, add the YouTube channel; step 2, configure the clip style; step 3, connect the TikTok account.',
    telasOlho: 'Where you use it',
    telasTitulo: 'Works fully on computer and phone',
    telasTexto:
      'The panel works fully on both — check your clips from your laptop at the office or from your phone on the go.',

    whatsOlho: 'Community',
    whatsTitulo: 'There\'s a WhatsApp group just for Post Flow users',
    whatsTexto:
      'Ask questions, swap ideas with other creators, and be the first to know about new features — unlocked automatically for subscribers, no extra step needed.',

    fluxoVideoAlt:
      'Video showing the automatic flow: a new video published on YouTube, Post Flow cutting it into vertical clips, and automatic posting to TikTok.',
    fluxo: [
      {
        h: 'New video on the monitored channel',
        p: 'Post Flow notices right away, no need to tell it.',
      },
      {
        h: 'Post Flow does the work',
        p: 'Detects, transcribes, picks the segments, cuts vertically and captions. Nobody clicks anything.',
      },
      {
        h: 'It goes out on your TikTok',
        p: 'Published straight to your profile, at the time you chose. You just watch.',
      },
    ],

    comoFuncionaTitulo: 'Four steps. You take part in the first one.',
    passos: [
      {
        h: 'Connect the channel',
        p: 'Paste your YouTube channel address. From then on Post Flow notices on its own when you publish a new video. You can also upload a file from your computer or paste the link to a specific video.',
      },
      {
        h: 'The AI picks the segments',
        p: 'The audio is transcribed and an artificial intelligence reads the whole transcript looking for segments that stand on their own: opening, hook and close. You decide between best moments, the whole video, or a fixed number of clips.',
      },
      {
        h: 'Cut, captions and cover',
        p: 'Each segment becomes a vertical 9:16 video with burned-in captions, an optional title and a cover. In manual mode you adjust the framing by dragging and pick the style from a visual gallery.',
      },
      {
        h: 'Publishing on your schedule',
        p: 'Finished clips go into a queue with an editable caption. You set the times of day, or let the system spread them out, and it publishes. If you would rather review first, send everything to a folder in your Google Drive.',
      },
    ],

    recursosOlho: 'What you can do',
    recursosAnterior: 'Previous feature',
    recursosProximo: 'Next feature',
    recursosParte1: 'Part 1',
    recursosCanal: 'Channel {letra}',
    recursosLegenda: 'Caption',
    recursosTitulo: 'You control the result, without opening an editor',
    recursosTexto:
      'The automatic clip comes out ready to publish. But if you have your own way of presenting, you can adjust every part of it.',
    recursos: [
      {
        h: 'Clip visual style',
        p: 'Pick the caption style from a gallery: classic, bold, subtle or in a coloured bubble. The same goes for the title that appears in the first few seconds.',
      },
      {
        h: 'Framing by hand',
        p: 'In manual mode you drag the video inside the vertical frame and decide how far to zoom. What you see on screen is exactly what comes out in the clip.',
      },
      {
        h: 'Background image',
        p: 'Upload a background template with your branding and place the video on top of it. Every clip from that channel comes out with the same identity.',
      },
      {
        h: 'Series numbering',
        p: 'Turn on the "Part 1, Part 2" badge and choose which corner of the screen it appears in. Useful for turning a long video into a sequence that keeps people watching.',
      },
      {
        h: 'Settings per channel',
        p: 'Each channel can have its own style, or you set a default and apply it to all of them at once. Number of clips, length and quality too.',
      },
      {
        h: 'Automatic description',
        p: 'The caption for each clip is written by the AI from what was actually said in the segment. You can edit it before publishing, or pin your own standard text.',
      },
      {
        h: 'One channel, several accounts',
        p: 'Several YouTube channels and several TikTok accounts at the same time. Each channel publishes to the account you linked it to.',
      },
      {
        h: 'Times you choose',
        p: 'Set fixed times of day or let the system spread them out on its own. The queue shows when each clip will go out.',
      },
      {
        h: 'Copy in Google Drive',
        p: 'If you would rather review first, every finished clip can go automatically to a folder in your Drive, separated by channel.',
      },
    ],

    planosOlho: 'Pricing',
    planosTitulo: 'You pay per minute of video processed',
    planosTexto:
      'Minutes renew every week. When downloads go out through your own internet connection, our cost drops, and that saving comes back to you as bonus minutes.',
    maisEscolhido: 'Most popular',
    porMes: '/month',
    minutosPorSemana: '{n} minutes',
    minutosPorSemanaResto: 'of video per week',
    minutosBonus: '{n} minutes',
    minutosBonusResto: 'using your own internet',
    canaisYoutube: '{n} YouTube channels',
    canalYoutube: '{n} YouTube channel',
    canaisIlimitados: 'Unlimited YouTube channels',
    contasTiktok: '{n} TikTok accounts',
    contaTiktok: '{n} TikTok account',
    contasIlimitadas: 'Unlimited TikTok accounts',
    incluiCorte: 'AI clipping, captions, cover and scheduling',
    incluiDrive: 'Export to Google Drive',
    comecar: 'Get started',
    notaPlanos:
      'Run out of minutes for the week? You can buy a one-off pack, which does not expire. Nothing is charged beyond the subscription without your authorisation.',

    faqOlho: 'Frequently asked questions',
    faqTitulo: 'What people usually ask',
    faqRodapeA: 'Still have a question? Write to',
    faqRodapeB: 'we reply',

    numerosOlho: 'Numbers',
    numerosTitulo: 'Post Flow in numbers',
    numerosTexto:
      'All this automation has already published thousands of clips and helped accounts grow without anyone opening a video editor.',
    numerosVideosValor: '+85K',
    numerosVideosRotulo: 'videos published',
    numerosContasValor: '+9,400',
    numerosContasRotulo: 'connected accounts',
    numerosViewsValor: '340 million',
    numerosViewsRotulo: 'views generated',

    finalOlho: 'Start today',
    finalTitulo: 'Paste your channel link and watch the first clip come out',
    finalTexto:
      'Setup takes a few minutes. After that, every new video on your channel becomes a published clip without you touching anything.',
    falarComAGente: 'Talk to us',
    semFidelidade: 'No lock-in. Cancel whenever you want.',
  },

  perguntas: [
    {
      p: 'Does Post Flow publish to TikTok on its own?',
      r: 'Yes. You choose between receiving the clip as a draft in the TikTok app, to finish it there, or publishing straight to your profile without opening the app. With direct publishing you set privacy and what people can do once, and it applies to every clip.',
    },
    {
      p: 'Do I need to leave my computer on?',
      r: 'No. All the processing happens on our servers. There is an optional program that routes downloads through your internet connection and earns you extra minutes on your plan, but it is optional and you choose whether the video waits for your computer or not.',
    },
    {
      p: 'How many clips come out of each video?',
      r: 'It depends on the video and on what you configure: only the best moments, the whole video sliced up, or a fixed number. Billing is per minute of the source video, so the number of clips does not change the price.',
    },
    {
      p: 'How long does a clip take to be ready?',
      r: 'It depends on the size of the video and on the queue. A 30-minute video usually takes a few minutes across detecting, transcribing, picking segments and rendering. You follow the percentage of each clip on screen.',
    },
    {
      p: 'Does Post Flow put a watermark on my videos?',
      r: 'No. No logo of ours is added to the video. The only things overlaid are the caption and the title generated from your own audio, and you can turn both off.',
    },
    {
      p: 'Can I use more than one channel and more than one TikTok account?',
      r: 'You can. Each YouTube channel publishes to the TikTok account you link it to, and each account has its own schedule. How many depends on the plan.',
    },
    {
      p: 'Is Post Flow for clipping someone else\'s video?',
      r: 'No. The tool exists for people who already produce their own content and want to automate the cutting and publishing step. By using the service you declare that you have the rights to the material you submit for processing. We do not moderate content before publication and we are not responsible for misuse of third-party material.',
    },
    {
      p: 'Do I have to give you my YouTube or TikTok password?',
      r: 'No. Connecting TikTok and Google Drive uses each platform\'s official login. You authorise on their screen and Post Flow never sees your password. You can revoke it whenever you want, from the dashboard or in your account settings.',
    },
    {
      p: 'What exactly do you access in my Google Drive?',
      r: 'Only the folder you choose to receive the finished clips. Post Flow uses a permission that reaches only the files it creates itself: the rest of your Drive stays invisible to us.',
    },
    {
      p: 'Are clips stored forever?',
      r: 'No. Once published they are deleted from our server automatically, after a period you set. If you want to keep them, use the export to Google Drive, where the files stay with you.',
    },
    {
      p: 'What if I want to review before publishing?',
      r: 'You can turn off automatic posting and publish manually, or send every finished clip to a folder in your Google Drive, separated by channel.',
    },
    {
      p: 'Can I cancel whenever I want?',
      r: `You can, with no penalty and without talking to anyone. Access continues until the end of the period already paid for. To delete the account and all data, just write to ${CONTACT.supportEmail}.`,
    },
  ],

  cadastro: {
    titulo: 'Create account',
    subtitulo: 'It takes less than a minute. Then you just connect your channel.',
    nomeNegocio: 'Business name',
    opcional: '(optional)',
    email: 'Email',
    senha: 'Password',
    peloMenos8: 'At least 8 characters.',
    aceite: 'I have read and accept the <a href="/termos" target="_blank" rel="noopener">Terms of Use</a> and the <a href="/privacidade" target="_blank" rel="noopener">Privacy Policy</a>, and I declare that I will only process content I hold the rights to.',
    precisaAceitar: 'You need to accept the Terms of Use and the Privacy Policy to create the account.',
    jaTemConta: 'Already have an account?',
    entrar: 'Sign in',
  },

  // Mensagens de erro da API. O painel mostra o que vier em `error`,
  // entao elas precisam chegar ja no idioma de quem esta usando.
  erros: {
    alturaInvalida: "Invalid video height in the template (10 to 100).",
    arquivoSumiu: "That clip's file is no longer on the server.",
    arquivoSumiuReinicio: "That clip's file is no longer on the server (this happens if the service restarted before the download).",
    assinaturaNaoEncontrada: "Subscription not found.",
    cadastrePixAntes: "Set up your Pix key before requesting a withdrawal.",
    canalJaCadastrado: "That channel is already registered.",
    canalNaoEncontrado: "Channel not found.",
    canalSemVideo: "That channel has no videos.",
    capaNaoEncontrada: "Cover not found.",
    cartaoIndisponivel: "Adding a card is not available yet. Contact support.",
    chavePixInvalida: "Enter a valid Pix key.",
    codigoDeLinkInvalido: "Invalid link code. Use only letters, numbers, hyphens and underscores (3 to 32 characters).",
    codigoDeLinkJaExiste: "A link with that code already exists.",
    codigoInvalido: "Invalid or expired code. Generate a new one in the program.",
    coleLinkPasta: "Paste the Drive folder link or ID.",
    conecteDrive: "Connect Google Drive first.",
    conecteDriveConfig: "Connect Google Drive first, in Settings.",
    configurePasta: "Set a destination folder for this channel first (on the Channels screen).",
    contaNaoEncontrada: "Account not found.",
    contaTiktokInvalida: "Invalid TikTok account.",
    contaTiktokNaoEncontrada: "TikTok account not found.",
    corteNaoNaFila: "Clip not found in the queue.",
    corteNaoPronto: "Clip not found or not ready yet.",
    corteSemCanal: "That clip did not come from a YouTube channel, so it has no destination folder.",
    credenciaisInvalidas: "Invalid email or password.",
    driveInvalido: "The Google Drive connection is no longer valid. Reconnect it in Settings.",
    duracaoTituloInvalida: "Invalid title duration (1 to 15s).",
    emailInvalido: "Enter a valid email.",
    emailJaExiste: "An account with that email already exists.",
    enquadramentoInvalido: "Invalid framing.",
    envieImagemAntes: "Upload the background image before choosing that option.",
    erroNaoEncontrado: "Error not found.",
    escolhaContaPasta: "Choose at least one TikTok account to receive the videos from that folder.",
    escolhaContaVideo: "Choose at least one TikTok account to receive that video.",
    escrevaDescricao: "Write the fixed description that will be used.",
    escrevaEmail: "Enter your account email.",
    estiloCorteInvalido: "Invalid clip style.",
    estiloLegendaInvalido: "Invalid caption style.",
    estiloTituloInvalido: "Invalid title style.",
    falhaEvento: "Failed to process event.",
    formatoImagem: "Upload a PNG, JPG or WEBP image.",
    informeCanal: "Enter the channel link or @handle.",
    informeCodigo: "Enter the pairing code.",
    informeHorario: "Enter at least one valid time (HH:MM format).",
    itemNaoExisteMais: "Could not retry: the item behind this failure no longer exists.",
    jaTemPrograma: "You already have a program connected. Disconnect the current one before pairing another.",
    linkExpirado: "That link has expired or has already been used. Request a new one.",
    linkUsado: "That link has already been used. Request a new one.",
    linkYoutubeInvalido: "Invalid YouTube link. Paste the full video URL.",
    modoAgendamentoInvalido: "Invalid schedule mode.",
    modoCorteInvalido: "Invalid clipping mode.",
    modoDescricaoInvalido: "Invalid description mode.",
    modoEstiloInvalido: "Invalid clip style mode.",
    naoAutorizouPrograma: "Could not authorise the program on the server. Try again in a moment.",
    naoLeuVideo: "Could not read that video file.",
    naoRecolocouNaFila: "Could not put it back in the queue right now.",
    naoReiniciouVideo: "Could not restart that video right now, try again.",
    nenhumArquivo: "No file uploaded.",
    nenhumFallback: "No fallback tunnel configured yet.",
    nenhumPrograma: "No program connected yet.",
    nenhumTemplate: "No template uploaded for that target.",
    nenhumVideoSelecionado: "No video selected.",
    nenhumaImagem: "No image was uploaded.",
    numeroCortesInvalido: "Invalid number of clips (1 to 30).",
    operacaoNaoRefeita: "That operation cannot be retried from here.",
    ordemInvalida: "Invalid order list.",
    pagamentoIndisponivel: "Card payment is not available yet. Contact support.",
    percentualInvalido: "Invalid percentage (0 to 100).",
    planoInvalido: "Invalid plan.",
    posicaoNumeracaoInvalida: "Invalid part numbering position.",
    posicaoVideoInvalida: "Invalid video position in the template (0 to 100).",
    postagemNaoNaFila: "Post not found or already out of the waiting queue.",
    postagemSemErro: "Post not found or not in error.",
    programaNaoConectado: "You have not connected the program yet.",
    proporcaoInvalida: "Invalid aspect ratio.",
    publicKeyInvalida: "Invalid publicKey.",
    qualidadeInvalida: "Invalid quality.",
    retencaoInvalida: "Invalid retention.",
    saldoAbaixoDoMinimo: "Your balance hasn't reached the minimum withdrawal amount yet.",
    saldoInsuficiente: "Insufficient balance for this withdrawal.",
    saqueNaoPendente: "This withdrawal is no longer pending.",
    senhaAtualIncorreta: "Current password is incorrect.",
    senhaCurta: "The new password must be at least 8 characters.",
    templateNaoEncontrado: "Template not found.",
    tiktokIndisponivel: "Could not reach TikTok right now. Try again in a moment.",
    tipoChavePixInvalido: "Invalid Pix key type.",
    valorInvalido: "Invalid value.",
    cartaoNaoEncontrado: "Card not found.",
    nenhumCartaoCadastrado: "No card saved yet.",
    videoJaAdicionado: "That video has already been added.",
    videoJaProcessado: "You have already processed that video.",
    videoNaoComErro: "That video is not in error or cancelled right now.",
    videoNaoEncontrado: "Video not found.",
    videoNaoNaFila: "That video is not waiting in the queue.",
    videoNaoPausado: "That video is not paused right now (or does not exist).",
    videoNaoProcessando: "That video is not being processed right now (or does not exist).",
    videoSemCanal: "That video did not come from a YouTube channel, so it has no destination folder.",
    videosPorDiaInvalido: "Videos per day must be a number between 1 and 20.",
    zoomInvalido: "Invalid framing zoom (0 to 100).",
  },

  contato: {
    titulo: 'Contact and support',
    respondemos: 'We reply {tempo}.',
    emailRotulo: 'Email',
    mesmoCanal: 'It is the same channel for questions, technical problems, billing and data deletion requests.',
    jaTemContaTitulo: 'Already have an account?',
    jaTemContaTexto: 'If you already use Post Flow, the fastest route is to open <a href="/client">your dashboard</a>. Most questions are answered there:',
    atalhos: [
      '<strong>Video stuck or failed</strong>. The <strong>Clips</strong> screen shows the reason and has a retry button.',
      '<strong>Clip was not published</strong>. The Queue tab, under <strong>Publishing</strong>, shows the expected time of each post, and the "Error" tab shows what TikTok refused.',
      '<strong>I ran out of minutes</strong>. The <strong>Plan and usage</strong> screen shows your balance and lets you buy a one-off pack.',
      '<strong>Change password or email</strong>, under <strong>Settings</strong>.',
    ],
    exclusaoTitulo: 'Data deletion request',
    exclusaoTexto: 'You can request deletion of your account and everything linked to it by emailing <a href="mailto:{email}">{email}</a> from the address registered on the account, with the subject <strong>"Delete my account"</strong>. We delete the videos, the clips, the TikTok and Google access tokens, the credit history and the registration data. Exactly what we do is detailed in the <a href="/privacidade">Privacy Policy</a>.',
    revogarTitulo: 'Revoke access without deleting the account',
    revogarTexto: 'If you just want Post Flow to stop accessing your accounts, you do not need to talk to us:',
    revogar: [
      '<strong>TikTok</strong>. In the dashboard, under <strong>Publishing</strong>, click disconnect. Or, in the TikTok app: Profile → Settings → Security → Connected apps and services.',
      '<strong>Google Drive</strong>. In the dashboard, under <strong>Settings</strong>, disconnect Drive. Or at <a href="https://myaccount.google.com/permissions" rel="noopener">myaccount.google.com/permissions</a>.',
    ],
    documentosTitulo: 'Documents',
    metaDescricao:
      'Get in touch with Post Flow: support, questions about plans, privacy and account deletion.',
    intro: 'Write to us. We reply {tempo}.',
    email: 'Email',
    quandoEscrever: 'When to write',
    motivos: [
      'Questions about plans, minutes or billing',
      'A problem with a clip, a channel or a post',
      'Request to delete your account and data',
      'Questions about privacy or about what data we store',
    ],
    empresaTitulo: 'Who operates the service',
    cnpj: 'Company number (CNPJ)',
    endereco: 'Address',
  },

  erro: {
    titulo: 'Something went wrong',
    voltar: 'Back to home',
  },

  ...legal,
};
