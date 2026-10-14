// O que a Flora sabe sobre o Post Flow: como funciona de ponta a ponta, o que
// o cliente precisa fazer, e as duvidas que aparecem.
//
// Os NOMES de menus e botoes aqui sao os que aparecem na tela (pt.ts) - se um
// botao mudar de nome, mude aqui tambem, senao a Flora manda o cliente
// procurar algo que nao existe.
//
// Nada aqui e segredo: e o mesmo que esta no Tutorial e na pagina de planos.
// Preco e limite de plano NAO ficam escritos aqui; vem do banco (ver
// textoDosPlanos), senao a Flora passaria preco velho no dia em que mudasse.
// O nome da empresa e o CNPJ tambem vem de config/constants (fonte unica).
'use strict';

const subscriptionPlansRepository = require('../../repositories/subscriptionPlansRepository');
const { COMPANY } = require('../../config/constants');

const MANUAL = `
# Como o Post Flow funciona

O Post Flow transforma vídeos do YouTube e lives da Twitch e da Kick em cortes verticais e publica nas redes sociais do cliente, sozinho:
vê que o canal publicou vídeo novo → baixa → transcreve o áudio → a IA escolhe os melhores trechos → corta em formato vertical (9:16) com legenda → coloca na fila de cada conta → publica no horário marcado. Lives: grava enquanto estão no ar, a IA acha os melhores momentos e os cortes aparecem no Feed de cortes.

Redes onde publica: TikTok, Instagram, Facebook, Threads, LinkedIn, Pinterest e Bluesky. (YouTube Shorts aparece na lista de redes, mas está em teste, com pouquíssimas vagas de envio por dia para todo o sistema; não recomende para publicação regular.)

Menus do painel do cliente: Início, Vídeos do YouTube, Lives, Feed de cortes, Redes sociais, Plano e uso, Comissões, Configurações, Tutorial, Flora (esta conversa). Os menus antigos "Canais", "Cortes" e "Publicação" não existem mais; nunca mande o cliente procurar por eles.

## Primeiros passos (nesta ordem — cada um depende do anterior)

1. Redes sociais → botão "Conectar rede": conectar a conta onde os cortes vão ser publicados. A senha é digitada na própria rede, nunca no Post Flow. No TikTok, antes da primeira publicação direto no perfil, é preciso escolher à mão quem pode ver (para crescer, "Todo mundo"; conta privada no TikTok só libera "Só eu"), comentários/dueto/junção, e se é conteúdo de marca (marque só se for publicidade).
2. Vídeos do YouTube → aba "Estilo do corte": como os cortes são escolhidos, quanto duram, legenda da postagem e visual. Há modelos prontos de um clique.
3. Vídeos do YouTube → "Adicionar canal" (endereço com @ ou link completo). Na aba "Monitoramento e destinos" do canal: ligar o monitoramento e marcar em quais contas os cortes desse canal são publicados (pode marcar várias redes).
4. Redes sociais → clique na conta: horários, quantos por dia e a chave de publicar sozinho.

## Como deixar o sistema 100% automático

Checklist — tudo isto precisa estar certo:
- Plano ativo (Plano e uso).
- Conta conectada em Redes sociais e publicando sozinha: no TikTok a chave "Postar automaticamente" e as opções de publicação escolhidas; nas outras redes a chave "Publicar sozinho". Desligada, os cortes ficam esperando na fila.
- Horários definidos na conta (modo "Padrão" ou horários escolhidos) e quantos por dia.
- Estilo do corte configurado (Vídeos do YouTube → aba "Estilo do corte").
- Canal adicionado em Vídeos do YouTube, com o monitoramento ligado e as contas de destino marcadas em "Monitoramento e destinos".
- Créditos disponíveis (Plano e uso): a cota renova toda semana; para nunca parar, dá para comprar créditos avulsos ou autorizar o cartão para cobrar o excedente.
Com isso, o sistema confere o canal a cada 20 minutos, processa o vídeo novo e publica nos horários, sem o cliente precisar entrar no painel. A publicação sai no minuto marcado (pode levar até 1 minuto); entre duas publicações da mesma conta o sistema espera pelo menos 10 minutos, para a rede não marcar como spam.

## Estilo do corte (Vídeos do YouTube → aba "Estilo do corte")

- Aplicar em: só este canal ou todos os canais (o padrão). Modelos prontos mudam o estilo inteiro com um clique; "Salvar como modelo" guarda o estilo para usar em outro canal.
- Três jeitos de escolher os cortes:
  - Melhores partes: a IA decide quantos cortes valem a pena, até um teto por vídeo.
  - Escolher quantidade: a IA entrega exatamente aquele número.
  - Vídeo inteiro em partes: divide o vídeo todo em partes seguidas, pela duração de cada parte ou pela quantidade. "Parte 1, Parte 2..." fica sempre ligado nesse modo.
- Duração dos cortes: curtos rendem mais; longos preservam a resposta inteira (bom para podcast/entrevista).
- Descrição da publicação: escrita pela IA (com hashtags), sempre a mesma, ou nenhuma.
- Visual: "Automático" (padrão) ou "Manual" (fundo, enquadramento arrastando o vídeo dentro da moldura, modelo da legenda, título no começo do corte, numeração "Parte N").
- Idioma do áudio: em canais gringos com dublagem do YouTube, dá para pedir os cortes em português. Se o vídeo não tiver aquela dublagem, sai no idioma original.
- Mudanças valem para os próximos cortes; cortes já prontos não mudam.

## Canais do YouTube (Vídeos do YouTube)

- Os canais ficam no topo; "Envios avulsos" guarda os vídeos mandados por link ou arquivo. Cada canal tem três abas: "Vídeos e cortes", "Estilo do corte" e "Monitoramento e destinos".
- Só vídeos novos: adicionar um canal não baixa o catálogo antigo. No cadastro o sistema oferece cortar o vídeo mais recente; depois, o botão "Cortar último vídeo" faz o mesmo a qualquer momento.
- Monitoramento desligado: nada é baixado nem cobrado daquele canal.
- Freio de fila (ligado por padrão): o canal só pega vídeo novo quando a fila da conta estiver quase vazia, para os cortes não saírem com assunto velho. Quando a fila esvazia, ele pega o vídeo mais recente daquele momento.
- Limite de duração ("Não processar vídeos acima de N minutos"): vídeos maiores ficam com o aviso "Acima do limite de duração" e o botão "Processar agora", sem gastar créditos até o cliente mandar.
- Estreias e lives agendadas só entram quando viram vídeo de verdade. Vídeos exclusivos para membros do canal não podem ser baixados (aparecem com selo próprio) e entram sozinhos se o canal liberar.
- Google Drive (opcional): conectado em Configurações → Integrações; o Post Flow cria uma pasta para o canal e pode enviar cada corte pronto sozinho, ou corte a corte.
- Vídeo avulso: em Vídeos do YouTube → "Envios avulsos", cole o link de um vídeo do YouTube ou envie um arquivo. No envio dá para escolher o idioma do áudio (quando há dublagens), em quais contas publicar e o estilo.

## Situações de um vídeo e o que fazer (aba "Vídeos e cortes")

- Na fila / detectado: esperando para começar. Se estiver parado com o aviso "Acima do limite de duração" ou "Canal pegou um vídeo mais novo" (ou é um envio avulso esperando o cliente terminar de configurar o estilo), use "Processar agora".
- Baixando → Transcrevendo → Escolhendo trechos → Cortando: em andamento, com a etapa e o progresso de cada corte.
- Pronto: os cortes estão prontos e entram na fila das contas marcadas para aquele canal (ou escolhidas no envio avulso).
- Erro: falhas temporárias são tentadas de novo sozinhas (até 3 vezes). "Tentar novamente" reprocessa; se o vídeo já tinha descontado créditos, reprocessar não cobra de novo.
- Pausado: "Pausar" interrompe na hora; "Retomar" continua de onde parou, sem refazer nem cobrar de novo.
- Aguardando crédito: sem créditos suficientes; nada foi descontado. Entra sozinho quando a cota renovar ou o cliente comprar créditos.
- Somente membros: vídeo exclusivo de membros; não dá para baixar.
- Excluir vídeos apaga vídeo e cortes. Créditos de vídeos apagados não voltam (o processamento aconteceu).

## Lives (menu Lives)

- Adicione o canal do streamer da Twitch ou da Kick pelo link ou pelo nome. "Clipar sempre que estiver ao vivo": toda live do canal vira cortes sozinha. Desligado, o cliente usa "Clipar esta live" quando o streamer estiver no ar.
- "Parar de clipar" para na hora e para de gastar crédito. "Clipar este momento" corta os últimos 2 minutos e meio (1 crédito).
- O plano acompanha 1 (Starter), 2 (Pro) ou 3 (Max) canais de live e clipa 1 live por vez. Se duas começarem juntas, a primeira é clipada; quando ela acabar, a outra começa sozinha. Se o servidor estiver cheio, o cartão do canal avisa e a gravação começa quando abrir vaga.
- Cortes de live NÃO entram sozinhos na fila de publicação: aparecem no Feed de cortes, e de lá o cliente escolhe onde publicar. Ficam disponíveis por 3 dias.

## Feed de cortes (menu Feed de cortes)

Todos os cortes do cliente, de vídeos e de lives, um por tela. O primeiro toque liga o som; curtir (ou dois toques) guarda na aba "Gostei"; "Postar" escolhe as contas e o corte entra na fila de cada uma, no próximo horário livre. Filtros: origem (YouTube ou lives), canal e ordem. Cortes já vistos não aparecem de novo.

## Redes sociais e publicação (menu Redes sociais)

- "Conectar rede" abre a lista de redes. Exigências: Instagram precisa ser conta profissional (Criador de conteúdo ou Empresa) e só publica cortes de até 90 segundos; Facebook só publica em Páginas (sai como Reels); Pinterest precisa ter a pasta escolhida, senão o corte não sai.
- O filtro no topo mostra todas as contas ou só as de uma rede. Clique numa conta para ver a fila, os horários e as opções. Cada conta tem a própria fila.
- Horários: "Padrão" (espalha entre 8h e 20h em horas cheias, conforme quantos por dia) ou horários escolhidos. "Usar estes horários em todas as contas" copia a configuração para todas as redes.
- Fila, Publicados e Não saíram (os que deram erro, com o motivo e o botão de tentar de novo). Na fila: "Postar agora", editar a legenda ou tirar o corte da fila. O horário mostrado é o horário real.
- "Postar agora" publica na hora, mas no máximo 10 vezes em 24 horas por conta: muitas publicações seguidas fazem o próprio TikTok limitar o perfil por algumas horas.
- Se a rede pedir para conectar de novo, a conta mostra o aviso e o botão "Reconectar"; reconectar a mesma conta mantém fila e horários.
- Corte publicado é apagado do servidor 3 dias depois (continua publicado na rede). Quem quiser guardar deve baixar ou mandar para o Drive antes.
- Quantas contas cabem: o plano define quantas contas o cliente conecta em cada rede (ver a seção Planos atuais). Precisa de mais numa rede: conta extra em Plano e uso → aba "Comprar".

## Créditos

- 1 minuto de vídeo processado = 1 crédito; 3 minutos de live clipada = 1 crédito; "Clipar este momento" = 1 crédito. O vídeo é descontado quando o download termina, pela duração do vídeo inteiro (arredondada para cima), não pela soma dos cortes.
- Cota semanal do plano: renova a cada 7 dias (Plano e uso mostra quando). A sobra da semana não acumula.
- Créditos avulsos: comprados em Plano e uso → "Comprar", não expiram e são usados depois que a cota acaba. Só com plano ativo.
- Excedente: com o cartão autorizado para isso em Plano e uso, quando a cota acaba o sistema cobra só o que faltou, pelo valor por minuto do plano. Sem cartão autorizado, o vídeo espera em "Aguardando crédito".
- Reprocessar um vídeo que falhou não cobra de novo. Pausar e retomar não cobra de novo.
- Se um vídeo descontou créditos e falhou por problema nosso, o suporte devolve.
- Quando o cliente diz que usou mais créditos do que vê na tela: quase sempre são vídeos que o próprio cliente apagou depois de processados — somem da tela, mas o processamento aconteceu.

## Plano e uso, pagamento e cancelamento

- Abas: Resumo, Comprar, Planos e Faturas. Pagamento por cartão (dentro do próprio site) ou PIX Automático, processados pelo Asaas.
- Quem cobra é a empresa {EMPRESA} (CNPJ {CNPJ}), dona do Post Flow. É esse nome que aparece no comprovante, na fatura do cartão e no extrato do PIX.
- O preço de primeiro mês é promoção de estreia, só para quem nunca teve plano. Depois vale a mensalidade cheia.
- Conexões extras, em qualquer plano, na aba "Comprar": canal extra do YouTube e conta extra no TikTok, Instagram, Facebook, Threads, LinkedIn, Pinterest e Bluesky (o preço aparece na tela). Cada extra é pago na hora e depois cobrado junto com a mensalidade; "Devolver 1" para a cobrança a partir do mês seguinte.
- Cancelar: link "Cancelar plano" no fim da tela Plano e uso, para cartão E para PIX Automático. Ele pede confirmação. O acesso continua até o fim do período já pago e nada mais é cobrado. Se o link não aparecer, o plano já está cancelado (a tela diz até quando vale) ou foi liberado pela equipe sem cobrança.
- Reembolso em dinheiro, troca de cartão com problema, cobrança contestada: só a equipe resolve.

## Conta (menu Configurações)

- Seções: Perfil (nome e e-mail), Segurança (trocar senha; quem entra só pelo Google não tem senha), Integrações (Google Drive), Preferências (tema e idioma) e Excluir conta.
- Excluir a conta: o próprio cliente faz em Configurações → "Excluir conta" (pede a confirmação e a senha). Apaga canais, vídeos, cortes e contas conectadas e cancela a cobrança recorrente; não dá para desfazer. Explique o caminho em vez de encaminhar para a equipe; só encaminhe se o cliente não conseguir.

## Comissões

Todo cliente tem um link de indicação em Comissões. Quem assina por ele gera comissão nas mensalidades pagas, e o saldo pode ser sacado por Pix a partir de um valor mínimo.

## Ajuda dentro do painel

- Tutorial (menu Tutorial): o passo a passo completo, com ilustrações.
- Tour guiado: caixas que apontam os controles de verdade em cada tela, com "Próximo". Ótimo para quem está começando.
- Início: mostra a máquina trabalhando — cada etapa com o vídeo ou a live que está passando por ela, e os cortes indo para a fila de cada conta.

## Problemas comuns e como investigar

- "O vídeo novo do canal não entrou": o monitoramento está ligado? A fila da conta está cheia (freio de fila — é normal)? O vídeo passou do limite de duração? É estreia/live ainda não disponível ou exclusivo de membros? A checagem roda a cada 20 minutos. Se quiser na hora: "Cortar último vídeo".
- "Meu vídeo não foi processado / deu erro": use diagnosticar_video ou listar_meus_videos.
- "Meus créditos sumiram": use ver_minha_conta (inclui créditos de vídeos apagados) e listar_meus_videos.
- "Os cortes não estão sendo postados": use ver_minhas_postagens — conta conectada? publicação automática ligada? fila pausada? horários? limite da rede? O corte sai no minuto marcado (até 1 minuto depois) e com pelo menos 10 minutos de distância do anterior na mesma conta.
- "Saíram poucos cortes": em "Melhores partes" a IA decide quantos valem; para um número exato use "Escolher quantidade". Vídeos curtos rendem menos.
- "Legenda/título no idioma errado": confira o idioma do áudio no "Estilo do corte"; o título sai no idioma falado no vídeo.
`
  .replace('{EMPRESA}', COMPANY.legalName)
  .replace('{CNPJ}', COMPANY.cnpj);

let planosEmCache = { texto: null, em: 0 };
const VALIDADE_DO_CACHE_MS = 10 * 60 * 1000;

function reais(cents) {
  return `R$ ${(Number(cents) / 100).toFixed(2).replace('.', ',')}`;
}

async function textoDosPlanos() {
  if (planosEmCache.texto && Date.now() - planosEmCache.em < VALIDADE_DO_CACHE_MS) return planosEmCache.texto;
  const planos = await subscriptionPlansRepository.listActive();
  const linhas = planos
    .sort((a, b) => Number(a.price_cents) - Number(b.price_cents))
    .map((p) => {
      const estreia = p.first_month_price_cents ? ` (1º mês ${reais(p.first_month_price_cents)} para quem nunca teve plano)` : '';
      const excedente = p.overage_cents_normal ? `; excedente ${reais(p.overage_cents_normal)} por minuto` : '';
      const redes = p.max_contas_por_rede ? `; ${p.max_contas_por_rede} conta(s) em cada uma das outras redes` : '';
      const lives = p.max_canais_de_live ? `; ${p.max_canais_de_live} canal(is) de live` : '';
      return `- ${p.name}: ${reais(p.price_cents)}/mês${estreia}; ${p.weekly_minutes_normal} créditos por semana; ${p.max_youtube_channels} canal(is) do YouTube e ${p.max_tiktok_accounts} conta(s) do TikTok${redes}${lives}${excedente}.`;
    });
  const texto = `## Planos atuais\n\n${linhas.join('\n')}`;
  planosEmCache = { texto, em: Date.now() };
  return texto;
}

module.exports = { MANUAL, textoDosPlanos };
