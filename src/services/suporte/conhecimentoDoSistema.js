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
'use strict';

const subscriptionPlansRepository = require('../../repositories/subscriptionPlansRepository');

const MANUAL = `
# Como o Post Flow funciona

O Post Flow transforma vídeos do YouTube em cortes verticais para o TikTok, sozinho:
vê que o canal publicou vídeo novo → baixa → transcreve o áudio → a IA escolhe os melhores trechos → corta em formato vertical (9:16) com legenda → coloca na fila → publica no TikTok no horário marcado. Opcionalmente, envia os cortes prontos para o Google Drive.

Menus do painel do cliente: Início, Canais, Cortes, Publicação, Plano e uso, Comissões, Configurações, Tutorial.

## Primeiros passos (nesta ordem — cada um depende do anterior)

1. Publicação → conectar a conta do TikTok. A senha é digitada no próprio TikTok, nunca no Post Flow. Depois de conectar, o TikTok exige escolher à mão, antes da primeira publicação: quem pode ver (para crescer, "Todo mundo"; conta privada no TikTok só libera "Só eu"), comentários/dueto/junção, e se é conteúdo de marca (marque só se for publicidade). Em seguida, os horários de publicação.
2. Cortes → botão "Configurar cortes": como os cortes são escolhidos, quanto duram, legenda da postagem e estilo visual.
3. Canais → adicionar o canal do YouTube (endereço com @ ou link completo). O canal entra desligado de propósito; ligue a chave do canal quando estiver tudo configurado e escolha em qual conta do TikTok ele publica.

## Como deixar o sistema 100% automático

Checklist — tudo isto precisa estar certo:
- Plano ativo (Plano e uso).
- Conta do TikTok conectada (Publicação), com as opções de publicação escolhidas e a postagem automática ligada (a chave da conta; desligada, os cortes ficam esperando na fila sem publicar).
- Horários definidos (modo "Padrão" ou "Escolher horários") e quantidade de postagens por dia.
- Estilo do corte configurado (Cortes → "Configurar cortes").
- Canal adicionado em Canais, com a chave ligada e vinculado à conta do TikTok.
- Minutos disponíveis: a cota do plano renova toda semana; se quiser que nunca pare, dá para comprar minutos avulsos ou autorizar o cartão para cobrar o excedente (Plano e uso).
Com isso, o sistema confere o canal a cada 20 minutos, processa o vídeo novo e publica nos horários, sem o cliente precisar entrar no painel.

## Configurar cortes (Cortes → "Configurar cortes")

- Onde vale: para todos os canais (padrão) ou só para um canal (exceção). Um canal com estilo próprio pode voltar a seguir a configuração geral pelo próprio painel.
- Três modos de escolher os cortes:
  - IA escolhe as melhores partes: a IA decide quantos cortes valem a pena, até um teto por vídeo.
  - Quantidade fixa: a IA entrega exatamente aquele número de cortes.
  - Cortar o vídeo inteiro em partes: divide o vídeo todo em partes seguidas, por duração média de cada parte ou por número de partes. A numeração "Parte 1, Parte 2..." liga sozinha nesse modo.
- Duração dos cortes: curtos rendem mais no TikTok; longos preservam a resposta inteira (bom para podcast/entrevista).
- Legenda da postagem: "IA escreve" (uma por corte, com hashtags) ou "Sempre a mesma" (texto fixo).
- Estilo visual: "Automático" (padrão: recorte central e legenda clássica) ou "Manual" (enquadramento arrastando, fundo, estilo da legenda queimada, título nos primeiros segundos, numeração "Parte N" com posição e tamanho).
- Idioma do áudio: em canais gringos com dublagem do YouTube, dá para pedir os cortes em português. Se o vídeo não tiver aquela dublagem, sai no idioma original.
- Mudanças valem para os próximos cortes; cortes já prontos não mudam.

## Canais (Canais)

- Só vídeos novos: ativar um canal não baixa o catálogo antigo. No cadastro, o sistema oferece processar o vídeo mais recente na hora; depois, o botão "Cortar último vídeo" faz o mesmo a qualquer momento.
- Freio de fila ("Só pegar vídeo novo quando a fila estiver quase vazia", ligado por padrão): o canal só busca vídeo novo quando restar no máximo 1 corte esperando publicação naquela conta. Enquanto a fila estiver cheia, o canal não busca nada — é de propósito, para publicar assunto fresco. Quando a fila esvazia, ele pega o vídeo mais recente daquele momento.
- Limite de duração ("Não processar vídeos acima de N minutos"): vídeos maiores aparecem em Cortes com o aviso "Acima do limite de duração" e o botão "Processar agora", sem descontar minutos até o cliente mandar.
- Estreias e lives agendadas só entram quando viram vídeo de verdade. Vídeos exclusivos para membros do canal não podem ser baixados (aparecem com selo próprio) e entram sozinhos se o canal liberar.
- Google Drive (opcional): pasta de destino criada pelo Post Flow no Drive do cliente; "Enviar sozinho" manda cada corte pronto, ou envio manual corte a corte / "Exportar todos os cortes pro Drive". A conexão com o Drive fica em Configurações.

## Vídeos avulsos (Cortes)

Dá para colar o link de um vídeo do YouTube ou enviar um arquivo de vídeo. No envio dá para escolher o idioma do áudio (quando o vídeo tem dublagens), em quais contas do TikTok publicar e o estilo do corte.

## Situações de um vídeo na tela Cortes e o que fazer

- Na fila / detectado: esperando para começar. Se estiver parado com aviso ("Acima do limite de duração", "o canal pegou um vídeo mais novo", "esperando configurar o estilo"), use "Processar agora".
- Baixando → Transcrevendo → Escolhendo trechos → Cortando: em andamento, com porcentagem por corte.
- Pronto: os cortes estão prontos e entram na fila de publicação da conta vinculada.
- Erro: algo falhou. Falhas temporárias são tentadas de novo sozinhas (até 3 vezes). O botão "Tentar novamente" reprocessa; se o vídeo já tinha descontado minutos, reprocessar não cobra de novo.
- Pausado: "Pausar" interrompe na hora; "Retomar" continua de onde parou, sem refazer o que estava pronto e sem cobrar de novo.
- Aguardando créditos: sem minutos suficientes; nada foi descontado. Entra sozinho quando a cota renovar ou quando o cliente comprar minutos.
- Somente membros: vídeo exclusivo de membros do canal; não dá para baixar.
- "Excluir selecionados" apaga vídeos e cortes. Minutos de vídeos apagados não voltam (o processamento aconteceu).

## Créditos (minutos)

- O crédito é contado em minutos de vídeo processado. O desconto acontece quando o download termina, pela duração do vídeo inteiro (arredondada para cima), não pela soma dos cortes.
- Cota semanal do plano: renova a cada 7 dias contados do início do ciclo (Plano e uso mostra quando renova). A sobra da semana não acumula.
- Minutos avulsos: comprados em Plano e uso, não expiram e são usados depois que a cota da semana acaba. Só dá para comprar com plano ativo.
- Excedente: com o cartão autorizado para isso em Plano e uso, quando a cota acaba o sistema cobra só os minutos que faltaram, pelo valor por minuto do plano. Sem cartão autorizado, o vídeo espera em "Aguardando créditos".
- Reprocessar um vídeo que falhou ("Tentar novamente") não cobra de novo. Pausar e retomar não cobra de novo.
- Se um vídeo descontou minutos e falhou por problema nosso, o suporte devolve os minutos.
- Por que "usei mais minutos do que vejo na tela"? Quase sempre são vídeos que o próprio cliente apagou depois de processados — eles somem da tela, mas os minutos foram usados.

## Publicação no TikTok (Publicação)

- Duas formas de horário: "Padrão" (o sistema espalha as postagens em horas cheias entre 8h e 20h, de acordo com quantas por dia) ou "Escolher horários" (o cliente define cada horário).
- "Postagens por dia" é o teto daquela conta; o que sobrar espera o dia seguinte.
- A fila publica em ordem; cortes de um mesmo vídeo saem juntos, em sequência. O horário mostrado na fila é o horário real.
- Abas: Fila (esperando), Postados e Erro. Na aba Erro há "Tentar postar agora". Cortes que ficaram fora da fila aparecem no cartão da conta com "Colocar na fila"; postagens canceladas podem voltar com "Voltar pra fila".
- "Postar agora" publica na hora. Cuidado: muitas publicações seguidas em poucos minutos fazem o próprio TikTok limitar o perfil por algumas horas ("muitas postagens pelo app nas últimas 24h"). O ideal é espaçar.
- Corte publicado é apagado do servidor 3 dias depois (o vídeo continua no TikTok). Quem quiser guardar deve baixar ou mandar para o Drive antes.
- Se a conexão com o TikTok expirar, é preciso desconectar e conectar a conta de novo; reconectar a mesma conta mantém fila, horários e canais vinculados.

## Plano e uso, pagamento

- Pagamento por cartão (dentro do próprio site, processado pelo Asaas) ou PIX Automático.
- O preço de primeiro mês é promoção de estreia, só para quem nunca teve plano. Depois vale a mensalidade cheia.
- Conexões extras, em qualquer plano, na aba Comprar de Plano e uso: canal extra do YouTube e conta extra no TikTok, Instagram, Facebook, Threads, LinkedIn, Pinterest e Bluesky (o preço aparece na tela). O YouTube Shorts não vende conta extra. Cada extra é pago na hora e depois cobrado junto com a mensalidade; "Devolver 1" para a cobrança a partir do mês seguinte.
- Cancelar: link "Cancelar plano" no fim da tela Plano e uso (para assinatura no cartão); o acesso continua até o fim do período já pago. PIX Automático se cancela no app do banco.
- Reembolso em dinheiro, troca de cartão com problema, cobrança contestada: só a equipe resolve.

## Comissões

Todo cliente tem um link de indicação em Comissões. Quem assina por ele gera comissão nas mensalidades pagas, e o saldo pode ser sacado por Pix a partir de um valor mínimo.

## Ajuda dentro do painel

- Tutorial (menu Tutorial): o passo a passo completo, com ilustrações.
- Tour guiado: caixas que apontam os controles de verdade em cada tela, com "Próximo". Ótimo para quem está começando.

## Problemas comuns e como investigar

- "O vídeo novo do canal não entrou": o canal está ligado? A fila da conta está com mais de 1 corte esperando (freio de fila — é normal)? O vídeo passou do limite de duração? É estreia/live ainda não disponível ou exclusivo de membros? A checagem roda a cada 20 minutos. Se quiser na hora: "Cortar último vídeo" no cartão do canal.
- "Meu vídeo não foi processado / deu erro": use diagnosticar_video ou listar_meus_videos.
- "Meus créditos sumiram": use ver_minha_conta (inclui minutos de vídeos apagados) e listar_meus_videos.
- "Os cortes não estão sendo postados": use ver_minhas_postagens — conta conectada? postagem automática ligada? fila pausada? horários? limite do TikTok?
- "Saíram poucos cortes": no modo "IA escolhe" a IA decide quantos valem; para um número exato use "Quantidade fixa". Vídeos curtos rendem menos.
- "Legenda/título no idioma errado": confira o idioma do áudio em "Configurar cortes"; o título sai no idioma falado no vídeo.
`;

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
      return `- ${p.name}: ${reais(p.price_cents)}/mês${estreia}; ${p.weekly_minutes_normal} minutos por semana; ${p.max_youtube_channels} canal(is) do YouTube e ${p.max_tiktok_accounts} conta(s) do TikTok${excedente}.`;
    });
  const texto = `## Planos atuais\n\n${linhas.join('\n')}`;
  planosEmCache = { texto, em: Date.now() };
  return texto;
}

module.exports = { MANUAL, textoDosPlanos };
