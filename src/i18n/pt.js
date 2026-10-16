'use strict';

// Português — a fonte de verdade das chaves das páginas públicas.
//
// Quando uma chave só existe aqui, `en` e `es` caem neste texto (ver index.js).
// Ao adicionar uma chave, adicione nos três arquivos.
//
// O que NÃO fica aqui: nome da empresa, CNPJ, endereço e e-mail. Isso vem de
// src/config/constants.js e é igual nos três idiomas — repetir traria o risco
// de um deles ficar com um CNPJ desatualizado.

const legal = require('./legal-pt');

module.exports = {
  nav: {
    comoFunciona: 'Como funciona',
    recursos: 'Recursos',
    planos: 'Planos',
    duvidas: 'Dúvidas',
    entrar: 'Entrar',
    criarConta: 'Criar conta',
    meuPainel: 'Meu painel',
    inicio: 'Post Flow, página inicial',
    idioma: 'Idioma',
  },

  rodape: {
    descricao:
      'Cortes automáticos do seu canal do YouTube publicados no seu TikTok.',
    produto: 'Produto',
    empresa: 'Empresa',
    legal: 'Legal',
    contato: 'Contato',
    termos: 'Termos de Uso',
    privacidade: 'Política de Privacidade',
    direitos: 'Todos os direitos reservados.',
    naoAfiliado:
      'Post Flow não é afiliado ao YouTube, ao TikTok nem ao Google. Todas as marcas pertencem aos seus donos.',
  },

  landing: {
    tituloPagina: 'Cortes com IA de vídeos e lives, publicados em 7 redes',
    metaDescricao:
      'O Post Flow acompanha seu canal do YouTube e as lives da Twitch e da Kick, escolhe os melhores momentos com IA, corta no vertical com legenda e publica no TikTok, Instagram, Facebook e mais 4 redes, sozinho.',

    // --- Topo ---
    seloNovo: 'Novo',
    seloTexto: 'Cortes de lives e publicação em 7 redes sociais',
    h1a: 'Do vídeo longo ao corte publicado',
    h1Prep: 'no',
    // Nome das redes que se alternam no fim do título. São nomes próprios,
    // iguais nos três idiomas; só a preposição antes muda (no / on / en).
    h1Redes: ['TikTok', 'Instagram', 'Facebook', 'Threads', 'LinkedIn', 'Pinterest', 'Bluesky'],
    h1Leitor: 'Do vídeo longo ao corte publicado no TikTok, Instagram, Facebook, Threads, LinkedIn, Pinterest e Bluesky.',
    lead:
      'O Post Flow acompanha seu canal do YouTube e as lives da Twitch e da Kick, encontra os melhores momentos com IA, corta no vertical com legenda e publica nas suas redes no horário que você escolher.',
    leadForte: 'Sem abrir editor. Sem subir vídeo um por um.',
    ctaPrincipal: 'Começar agora',
    verComoFunciona: 'Ver como funciona',
    garantias: ['Sem fidelidade', 'PIX ou cartão', 'Sem marca d’água', 'Empresa brasileira'],

    // Painel de demonstração do topo (desenho, não print): textos curtos que
    // aparecem dentro dele.
    painelTitulo: 'Linha de produção',
    painelAoVivo: 'ao vivo',
    painelFonteYoutube: 'Vídeo novo no canal',
    painelFonteYoutubeInfo: '42 min',
    painelFonteLive: 'Live na Twitch',
    painelFonteLiveInfo: 'clipando agora',
    painelEtapas: ['Transcrição', 'Momentos encontrados: 7', 'Cortando no 9:16'],
    painelNota: 'nota',
    painelLegenda: 'NÃO ME PREOCUPO MAIS',
    painelPublica: 'às {hora}',
    painelPublicado: 'Publicado',

    // Faixa de números do produto. Fatos do produto, não estatística de uso.
    fatos: [
      { v: '7', r: 'redes sociais com publicação automática' },
      { v: '3', r: 'fontes: YouTube, Twitch e Kick' },
      { v: '27', r: 'estilos de legenda e 12 de título' },
      { v: '24h', r: 'por dia, mesmo com o computador desligado' },
    ],

    // --- Redes ---
    redesOlho: 'Publicação automática',
    redesTitulo: 'Um corte, todas as suas redes',
    redesTexto:
      'Conecte suas contas pelo login oficial de cada rede. Cada conta tem a própria fila, com horário e legenda, e os cortes saem sozinhos.',
    fontesRotulo: 'De onde vêm os cortes',
    fontes: [
      { h: 'YouTube', p: 'Canal monitorado ou link de um vídeo' },
      { h: 'Twitch', p: 'Lives clipadas enquanto estão no ar' },
      { h: 'Kick', p: 'Lives clipadas enquanto estão no ar' },
      { h: 'Seu arquivo', p: 'Envie um vídeo do computador' },
    ],
    destinosRotulo: 'Para onde vão',

    // --- Como funciona (também vira o HowTo dos dados estruturados) ---
    comoFuncionaTitulo: 'Três passos. Dois deles são da máquina.',
    comoFuncionaTexto: 'Você configura uma vez. Daí em diante, cada vídeo novo e cada live viram cortes publicados.',
    passos: [
      {
        h: 'Conecte as fontes',
        p: 'Cole o endereço do seu canal do YouTube ou adicione um canal da Twitch ou da Kick. Também dá para enviar um arquivo ou colar o link de um vídeo específico.',
      },
      {
        h: 'A IA encontra os momentos',
        p: 'Ela transcreve o áudio, lê tudo, dá nota para cada trecho e corta no vertical 9:16 com legenda, título e capa. Nas lives, os cortes saem enquanto a transmissão ainda está no ar.',
      },
      {
        h: 'Publica sozinho',
        p: 'Cada corte entra na fila das contas que você escolheu e sai no horário certo. Ou fica no Feed de cortes para você escolher um por um.',
      },
    ],
    passoVoce: 'Você',
    passoMaquina: 'A máquina',

    // --- Linha de produção ---
    linhaOlho: 'Por dentro',
    linhaTitulo: 'Uma linha de produção que você vê funcionando',
    linhaTexto:
      'No painel, cada vídeo aparece na etapa em que está, em tempo real. Quando um corte fica pronto, ele vai direto para a fila da rede certa.',
    linhaEtapas: [
      { h: 'Vigia', p: 'Percebe o vídeo novo ou a live que começou' },
      { h: 'Download', p: 'Baixa o vídeo ou grava a live' },
      { h: 'Transcrição', p: 'Cada palavra com o tempo exato' },
      { h: 'Seleção com IA', p: 'Nota para gancho, emoção e desfecho' },
      { h: 'Corte e legenda', p: 'Vertical 9:16, legenda, título e capa' },
      { h: 'Publicação', p: 'Fila por conta, no seu horário' },
    ],

    // --- Recursos (também vira o featureList dos dados estruturados) ---
    recursosOlho: 'Recursos',
    recursosTitulo: 'Não é só um cortador. É a máquina inteira.',
    recursosTexto: 'Tudo o que fica entre a gravação e o post publicado, num lugar só.',
    recursos: [
      {
        h: 'Cortes de lives, ao vivo',
        p: 'Acompanhe canais da Twitch e da Kick. A IA assiste a transmissão e os cortes ficam prontos enquanto a live ainda está no ar. Viu um momento bom? Aperte “Clipar este momento”.',
      },
      {
        h: '7 redes, uma fila por conta',
        p: 'TikTok, Instagram, Facebook, Threads, LinkedIn, Pinterest e Bluesky. Horários fixos ou distribuídos sozinhos, e a mesma configuração aplicada a todas as contas de uma vez.',
      },
      {
        h: 'A IA escolhe os momentos',
        p: 'Ela lê a transcrição inteira e dá nota para cada trecho. Você escolhe: só os melhores momentos, o vídeo inteiro em partes, ou uma quantidade fixa de cortes.',
      },
      {
        h: 'Legenda e título com a sua cara',
        p: '27 estilos de legenda, 12 de título, enquadramento arrastando, imagem de fundo com a sua marca e numeração “Parte 1, Parte 2”. Salve como modelo e use em qualquer canal.',
      },
      {
        h: 'Enquadramento da webcam',
        p: 'Nos cortes de live, a IA monta o formato: câmera em cima e jogo embaixo, ou tela dividida. E coloca o título onde ele não cobre ninguém.',
      },
      {
        h: 'Fila com horário em cada conta',
        p: 'Cada conta publica nos próprios horários, ou no padrão de hora cheia. Postar agora, pausar, reordenar e editar a legenda: a fila é sua.',
      },
      {
        h: 'Canal gringo, corte em português',
        p: 'Quando o vídeo tem áudio dublado, o corte sai no idioma que você escolher, com a legenda no mesmo idioma.',
      },
      {
        h: 'Suporte com IA',
        p: 'A Flora, nossa assistente, consulta a sua conta e resolve na hora. Se um vídeo falhou por culpa nossa, ela mesma devolve os minutos.',
      },
    ],
    recursosLegendaExemplo: 'ISSO MUDOU TUDO',
    recursosTituloExemplo: 'O segredo que ninguém conta',
    recursosClipar: 'Clipar este momento',
    recursosAoVivo: 'AO VIVO',
    recursosFlora: 'O vídeo de ontem falhou, devolvi os 32 minutos para a sua conta.',
    recursosDublagem: 'Áudio: Português',
    extrasTitulo: 'E também',
    extras: [
      'Sem marca d’água do Post Flow',
      'Descrição de cada corte escrita pela IA',
      'Cópia automática no Google Drive',
      'Vários canais e várias contas',
      'Nunca pedimos sua senha',
      'Funciona no computador e no celular',
      'Pausar e retomar sem perder o que já foi feito',
      'Painel em português, inglês e espanhol',
    ],

    // --- Para quem é ---
    paraQuemOlho: 'Para quem é',
    paraQuemTitulo: 'Feito para quem publica todo dia',
    paraQuem: [
      { h: 'Criadores do YouTube', p: 'Cada vídeo novo do canal vira uma semana de cortes nas outras redes.' },
      { h: 'Podcasts e entrevistas', p: 'Episódios longos viram trechos curtos, com gancho e legenda.' },
      { h: 'Streamers', p: 'Os melhores momentos da sua live publicados enquanto ainda estão quentes.' },
      { h: 'Agências e gestores', p: 'Vários canais e várias contas por rede, cada um com o próprio estilo e a própria fila.' },
    ],

    // --- Antes e depois ---
    antesOlho: 'O que muda',
    antesTitulo: 'Tudo o que você deixa de fazer',
    antesSem: 'Sem o Post Flow',
    antesCom: 'Com o Post Flow',
    antes: [
      'Assistir o vídeo inteiro procurando trecho bom',
      'Recortar e enquadrar no editor, um por um',
      'Legendar palavra por palavra',
      'Exportar no formato de cada rede',
      'Subir o mesmo vídeo em cada rede, uma por uma',
      'Lembrar o horário de postar todo dia',
    ],
    depois: [
      'A IA assiste e escolhe os momentos',
      'Corte vertical pronto e enquadrado',
      'Legenda e título automáticos',
      'Um formato que serve em todas as redes',
      'Publicado em todas, sozinho',
      'Fila com horário, todos os dias',
    ],

    // --- Planos ---
    planosOlho: 'Planos',
    planosTitulo: 'Um plano para cada ritmo de publicação',
    planosTexto:
      'Os minutos renovam toda semana e valem para vídeos e lives. Quando os downloads saem pela sua própria internet, o custo para nós cai, e essa economia volta para você em forma de minutos bônus.',
    // Versao usada quando o tunel esta escondido: sem prometer minutos bonus
    // que o cliente nao tem como liberar (ver lib/exibicaoDoTunel).
    planosTextoSemTunel:
      'Os minutos renovam toda semana e valem para vídeos e lives. Você paga pelo minuto do vídeo original, não por quantidade de cortes: um vídeo de 30 minutos custa o mesmo se render 3 ou 12 cortes.',
    maisEscolhido: 'Mais escolhido',
    porMes: '/mês',
    noPrimeiroMes: 'no 1º mês',
    depoisPorMes: 'depois R$ {valor}/mês',
    descontoPrimeiroMes: '{n}% de desconto no 1º mês',
    conexoesExtras: 'Canal extra do YouTube por R$ {canal}/mês',
    minutosPorSemana: '{n} minutos',
    minutosPorSemanaResto: 'de vídeo por semana',
    minutosBonus: '{n} minutos',
    minutosBonusResto: 'usando sua internet',
    canaisYoutube: '{n} canais do YouTube',
    canalYoutube: '{n} canal do YouTube',
    canaisIlimitados: 'Canais do YouTube ilimitados',
    contasTiktok: '{n} contas do TikTok',
    contaTiktok: '{n} conta do TikTok',
    contasIlimitadas: 'Contas do TikTok ilimitadas',
    contasPorRede: '{n} contas em cada uma das outras 6 redes',
    contaPorRede: '{n} conta em cada uma das outras 6 redes',
    canaisLive: '{n} canais de live (Twitch ou Kick)',
    canalLive: '{n} canal de live (Twitch ou Kick)',
    contaExtraRede: 'Conta extra no TikTok e em mais 6 redes por R$ {valor}/mês',
    incluiCorte: 'Corte com IA, legenda, capa e agendamento',
    incluiDrive: 'Feed de cortes e cópia no Google Drive',
    comecar: 'Começar',
    regraCreditos: '1 minuto de vídeo = 1 crédito · 3 minutos de live = 1 crédito',
    notaPlanos:
      'Acabaram os minutos da semana? Dá para comprar um pacote avulso, que não expira. Nada é cobrado além da assinatura sem você autorizar.',

    // --- Confiança ---
    confiancaOlho: 'Pode confiar',
    confiancaTitulo: 'Empresa brasileira, pagamento em real',
    confianca: [
      { h: 'Empresa brasileira', p: 'CNPJ no rodapé desta página, suporte em português e cobrança em real.' },
      { h: 'PIX ou cartão', p: 'Pagamento processado pelo Asaas, instituição autorizada pelo Banco Central.' },
      { h: 'Login oficial', p: 'Você conecta TikTok, Google e as outras redes na tela delas. Nunca vemos sua senha.' },
      { h: 'Sem fidelidade', p: 'Cancele quando quiser, pelo próprio painel. O acesso vai até o fim do período pago.' },
    ],

    faqOlho: 'Perguntas frequentes',
    faqTitulo: 'O que costumam perguntar',
    faqRodapeA: 'Ficou alguma dúvida? Escreva para',
    faqRodapeB: 'respondemos',

    feedOlho: 'Feed de cortes',
    feedTitulo: 'Rolou, curtiu, postou.',
    feedTexto:
      'Tudo o que a máquina produziu (cortes dos seus vídeos e os melhores momentos das lives) chega num feed vertical, igual ao que você já usa todo dia. Você assiste como espectador e decide como editor: o que vale vai para a fila de qualquer rede com um toque. O que não vale, você só passa.',
    feedPontos: [
      { h: 'Tudo num lugar só', p: 'Vídeos do YouTube e momentos das lives, do mais novo para o mais antigo, com filtro por canal.' },
      { h: 'Um toque para publicar', p: 'Toque em Postar, marque as contas e o corte entra na fila de cada rede no próximo horário livre.' },
      { h: 'Nada se repete', p: 'O que você já assistiu sai do feed. Os favoritos ficam guardados na aba Gostei.' },
    ],
    feedCta: 'Quero meu feed de cortes',
    feedPostarEm: 'Postar em',
    feedNaFila: 'Colocar na fila',
    feedProximo: 'Sai hoje às 18:00',
    feedLegenda: 'Parte 2 · o segredo que ninguém conta',

    finalOlho: 'Comece hoje',
    finalTitulo: 'Conecte seu canal e veja o primeiro corte sair',
    finalTexto:
      'A configuração leva alguns minutos. Depois disso, cada vídeo novo e cada live viram cortes publicados sem você tocar em nada.',
    falarComAGente: 'Falar com a gente',
    semFidelidade: 'Sem fidelidade. Cancele quando quiser.',
  },

  perguntas: [
    {
      p: 'Em quais redes o Post Flow publica?',
      r: 'TikTok, Instagram, Facebook, Threads, LinkedIn, Pinterest e Bluesky. Você conecta cada conta pelo login oficial da rede e escolhe quais contas recebem os cortes de cada canal. No Instagram e no Facebook o corte precisa ter até 90 segundos.',
    },
    {
      p: 'O Post Flow publica sozinho?',
      r: 'Sim. Cada conta tem uma fila com horários, e os cortes saem sozinhos no horário que você definiu. Se preferir escolher um por um, desligue a publicação automática e mande os cortes para a fila pelo Feed de cortes. No TikTok dá também para enviar como rascunho e finalizar no aplicativo.',
    },
    {
      p: 'Dá para cortar lives?',
      r: 'Sim, da Twitch e da Kick. A IA acompanha a transmissão e os cortes ficam prontos enquanto a live ainda está no ar. O botão “Clipar este momento” corta os últimos minutos na hora. Os cortes de live aparecem no Feed de cortes, de onde você manda para a fila de qualquer rede.',
    },
    {
      p: 'Preciso deixar meu computador ligado?',
      r: 'Não. Todo o processamento acontece nos nossos servidores. Existe um programa opcional que faz os downloads saírem pela sua internet e te dá minutos extras no plano, mas ele é opcional e você escolhe se o vídeo espera o seu computador ou não.',
      // Sem o tunel, a resposta nao cita o programa opcional.
      rSemTunel: 'Não. Todo o processamento acontece nos nossos servidores. Você configura uma vez e pode desligar o computador — os cortes continuam saindo e sendo publicados nos horários que você escolheu.',
    },
    {
      p: 'Como funcionam os créditos?',
      r: 'O plano dá uma cota de minutos que renova toda semana. Cada minuto de vídeo processado gasta 1 crédito; nas lives, cada 3 minutos clipados gastam 1 crédito, e cada “Clipar este momento” também. A quantidade de cortes não muda o preço. Se a cota acabar, dá para comprar minutos avulsos, que não expiram.',
    },
    {
      p: 'Quantos cortes saem de cada vídeo?',
      r: 'Depende do vídeo e do que você configurar: só os melhores trechos, o vídeo inteiro fatiado em partes, ou uma quantidade fixa. A cobrança é por minuto do vídeo original, então a quantidade de cortes não muda o preço.',
    },
    {
      p: 'Em quanto tempo o corte fica pronto?',
      r: 'Depende do tamanho do vídeo e da fila. Um vídeo de 30 minutos costuma levar alguns minutos entre detectar, transcrever, escolher os trechos e renderizar. Você acompanha cada etapa ao vivo no painel.',
    },
    {
      p: 'O Post Flow coloca marca d’água nos meus vídeos?',
      r: 'Não. Nenhum logotipo nosso é adicionado ao vídeo. As únicas coisas sobrepostas são a legenda e o título gerados a partir do seu próprio áudio, e você pode desligar as duas.',
    },
    {
      p: 'Posso usar mais de um canal e mais de uma conta em cada rede?',
      r: 'Pode. Cada plano inclui um número de canais do YouTube, de canais de live e de contas em cada rede, e cada conta tem o próprio agendamento. Se precisar de mais uma conta numa rede, dá para contratar uma conta extra em qualquer plano.',
    },
    {
      p: 'O Post Flow serve para cortar vídeo de outra pessoa?',
      r: 'Não. A ferramenta existe para quem já produz o próprio conteúdo e quer automatizar a etapa de recortar e publicar. Ao usar o serviço você declara que tem direito sobre o material que manda processar. Não moderamos conteúdo antes da publicação e não nos responsabilizamos por uso indevido de material de terceiros.',
    },
    {
      p: 'Preciso dar minha senha do YouTube, do TikTok ou das outras redes?',
      r: 'Não. A conexão com o TikTok, o Google Drive e as outras redes usa o login oficial de cada plataforma. Você autoriza na tela delas e o Post Flow nunca vê sua senha. Dá para desconectar quando quiser, no painel ou nas configurações da própria rede.',
    },
    {
      p: 'O que exatamente vocês acessam no meu Google Drive?',
      r: 'Só a pasta que o próprio Post Flow cria para receber os cortes prontos, uma por canal. A permissão que usamos alcança apenas os arquivos que nós mesmos criamos: o resto do seu Drive continua invisível para nós.',
    },
    {
      p: 'Os cortes ficam guardados para sempre?',
      r: 'Não. Depois de publicados, os cortes ficam 3 dias no nosso servidor e são apagados sozinhos. Para guardar, use a cópia automática no Google Drive ou baixe pelo painel antes disso.',
    },
    {
      p: 'E se eu quiser revisar antes de publicar?',
      r: 'Você pode desligar a postagem automática e escolher os cortes no Feed de cortes, ou mandar cada corte pronto para uma pasta do seu Google Drive, separada por canal.',
    },
    {
      p: 'Posso cancelar quando quiser?',
      r: 'Pode, pelo próprio painel, sem multa e sem falar com ninguém. O acesso continua até o fim do período já pago. Para apagar a conta e todos os dados, use Configurações → Excluir conta.',
    },
  ],

  cadastro: {
    titulo: 'Criar conta',
    subtitulo: 'Leva menos de um minuto. Depois é só conectar o seu canal.',
    nomeNegocio: 'Nome do negócio',
    opcional: '(opcional)',
    email: 'E-mail',
    senha: 'Senha',
    peloMenos8: 'Pelo menos 8 caracteres.',
    aceite: 'Li e aceito os <a href="/termos" target="_blank" rel="noopener">Termos de Uso</a> e a <a href="/privacidade" target="_blank" rel="noopener">Política de Privacidade</a>, e declaro que só vou processar conteúdo do qual tenho os direitos.',
    precisaAceitar: 'Você precisa aceitar os Termos de Uso e a Política de Privacidade pra criar a conta.',
    jaTemConta: 'Já tem conta?',
    entrar: 'Entrar',
  },

  // Mensagens de erro da API. O painel mostra o que vier em `error`,
  // entao elas precisam chegar ja no idioma de quem esta usando.
  erros: {
    alturaInvalida: "Altura do vídeo no template inválida (10 a 100).",
    arquivoSumiu: "O arquivo desse corte não está mais no servidor.",
    arquivoSumiuReinicio: "O arquivo desse corte não está mais no servidor (isso acontece se o serviço foi reiniciado antes do download).",
    assinaturaNaoEncontrada: "Assinatura não encontrada.",
    semAssinaturaParaCancelar: "Não há cobrança recorrente para cancelar nesta conta. Fale com o suporte.",
    cancelamentoFalhou: "Não conseguimos cancelar agora. Tente de novo em alguns minutos — nada foi alterado.",
    cadastrePixAntes: "Cadastre sua chave Pix antes de solicitar o saque.",
    canalJaCadastrado: "Esse canal já está cadastrado.",
    canalNaoEncontrado: "Canal não encontrado.",
    canalSemVideo: "Esse canal não tem nenhum vídeo.",
    capaNaoEncontrada: "Capa não encontrada.",
    cartaoIndisponivel: "Cadastro de cartão ainda não está disponível. Fale com o suporte.",
    chavePixInvalida: "Informe uma chave Pix válida.",
    codigoDeLinkInvalido: "Código do link inválido. Use só letras, números, hífen e underline (3 a 32 caracteres).",
    rotuloDoLinkObrigatorio: "Dê um nome pro link (ex: Bio do TikTok) pra saber de onde vêm os cliques.",
    limiteDeLinks: "Você já tem {max} links. Arquive algum antes de criar outro.",
    linkNaoEncontrado: "Link não encontrado.",
    linkNaoPodeSerArquivado: "Esse link não pode ser arquivado. O link principal está sempre disponível.",
    codigoDeLinkJaExiste: "Já existe um link com esse código.",
    codigoInvalido: "Código inválido ou expirado. Gere um novo no programa.",
    coleLinkPasta: "Cole o link ou ID da pasta do Drive.",
    conecteDrive: "Conecte o Google Drive primeiro.",
    conecteDriveConfig: "Conecte o Google Drive primeiro, em Configurações.",
    configurePasta: "Configure uma pasta de destino pra esse canal primeiro (na tela Canais).",
    clienteNaoEncontrado: "Cliente não encontrado.",
    semContaDePostagem: "Este vídeo não tem conta do TikTok pra onde enviar. Vincule uma conta ao canal (ou escolha uma no envio) antes.",
    contaNaoEncontrada: "Conta não encontrada.",
    contaTiktokInvalida: "Conta TikTok inválida.",
    contaTiktokNaoEncontrada: "Conta TikTok não encontrada.",
    corteNaoNaFila: "Corte não encontrado na fila.",
    corteNaoPronto: "Corte não encontrado ou ainda não está pronto.",
    corteSemCanal: "Esse corte não veio de um canal do YouTube, então não tem pasta de destino.",
    credenciaisInvalidas: "E-mail ou senha inválidos.",
    driveInvalido: "A conexão com o Google Drive não está mais válida. Reconecte em Configurações.",
    modoPartesInvalido: "Modo de divisão em partes inválido.",
    quantidadePartesInvalida: "Quantidade de partes inválida (1 a 30).",
    duracaoParteInvalida: "Duração de cada parte inválida (1 a 10 minutos).",
    duracaoTituloInvalida: "Duração do título inválida (1 a 15s).",
    emailInvalido: "Informe um e-mail válido.",
    emailJaExiste: "Já existe uma conta com esse e-mail.",
    envieImagemAntes: "Envie a imagem de fundo antes de escolher essa opção.",
    erroNaoEncontrado: "Erro não encontrado.",
    escolhaContaPasta: "Escolha pelo menos uma conta TikTok pra receber os vídeos dessa pasta.",
    escolhaContaVideo: "Escolha pelo menos uma conta TikTok pra receber esse vídeo.",
    escrevaDescricao: "Escreva a descrição fixa que será usada.",
    escrevaEmail: "Escreva o e-mail da sua conta.",
    estiloCorteInvalido: "Estilo de corte inválido.",
    estiloLegendaInvalido: "Estilo de legenda inválido.",
    fonteInvalida: "Fonte inválida.",
    corInvalida: "Cor inválida.",
    alturaInvalida: "Altura inválida.",
    estiloTituloInvalido: "Estilo de título inválido.",
    falhaEvento: "Falha ao processar evento.",
    formatoImagem: "Envie uma imagem PNG, JPG ou WEBP.",
    informeCanal: "Informe o link ou @handle do canal.",
    informeCodigo: "Informe o código de pareamento.",
    informeHorario: "Informe pelo menos um horario válido (formato HH:MM).",
    itemNaoExisteMais: "Não deu pra tentar de novo: o item dessa falha não existe mais.",
    jaTemPrograma: "Você já tem um programa conectado. Desconecte o atual antes de parear outro.",
    linkExpirado: "Esse link expirou ou já foi usado. Peça um novo.",
    linkUsado: "Esse link já foi usado. Peça um novo.",
    linkYoutubeInvalido: "Link do YouTube inválido. Cole a URL completa do vídeo.",
    modoAgendamentoInvalido: "Modo de agendamento inválido.",
    modoCorteInvalido: "Modo de corte inválido.",
    modoDescricaoInvalido: "Modo de descrição inválido.",
    modoEstiloInvalido: "Modo de estilo de corte inválido.",
    naoAutorizouPrograma: "Não consegui autorizar o programa no servidor. Tente de novo em instantes.",
    naoLeuVideo: "Não foi possível ler esse arquivo de vídeo.",
    naoRecolocouNaFila: "Não consegui recolocar na fila agora.",
    naoReiniciouVideo: "Não foi possível reiniciar esse vídeo agora, tente de novo.",
    nenhumArquivo: "Nenhum arquivo enviado.",
    nenhumFallback: "Nenhum tunel de fallback configurado ainda.",
    nenhumPrograma: "Nenhum programa conectado ainda.",
    nenhumTemplate: "Nenhum template enviado pra esse alvo.",
    nenhumVideoSelecionado: "Nenhum vídeo selecionado.",
    nenhumaImagem: "Nenhuma imagem foi enviada.",
    numeroCortesInvalido: "Número de cortes inválido (1 a 30).",
    operacaoNaoRefeita: "Essa operação não pode ser refeita por aqui.",
    ordemInvalida: "Lista de ordem inválida.",
    pagamentoIndisponivel: "Pagamento por cartão ainda não está disponível. Fale com o suporte.",
    percentualInvalido: "Percentual inválido (0 a 100).",
    planoInvalido: "Plano inválido.",
    documentoInvalido: "CPF ou CNPJ inválido. Confira os números e tente de novo.",
    nomeInvalido: "Informe o nome completo.",
    posicaoNumeracaoInvalida: "Posicao da numeracao de parte inválida.",
    tamanhoNumeracaoInvalido: "Tamanho da numeração inválido (50% a 200%).",
    idiomaAudioInvalido: "Idioma do áudio inválido.",
    posicaoVideoInvalida: "Posição do vídeo no template inválida (0 a 100).",
    postagemNaoNaFila: "Postagem não encontrada ou já saiu da fila de espera.",
    limiteDoTiktok24h: 'Esta conta já publicou {n} vezes nas últimas 24 horas. O TikTok bloqueia mais do que isso como spam: o corte continua na fila e sai no próximo horário.',
    esperarEntrePosts: 'Esta conta acabou de publicar. Para o TikTok não marcar a conta como spam, espere {espaco} minutos entre uma publicação e outra: dá pra postar este corte daqui a {faltam} min. Ele continua na fila.',
    postagemSemErro: "Postagem não encontrada ou não está com erro.",
    programaNaoConectado: "Você ainda não conectou o programa.",
    publicKeyInvalida: "publicKey inválida.",
    saldoAbaixoDoMinimo: "Seu saldo ainda não chegou no valor mínimo de saque.",
    saldoInsuficiente: "Saldo insuficiente para esse saque.",
    saqueNaoPendente: "Esse saque não está mais pendente.",
    senhaAtualIncorreta: "Senha atual incorreta.",
    senhaCurta: "A nova senha precisa ter pelo menos 8 caracteres.",
    templateNaoEncontrado: "Template não encontrado.",
    tiktokIndisponivel: "Não foi possível falar com o TikTok agora. Tente de novo em instantes.",
    tipoChavePixInvalido: "Tipo de chave Pix inválido.",
    valorInvalido: "Valor inválido.",
    cartaoNaoEncontrado: "Cartão não encontrado.",
    nenhumCartaoCadastrado: "Nenhum cartão cadastrado ainda.",
    videoAindaNaoDisponivel: "Esse vídeo ainda não está disponível para download.",
    videoJaAdicionado: "Esse vídeo já foi adicionado antes.",
    videoJaProcessado: "Você já processou esse vídeo antes.",
    videoJaNoSistema: "Esse vídeo já está no sistema (situação: {status}). Veja em Vídeos & Cortes.",
    videoNaoComErro: "Esse vídeo não está com erro nem cancelado no momento.",
    videoNaoEncontrado: "Vídeo não encontrado.",
    videoNaoNaFila: "Esse vídeo não está esperando na fila.",
    videoNaoPausado: "Esse vídeo não está pausado no momento (ou não existe).",
    videoNaoProcessando: "Esse vídeo não está em processamento no momento (ou não existe).",
    videoSemCanal: "Esse vídeo não veio de um canal do YouTube, então não tem pasta de destino.",
    videosPorDiaInvalido: "Vídeos por dia precisa ser um número entre 1 e 10.",
    horariosDemais: "Você pode cadastrar no máximo 10 horários por dia.",
    zoomInvalido: "Zoom de enquadramento inválido (0 a 100).",
  },

  contato: {
    titulo: 'Contato e suporte',
    respondemos: 'Respondemos {tempo}.',
    emailRotulo: 'E-mail',
    mesmoCanal: 'É o mesmo canal pra dúvida, problema técnico, cobrança e pedido de exclusão de dados.',
    jaTemContaTitulo: 'Já tem conta?',
    jaTemContaTexto: 'Se você já usa o Post Flow, o caminho mais rápido é entrar no <a href="/client">seu painel</a>. A maioria das dúvidas se resolve ali:',
    atalhos: [
      '<strong>Vídeo travado ou com erro</strong>. A tela <strong>Cortes</strong> mostra o motivo e tem o botão de tentar de novo.',
      '<strong>Corte não foi publicado</strong>. A aba Fila, em <strong>Publicação</strong>, mostra o horário previsto de cada publicação, e a aba "Erro" mostra o que a TikTok recusou.',
      '<strong>Acabaram meus minutos</strong>. A tela <strong>Plano e uso</strong> mostra o saldo e permite comprar um pacote avulso.',
      '<strong>Trocar senha ou e-mail</strong>, em <strong>Configurações</strong>.',
    ],
    exclusaoTitulo: 'Pedido de exclusão de dados',
    exclusaoTexto: 'Você pode pedir a exclusão da sua conta e de tudo que está ligado a ela mandando um e-mail para <a href="mailto:{email}">{email}</a> do endereço cadastrado na conta, com o assunto <strong>"Excluir minha conta"</strong>. Apagamos os vídeos, os cortes, os tokens de acesso do TikTok e do Google, o histórico de créditos e os dados de cadastro. O que fazemos exatamente está detalhado na <a href="/privacidade">Política de Privacidade</a>.',
    revogarTitulo: 'Revogar o acesso sem apagar a conta',
    revogarTexto: 'Se você só quer que o Post Flow pare de acessar suas contas, não precisa falar com a gente:',
    revogar: [
      '<strong>TikTok</strong>. No painel, em <strong>Publicação</strong>, clique em desconectar. Ou, no app do TikTok: Perfil → Configurações → Segurança → Apps e serviços conectados.',
      '<strong>Google Drive</strong>. No painel, em <strong>Configurações</strong>, desconecte o Drive. Ou em <a href="https://myaccount.google.com/permissions" rel="noopener">myaccount.google.com/permissions</a>.',
    ],
    documentosTitulo: 'Documentos',
    metaDescricao:
      'Fale com o Post Flow: suporte, dúvidas sobre planos, privacidade e exclusão de conta.',
    intro: 'Escreva pra gente. Respondemos {tempo}.',
    email: 'E-mail',
    quandoEscrever: 'Quando escrever',
    motivos: [
      'Dúvida sobre planos, minutos ou cobrança',
      'Problema com um corte, um canal ou uma publicação',
      'Pedido de exclusão da conta e dos dados',
      'Dúvida sobre privacidade ou sobre quais dados guardamos',
    ],
    empresaTitulo: 'Quem opera o serviço',
    cnpj: 'CNPJ',
    endereco: 'Endereço',
  },

  erro: {
    titulo: 'Algo deu errado',
    voltar: 'Voltar para o início',
  },


  ...legal,
};
