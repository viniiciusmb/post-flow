'use strict';

// Termos de Uso e Política de Privacidade, em português.
//
// Ficam separados do resto do dicionário porque são longos e mudam por outro
// motivo: o texto do produto muda quando a tela muda, o texto legal muda quando
// a lei ou a operação mudam. Misturar os dois faria toda revisão jurídica ter
// que passar por cima da landing.
//
// Os blocos são desenhados por uma view só (views/legal/documento.ejs), que
// entende três tipos: 'p' (parágrafo), 'ul' (lista), 'destaque' (caixa) e
// 'tabela'. O texto aceita HTML — é renderizado com <%- %> — e `{empresa}`,
// `{cnpj}`, `{endereco}`, `{email}`, `{site}` e `{tempo}` são substituídos com
// os dados reais de src/config/constants.js.

module.exports = {
  termos: {
    titulo: 'Termos de Uso',
    atualizado: 'Última atualização: {data}',
    intro:
      'Estes termos valem para o uso do Post Flow, disponível em <a href="{site}">{site}</a>, serviço operado por <strong>{empresa}</strong>, inscrita no CNPJ sob o nº <strong>{cnpj}</strong>, com sede em {endereco}. Ao criar uma conta, você concorda com eles. Se não concordar, não use o serviço.',
    secoes: [
      {
        h: '1. Para que o Post Flow existe',
        blocos: [
          {
            tipo: 'p',
            texto:
              'O Post Flow é uma ferramenta de automação para <strong>criadores de conteúdo que já produzem o próprio material</strong>. Ele resolve uma etapa específica e repetitiva do trabalho de quem publica vídeo longo: recortar os melhores trechos, adaptar para o formato vertical e publicar nas redes curtas. Nada aqui foi feito para reaproveitar material de terceiros.',
          },
          {
            tipo: 'p',
            texto:
              'Na prática, o sistema acompanha canais do YouTube (ou uma pasta do Google Drive) que você indica, baixa os vídeos novos, usa inteligência artificial para escolher os melhores trechos, corta cada trecho no formato vertical com legenda, e publica no seu TikTok ou exporta para o seu Google Drive, conforme você configurar.',
          },
        ],
      },
      {
        h: '2. Sua conta',
        blocos: [
          {
            tipo: 'ul',
            itens: [
              'Você precisa ter 18 anos ou mais.',
              'Os dados de cadastro precisam ser verdadeiros.',
              'Você é responsável por manter sua senha em segredo e por tudo que acontecer na sua conta.',
              'Uma conta é para uma pessoa ou empresa. Não revenda nem compartilhe seu acesso.',
            ],
          },
        ],
      },
      {
        h: '3. Conexão com TikTok e Google',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Ao conectar sua conta do TikTok ou do Google, você autoriza o Post Flow a agir em seu nome dentro dos limites das permissões que a própria plataforma exibe no momento da autorização. Nada além disso. As permissões exatas e o motivo de cada uma estão detalhados na <a href="/privacidade">Política de Privacidade</a>.',
          },
          {
            tipo: 'p',
            texto:
              'Você pode desconectar essas contas a qualquer momento, pelo painel ou direto nas configurações do TikTok/Google. Ao desconectar, apagamos os tokens de acesso e o serviço para de agir naquela conta imediatamente.',
          },
        ],
      },
      {
        h: '4. O conteúdo é seu, e a responsabilidade por ele também',
        blocos: [
          {
            tipo: 'destaque',
            texto:
              '<strong>Este é o ponto mais importante destes termos.</strong> O Post Flow é uma ferramenta automática de edição: ele processa o vídeo que você indicar, sem julgar o conteúdo e sem revisão humana. A responsabilidade legal pelo material processado e publicado é inteiramente sua.',
          },
          { tipo: 'p', texto: 'Ao usar o serviço, você declara e garante que:' },
          {
            tipo: 'ul',
            itens: [
              'É o autor do conteúdo que manda processar, ou tem autorização expressa de quem é o titular dos direitos;',
              'Tem o direito de publicar esse material na plataforma de destino;',
              'O conteúdo não viola direitos autorais, marca, direito de imagem ou de voz de ninguém, nem as regras da plataforma onde será publicado;',
              'O conteúdo não é ilegal, não incita ódio ou violência e não é enganoso.',
            ],
          },
          {
            tipo: 'p',
            texto:
              '<strong>Não nos responsabilizamos por recortes ou publicações feitas a partir de conteúdo de terceiros sem autorização.</strong> A escolha do que entra no sistema é sua e acontece antes de qualquer processamento: o Post Flow não busca, não sugere nem indexa conteúdo alheio, e só acessa o canal ou a pasta que você mesmo apontou. Como não revisamos nem moderamos o material antes da publicação, qualquer reclamação de direito autoral, notificação extrajudicial ou penalidade aplicada pela plataforma de destino recai sobre quem publicou.',
          },
          {
            tipo: 'p',
            texto:
              'Se recebermos denúncia fundamentada de uso indevido, podemos suspender ou encerrar a conta, e cooperaremos com o titular do direito nos termos da lei.',
          },
        ],
      },
      {
        h: '5. Uso proibido',
        blocos: [
          { tipo: 'p', texto: 'Não é permitido usar o Post Flow para:' },
          {
            tipo: 'ul',
            itens: [
              'Processar conteúdo de terceiros sem autorização, inclusive cortar vídeo de outro criador para publicar em perfil próprio;',
              'Automatizar spam, engajamento falso ou qualquer coisa que viole as regras do TikTok;',
              'Tentar burlar limites de plano, quebrar a segurança do sistema ou acessar dados de outros clientes;',
              'Revender o serviço como se fosse seu, sem acordo por escrito.',
            ],
          },
        ],
      },
      {
        h: '6. Planos, créditos e cobrança',
        blocos: [
          {
            tipo: 'ul',
            itens: [
              'O serviço é cobrado por assinatura mensal, e cada plano dá uma quantidade de <strong>minutos de vídeo processado por semana</strong>. Os minutos renovam a cada 7 dias e não acumulam de uma semana pra outra.',
              'Você ganha <strong>minutos bônus</strong> ao usar o programa opcional que faz os downloads saírem pela sua própria internet. Como isso reduz nosso custo, a economia volta pra você.',
              'Se os minutos da semana acabarem, o processamento fica parado até a renovação. Você pode comprar um pacote avulso (que <strong>não expira</strong> e carrega de semana pra semana) ou ligar a cobrança de excedente.',
              '<strong>Nada é cobrado além da assinatura sem você autorizar explicitamente.</strong> A cobrança de excedente é desligada por padrão.',
              'Os minutos são debitados com base na duração do vídeo de origem, e a reserva acontece antes do download começar.',
              'Pagamentos são processados pela Stripe. Não guardamos dados do seu cartão.',
            ],
          },
        ],
      },
      {
        h: '7. Cancelamento',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Você pode cancelar quando quiser, sem multa. O acesso continua até o fim do período já pago, e não fazemos devolução proporcional do período em andamento. Cancelar a assinatura não apaga sua conta. Pra isso, peça a exclusão em <a href="mailto:{email}">{email}</a>.',
          },
        ],
      },
      {
        h: '8. Retenção dos arquivos',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Os arquivos de vídeo ficam no nosso servidor apenas o tempo necessário pra processar e publicar. O vídeo original é apagado assim que os cortes ficam prontos, e os cortes são apagados automaticamente algum tempo depois de publicados (7 dias por padrão, ajustável por você no painel). <strong>Se você quer guardar os cortes, use a exportação pro Google Drive</strong>. Não somos um serviço de armazenamento e não garantimos que o arquivo estará lá depois desse prazo.',
          },
        ],
      },
      {
        h: '9. Disponibilidade e limites do serviço',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Fazemos o possível pra manter tudo no ar, mas o Post Flow depende de serviços de terceiros (YouTube, TikTok, Google, OpenAI, Anthropic, Stripe) e da infraestrutura de hospedagem. Interrupções, mudanças de política ou bloqueios dessas plataformas podem afetar o funcionamento, e isso está fora do nosso controle.',
          },
          {
            tipo: 'p',
            texto:
              'Da mesma forma, a escolha dos trechos é feita por inteligência artificial: o resultado é bom na maior parte das vezes, mas não é garantido nem revisado por uma pessoa. Confira os cortes antes de publicar quando o conteúdo for sensível.',
          },
        ],
      },
      {
        h: '10. Modo de aprovação junto ao TikTok',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Enquanto nosso aplicativo estiver em fase de revisão junto ao TikTok, as publicações podem chegar como <strong>rascunho</strong> na sua caixa de entrada do app do TikTok, exigindo que você abra e confirme. Isso é uma regra da própria plataforma, não uma limitação nossa. Quando a publicação direta for liberada, ela passa a valer automaticamente.',
          },
        ],
      },
      {
        h: '11. Limitação de responsabilidade',
        blocos: [
          {
            tipo: 'p',
            texto:
              'O Post Flow é fornecido "como está". Na medida permitida pela lei brasileira, não nos responsabilizamos por lucros cessantes, perda de audiência, suspensão da sua conta em plataformas de terceiros, ou danos indiretos decorrentes do uso do serviço. Nossa responsabilidade total fica limitada ao valor que você pagou nos 3 meses anteriores ao evento.',
          },
          {
            tipo: 'p',
            texto:
              'Nada nestes termos afasta os direitos que o Código de Defesa do Consumidor garante a você.',
          },
        ],
      },
      {
        h: '12. Suspensão da conta',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Podemos suspender ou encerrar uma conta que descumpra estes termos, especialmente nos casos do item 5. Sempre que possível, avisamos antes e damos chance de corrigir.',
          },
        ],
      },
      {
        h: '13. Mudanças nestes termos',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Se algo mudar, atualizamos a data no topo desta página e avisamos no painel antes de a mudança entrar em vigor. Continuar usando o serviço depois disso significa aceitar a nova versão.',
          },
        ],
      },
      {
        h: '14. Lei aplicável',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Estes termos são regidos pela lei brasileira, e fica eleito o foro do domicílio do consumidor para resolver qualquer disputa.',
          },
        ],
      },
      {
        h: '15. Contato',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Dúvidas sobre estes termos: <a href="mailto:{email}">{email}</a>. Respondemos {tempo}. Veja também a <a href="/contato">página de contato</a>.',
          },
          { tipo: 'p', texto: '{empresa} · CNPJ {cnpj}<br>{endereco}' },
        ],
      },
    ],
  },

  privacidade: {
    titulo: 'Política de Privacidade',
    atualizado: 'Última atualização: {data}',
    intro:
      'Esta página explica, em português claro, quais dados o Post Flow guarda, por que guarda, com quem compartilha e como você apaga tudo. Vale para o site <a href="{site}">{site}</a> e para o programa de computador que oferecemos para download.',
    resumo:
      '<strong>Resumo em três linhas:</strong> Guardamos o mínimo pra o serviço funcionar. Não vendemos seus dados nem usamos pra publicidade. Você pode desconectar suas contas e apagar tudo quando quiser, mandando um e-mail para <a href="mailto:{email}">{email}</a>.',
    secoes: [
      {
        h: '1. Quem é o controlador dos seus dados',
        blocos: [
          {
            tipo: 'p',
            texto:
              'O Post Flow é operado por <strong>{empresa}</strong>, inscrita no CNPJ sob o nº <strong>{cnpj}</strong>, com sede em {endereco}. Para efeitos da Lei Geral de Proteção de Dados (Lei 13.709/2018), essa é a empresa controladora dos dados tratados aqui.',
          },
          {
            tipo: 'p',
            texto:
              'Contato para qualquer assunto de privacidade, incluindo pedidos de acesso, correção ou exclusão: <a href="mailto:{email}">{email}</a>.',
          },
        ],
      },
      {
        h: '2. Para que o serviço existe',
        blocos: [
          {
            tipo: 'p',
            texto:
              'O Post Flow é uma ferramenta de automação para criadores que já produzem o próprio conteúdo. Todo o tratamento de dados descrito abaixo acontece para executar uma tarefa que você pediu: pegar um vídeo <em>que você indicou</em>, cortar e publicar <em>na sua conta</em>. Não buscamos, não indexamos e não sugerimos conteúdo de terceiros, e não usamos seu material para treinar modelo nenhum.',
          },
        ],
      },
      {
        h: '3. Quais dados guardamos e por quê',
        blocos: [
          {
            tipo: 'tabela',
            cabecalho: ['Dado', 'Pra que serve', 'Quanto tempo fica'],
            linhas: [
              [
                'E-mail, nome do negócio e senha (guardada como hash, nunca em texto)',
                'Criar e autenticar sua conta',
                'Enquanto a conta existir',
              ],
              [
                'Tokens de acesso do TikTok e do Google (criptografados no banco)',
                'Publicar no seu TikTok e ler/gravar nas pastas do Drive que você escolheu',
                'Até você desconectar a conta',
              ],
              [
                'Link do canal, título, capa e duração dos vídeos',
                'Detectar vídeo novo e mostrar o andamento no painel',
                'Enquanto a conta existir',
              ],
              ['Arquivo do vídeo baixado', 'Cortar e legendar', 'Apagado assim que os cortes ficam prontos'],
              [
                'Transcrição do áudio',
                'A IA usa pra escolher os trechos e pra gerar a legenda',
                'Enquanto o vídeo existir no seu painel',
              ],
              [
                'Arquivos dos cortes prontos',
                'Publicar no TikTok e exportar pro seu Drive',
                'Apagados automaticamente após a publicação (7 dias por padrão, ajustável por você)',
              ],
              [
                'Histórico de créditos, assinatura e cobranças',
                'Controlar seu saldo de minutos e emitir cobrança',
                'Enquanto a conta existir, e pelo prazo exigido por lei fiscal após o encerramento',
              ],
              [
                'Dados de pagamento (cartão)',
                'Cobrança da assinatura',
                '<strong>Nunca passam pelos nossos servidores</strong>. Ficam só com a Stripe',
              ],
            ],
          },
        ],
      },
      {
        h: '4. O que pedimos ao Google e por quê',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Quando você conecta o Google Drive, a tela de autorização do próprio Google mostra as permissões abaixo. É só isso que pedimos:',
          },
          {
            tipo: 'tabela',
            cabecalho: ['Permissão', 'Por que precisamos'],
            linhas: [
              [
                '<code>drive.readonly</code>',
                'Ler os vídeos da <strong>pasta de origem</strong> que você indicar, pra poder processá-los. Sem essa permissão não conseguimos abrir o arquivo que você quer cortar.',
              ],
              [
                '<code>drive.file</code>',
                'Gravar os cortes prontos na <strong>pasta de destino</strong> que você indicar. Esta permissão dá acesso apenas aos arquivos que o próprio Post Flow cria. Não abre o resto do seu Drive.',
              ],
              [
                '<code>userinfo.email</code>',
                'Identificar qual conta do Google foi conectada, pra mostrar no painel e evitar que você conecte a conta errada sem perceber.',
              ],
            ],
          },
          {
            tipo: 'p',
            texto:
              'Não lemos, listamos nem indexamos arquivos fora das pastas que você escolheu. Não usamos dados do seu Drive pra treinar nenhum modelo de inteligência artificial.',
          },
        ],
      },
      {
        h: '5. O que pedimos ao TikTok e por quê',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Quando você conecta sua conta do TikTok, a tela de autorização do próprio TikTok mostra as permissões abaixo. É só isso que pedimos:',
          },
          {
            tipo: 'tabela',
            cabecalho: ['Permissão', 'Por que precisamos'],
            linhas: [
              [
                '<code>user.info.basic</code>',
                'Ler o nome de usuário e a foto da conta conectada, pra mostrar no painel em qual perfil o corte vai sair. Você pode conectar mais de uma conta, e sem isso não haveria como diferenciar uma da outra.',
              ],
              [
                '<code>user.info.stats</code>',
                'Ler seguidores, curtidas e número de vídeos do perfil, pra exibir no cartão da conta conectada. Serve pra você reconhecer a conta e acompanhar o resultado.',
              ],
              [
                '<code>video.publish</code>',
                'Publicar o corte pronto <strong>direto no seu perfil</strong>, quando você escolhe esse modo. Só acontece depois que você define manualmente a privacidade, o que as pessoas podem fazer e a divulgação comercial.',
              ],
              [
                '<code>video.upload</code>',
                'Enviar o corte pronto <strong>como rascunho</strong> pra caixa de entrada do aplicativo do TikTok, quando você escolhe esse modo. Nesse caso quem publica é você, dentro do aplicativo.',
              ],
            ],
          },
          {
            tipo: 'p',
            texto:
              'Não lemos suas mensagens diretas, não vemos seus vídeos existentes e não publicamos nada fora do fluxo que você configurou. Só enviamos cortes gerados a partir do conteúdo que você mesmo indicou.',
          },
        ],
      },
      {
        h: '6. Serviços de terceiros que usamos',
        blocos: [
          {
            tipo: 'p',
            texto: 'Pra funcionar, o Post Flow envia dados pra estas empresas, e nada além do necessário:',
          },
          {
            tipo: 'ul',
            itens: [
              '<strong>OpenAI (Whisper)</strong>. Recebe o <em>áudio</em> do seu vídeo pra transcrever.',
              '<strong>Anthropic (Claude)</strong>. Recebe a <em>transcrição em texto</em> pra escolher os melhores trechos. Não recebe o vídeo nem o áudio.',
              '<strong>TikTok</strong>. Recebe os cortes que você mandou publicar.',
              '<strong>Google Drive</strong>. Recebe os cortes que você mandou exportar.',
              '<strong>Stripe</strong>. Processa os pagamentos e guarda os dados do cartão.',
              '<strong>Hostinger</strong>. Hospeda o servidor onde o sistema roda.',
            ],
          },
          {
            tipo: 'p',
            texto:
              '<strong>Não vendemos seus dados e não usamos rastreamento publicitário de terceiros.</strong>',
          },
        ],
      },
      {
        h: '7. Cookies',
        blocos: [
          {
            tipo: 'p',
            texto:
              'O Post Flow usa apenas cookies <strong>estritamente necessários</strong> para funcionar. Não há Google Analytics, pixel do Facebook nem qualquer rastreador de publicidade no site. São três:',
          },
          {
            tipo: 'ul',
            itens: [
              '<code>connect.sid</code>. Mantém você logado. Sem ele, você seria deslogado a cada clique.',
              '<code>csrf_token</code>. Protege contra outro site conseguir disparar ações na sua conta sem você saber.',
              '<code>lang</code>. Guarda o idioma que você escolheu, pra o site abrir nele da próxima vez.',
            ],
          },
          {
            tipo: 'p',
            texto:
              'Como são indispensáveis pro serviço, não exigem banner de consentimento. Apagar os cookies do navegador simplesmente encerra sua sessão.',
          },
        ],
      },
      {
        h: '8. O programa de computador (túnel)',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Oferecemos um programinha opcional que fica na bandeja do sistema. Ele serve pra que os downloads dos seus vídeos saiam pela sua própria internet em vez da do nosso servidor. O que resolve bloqueios do YouTube e te dá minutos bônus.',
          },
          {
            tipo: 'p',
            texto:
              'Ele <strong>não lê seus arquivos</strong>, não monitora sua navegação e não coleta nada da sua máquina. Ele só abre um canal de saída de rede que o nosso servidor usa exclusivamente pra baixar os vídeos que você mesmo mandou processar. Você pode fechá-lo ou desinstalá-lo a qualquer momento.',
          },
        ],
      },
      {
        h: '9. Segurança',
        blocos: [
          {
            tipo: 'ul',
            itens: [
              'Todo o tráfego do site é criptografado (HTTPS).',
              'Senhas são guardadas como hash bcrypt. Nem nós conseguimos lê-las.',
              'Tokens do TikTok e do Google são criptografados no banco (AES-256-GCM).',
              'Cada cliente só enxerga os próprios dados; isso é verificado por testes automatizados a cada mudança no sistema.',
              'O banco de dados tem backup diário verificado.',
            ],
          },
        ],
      },
      {
        h: '10. Seus direitos',
        blocos: [
          { tipo: 'p', texto: 'De acordo com a LGPD, você pode a qualquer momento:' },
          {
            tipo: 'ul',
            itens: [
              '<strong>Ver</strong> quais dados temos sobre você;',
              '<strong>Corrigir</strong> dados errados (e-mail e nome dá pra editar direto no painel);',
              '<strong>Apagar</strong> sua conta e todos os dados ligados a ela;',
              '<strong>Revogar</strong> o acesso ao TikTok e ao Google sem apagar a conta;',
              '<strong>Pedir uma cópia</strong> dos seus dados.',
            ],
          },
          {
            tipo: 'p',
            texto:
              'Para qualquer um desses, escreva para <a href="mailto:{email}">{email}</a> usando o e-mail cadastrado na sua conta. Respondemos {tempo}.',
          },
        ],
      },
      {
        h: '11. Como apagamos tudo',
        blocos: [
          { tipo: 'p', texto: 'Ao receber um pedido de exclusão, apagamos:' },
          {
            tipo: 'ul',
            itens: [
              'Seu cadastro (e-mail, senha, nome do negócio);',
              'Todos os canais, vídeos, transcrições e cortes;',
              'Os arquivos de vídeo que ainda estiverem no servidor;',
              'Os tokens de acesso do TikTok e do Google (o acesso é revogado imediatamente);',
              'O histórico de créditos e o vínculo com a Stripe.',
            ],
          },
          {
            tipo: 'p',
            texto:
              'Ficam apenas os registros de cobrança que a legislação fiscal obriga a guardar, e só pelo prazo exigido. <strong>O que já foi publicado no seu TikTok e o que já foi exportado pro seu Google Drive continua com você</strong>. Não temos como (nem devemos) mexer nisso.',
          },
        ],
      },
      {
        h: '12. Menores de idade',
        blocos: [
          {
            tipo: 'p',
            texto:
              'O Post Flow não é destinado a menores de 18 anos. Se identificarmos uma conta nessa situação, ela será encerrada e os dados apagados.',
          },
        ],
      },
      {
        h: '13. Mudanças nesta política',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Se algo mudar, atualizamos a data no topo desta página. Mudanças relevantes serão avisadas no painel antes de entrarem em vigor.',
          },
        ],
      },
    ],
  },
};
