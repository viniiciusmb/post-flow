'use strict';

// Português — a fonte de verdade das chaves das páginas públicas.
//
// Quando uma chave só existe aqui, `en` e `es` caem neste texto (ver index.js).
// Ao adicionar uma chave, adicione nos três arquivos.
//
// O que NÃO fica aqui: nome da empresa, CNPJ, endereço e e-mail. Isso vem de
// src/config/constants.js e é igual nos três idiomas — repetir traria o risco
// de um deles ficar com um CNPJ desatualizado.

const { CONTACT } = require('../config/constants');
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
    tituloPagina: 'Cortes automáticos do YouTube para o TikTok',
    metaDescricao:
      'O Post Flow acompanha seu canal do YouTube, corta os melhores trechos com IA e publica no seu TikTok automaticamente.',

    selo: '100% automático',
    h1a: 'Você grava uma vez.',
    h1b: 'O resto acontece',
    h1c: 'sozinho',
    lead:
      'Publicou no YouTube, o Post Flow percebe na hora. Ele baixa o vídeo, a IA lê a transcrição inteira e escolhe os melhores trechos, corta no vertical com legenda queimada e publica no seu TikTok.',
    leadForte: 'Sem você abrir editor, sem você abrir o TikTok.',
    verComoFunciona: 'Ver como funciona',
    notaHero:
      'Feito para quem já produz conteúdo próprio e quer parar de editar corte na mão.',
    altComputador:
      'Tela de cortes do Post Flow no computador, com os vídeos do canal em etapas diferentes do processamento',
    altCelular: 'A mesma tela de cortes aberta no celular',

    fluxo: [
      {
        h: 'Você publica no YouTube',
        p: 'Um vídeo longo: podcast, live, aula, entrevista. Do jeito que você já faz hoje.',
      },
      {
        h: 'O Post Flow faz o trabalho',
        p: 'Detecta, transcreve, escolhe os trechos, corta no vertical e legenda. Sem ninguém clicar em nada.',
      },
      {
        h: 'Sai no seu TikTok',
        p: 'Publicado direto no seu perfil, no horário que você escolheu. Você só acompanha.',
      },
    ],

    comoFuncionaTitulo: 'Quatro etapas. Você participa da primeira.',
    passos: [
      {
        h: 'Conecte o canal',
        p: 'Cole o endereço do seu canal do YouTube. A partir daí o Post Flow percebe sozinho quando você publica um vídeo novo. Também dá para enviar um arquivo do computador ou colar o link de um vídeo específico.',
      },
      {
        h: 'A IA escolhe os trechos',
        p: 'O áudio é transcrito e uma inteligência artificial lê a transcrição inteira procurando os trechos que funcionam sozinhos: começo, gancho e fecho. Você decide entre melhores partes, vídeo inteiro ou uma quantidade fixa de cortes.',
      },
      {
        h: 'Corte, legenda e capa',
        p: 'Cada trecho vira um vídeo vertical 9:16 com legenda queimada, título opcional e capa. No modo manual você ajusta o enquadramento arrastando e escolhe o estilo numa galeria visual.',
      },
      {
        h: 'Publicação no seu horário',
        p: 'Os cortes prontos entram numa fila com legenda editável. Você define os horários do dia, ou deixa o sistema distribuir sozinho, e ele publica. Se preferir revisar antes, mande tudo para uma pasta do seu Google Drive.',
      },
    ],

    recursosOlho: 'O que dá pra fazer',
    recursosTitulo: 'Você manda no resultado, sem abrir editor',
    recursosTexto:
      'O corte automático já sai pronto pra publicar. Mas se você tem um jeito próprio de apresentar, dá pra ajustar cada parte dele.',
    recursos: [
      {
        h: 'Estilo visual do corte',
        p: 'Escolha o estilo da legenda numa galeria: clássica, negrito, discreta ou em balão colorido. O mesmo vale para o título que aparece nos primeiros segundos.',
      },
      {
        h: 'Enquadramento na mão',
        p: 'No modo manual você arrasta o vídeo dentro da moldura vertical e decide o quanto aproximar. O que você vê na tela é exatamente o que sai no corte.',
      },
      {
        h: 'Imagem de fundo',
        p: 'Envie um modelo de fundo com a sua marca e posicione o vídeo em cima dele. Todo corte daquele canal sai com a mesma identidade.',
      },
      {
        h: 'Numeração de série',
        p: 'Ligue o selo "Parte 1, Parte 2" e escolha em que canto da tela ele aparece. Serve pra transformar um vídeo longo numa sequência que prende.',
      },
      {
        h: 'Configuração por canal',
        p: 'Cada canal pode ter o próprio estilo, ou você define um padrão e aplica a todos de uma vez. Quantidade de cortes, duração e qualidade também.',
      },
      {
        h: 'Descrição automática',
        p: 'A legenda de cada corte é escrita pela IA a partir do que foi dito no trecho. Dá pra editar antes de publicar, ou fixar um texto padrão seu.',
      },
      {
        h: 'Um canal, várias contas',
        p: 'Vários canais do YouTube e várias contas do TikTok ao mesmo tempo. Cada canal publica na conta que você vinculou a ele.',
      },
      {
        h: 'Horários que você escolhe',
        p: 'Defina os horários fixos do dia ou deixe o sistema distribuir sozinho. A fila mostra quando cada corte vai sair.',
      },
      {
        h: 'Cópia no Google Drive',
        p: 'Se preferir revisar antes, cada corte pronto pode ir automaticamente para uma pasta do seu Drive, separada por canal.',
      },
    ],

    planosOlho: 'Planos',
    planosTitulo: 'Você paga por minuto de vídeo processado',
    planosTexto:
      'Os minutos renovam toda semana. Quando os downloads saem pela sua própria internet, o custo para nós cai, e essa economia volta para você em forma de minutos bônus.',
    maisEscolhido: 'Mais escolhido',
    porMes: '/mês',
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
    incluiCorte: 'Corte com IA, legenda, capa e agendamento',
    incluiDrive: 'Exportação para o Google Drive',
    comecar: 'Começar',
    notaPlanos:
      'Acabaram os minutos da semana? Dá para comprar um pacote avulso, que não expira. Nada é cobrado além da assinatura sem você autorizar.',

    faqOlho: 'Perguntas frequentes',
    faqTitulo: 'O que costumam perguntar',
    faqRodapeA: 'Ficou alguma dúvida? Escreva para',
    faqRodapeB: 'respondemos',

    finalOlho: 'Comece hoje',
    finalTitulo: 'Cole o link do seu canal e veja o primeiro corte sair',
    finalTexto:
      'A configuração leva alguns minutos. Depois disso, todo vídeo novo do seu canal vira corte publicado sem você tocar em nada.',
    falarComAGente: 'Falar com a gente',
    semFidelidade: 'Sem fidelidade. Cancele quando quiser.',
  },

  perguntas: [
    {
      p: 'O Post Flow publica sozinho no TikTok?',
      r: 'Sim. Você escolhe entre receber o corte como rascunho no aplicativo do TikTok, pra finalizar por lá, ou publicar direto no seu perfil sem abrir o aplicativo. Na publicação direta você define uma vez a privacidade e o que as pessoas podem fazer, e isso vale pra todos os cortes.',
    },
    {
      p: 'Preciso deixar meu computador ligado?',
      r: 'Não. Todo o processamento acontece nos nossos servidores. Existe um programa opcional que faz os downloads saírem pela sua internet e te dá minutos extras no plano, mas ele é opcional e você escolhe se o vídeo espera o seu computador ou não.',
    },
    {
      p: 'Quantos cortes saem de cada vídeo?',
      r: 'Depende do vídeo e do que você configurar: só os melhores trechos, o vídeo inteiro fatiado, ou uma quantidade fixa. A cobrança é por minuto do vídeo original, então a quantidade de cortes não muda o preço.',
    },
    {
      p: 'Em quanto tempo o corte fica pronto?',
      r: 'Depende do tamanho do vídeo e da fila. Um vídeo de 30 minutos costuma levar alguns minutos entre detectar, transcrever, escolher os trechos e renderizar. Você acompanha a porcentagem de cada corte na tela.',
    },
    {
      p: 'O Post Flow coloca marca d’água nos meus vídeos?',
      r: 'Não. Nenhum logotipo nosso é adicionado ao vídeo. As únicas coisas sobrepostas são a legenda e o título gerados a partir do seu próprio áudio, e você pode desligar as duas.',
    },
    {
      p: 'Posso usar mais de um canal e mais de uma conta do TikTok?',
      r: 'Pode. Cada canal do YouTube publica na conta do TikTok que você vincular a ele, e cada conta tem o próprio agendamento. A quantidade depende do plano.',
    },
    {
      p: 'O Post Flow serve para cortar vídeo de outra pessoa?',
      r: 'Não. A ferramenta existe para quem já produz o próprio conteúdo e quer automatizar a etapa de recortar e publicar. Ao usar o serviço você declara que tem direito sobre o material que manda processar. Não moderamos conteúdo antes da publicação e não nos responsabilizamos por uso indevido de material de terceiros.',
    },
    {
      p: 'Preciso dar minha senha do YouTube ou do TikTok?',
      r: 'Não. A conexão com o TikTok e com o Google Drive usa o login oficial de cada plataforma. Você autoriza na tela deles e o Post Flow nunca vê sua senha. Dá para revogar quando quiser, no painel ou nas configurações da sua conta.',
    },
    {
      p: 'O que exatamente vocês acessam no meu Google Drive?',
      r: 'Só a pasta que você escolher para receber os cortes prontos. O Post Flow usa uma permissão que alcança apenas os arquivos que ele próprio cria: o resto do seu Drive continua invisível para nós.',
    },
    {
      p: 'Os cortes ficam guardados para sempre?',
      r: 'Não. Depois de publicados eles são apagados do nosso servidor automaticamente, num prazo que você define. Se quiser guardar, use a exportação para o Google Drive, onde os arquivos ficam com você.',
    },
    {
      p: 'E se eu quiser revisar antes de publicar?',
      r: 'Você pode desligar a postagem automática e publicar manualmente, ou mandar cada corte pronto para uma pasta do seu Google Drive, separada por canal.',
    },
    {
      p: 'Posso cancelar quando quiser?',
      r: `Pode, sem multa e sem falar com ninguém. O acesso continua até o fim do período já pago. Para apagar a conta e todos os dados, é só escrever para ${CONTACT.supportEmail}.`,
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
