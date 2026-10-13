// Ponto único por onde toda falha de operação passa.
//
// Antes cada falha ia pra um lugar diferente: log do servidor, coluna de erro
// numa tabela, mensagem técnica na tela do cliente. Agora tudo cai no painel
// de erros do admin, e a tela do cliente só diz que deu problema.
//
// Regra de ouro deste arquivo: registrar erro NUNCA pode derrubar quem chamou.
// Se o próprio registro falhar, ele loga e engole - senão um problema no painel
// de erros viraria uma falha em cima da falha, e aí sim a operação original se
// perderia.
'use strict';

const systemErrorsRepository = require('../repositories/systemErrorsRepository');
const contextoDeErro = require('../lib/contextoDeErro');
const logger = require('../lib/logger');

// As operações que o painel sabe tentar de novo. O valor é o que aparece na
// tela; a chave é o que fica gravado.
const OPERACOES = Object.freeze({
  VIDEO_PROCESSING: 'video_processing',
  CHANNEL_CHECK: 'channel_check',
  TIKTOK_POSTING: 'tiktok_posting',
  SOCIAL_POSTING: 'social_posting',
  SOCIAL_CONTA: 'social_conta',
  SOCIAL_CONEXAO: 'social_conexao',
  TIKTOK_CONEXAO: 'tiktok_conexao',
  LIVES: 'lives',
  LIVES_CAPACIDADE: 'lives_capacidade',
  LIMITE_DO_PLANO: 'limite_do_plano',
  ERRO_SERVIDOR: 'erro_servidor',
  ERRO_TELA: 'erro_tela',
  PAINEL_NOVO_API: 'painel_novo_api',
  PAINEL_NOVO_TELA: 'painel_novo_tela',
  DRIVE_EXPORT: 'drive_export',
  DRIVE_DISCOVERY: 'drive_discovery',
  CREDIT_CHARGE: 'credit_charge',
  TUNNEL_TEST: 'tunnel_test',
  BACKUP: 'backup',
  OUTRO: 'outro',
});

const ROTULO_OPERACAO = Object.freeze({
  video_processing: 'Processamento de vídeo',
  channel_check: 'Checagem de canal',
  tiktok_posting: 'Publicação no TikTok',
  social_posting: 'Publicação nas outras redes',
  social_conta: 'Conta de rede social',
  social_conexao: 'Conexão de rede social',
  tiktok_conexao: 'Conexão do TikTok',
  lives: 'Lives',
  lives_capacidade: 'Lives sem vaga no servidor',
  limite_do_plano: 'Cliente bateu no limite do plano',
  erro_servidor: 'Erro no servidor',
  erro_tela: 'Erro na tela (navegador do cliente)',
  painel_novo_api: 'Erro no servidor (telas em teste)',
  painel_novo_tela: 'Erro na tela (telas em teste)',
  drive_export: 'Envio pro Google Drive',
  drive_discovery: 'Leitura da pasta do Drive',
  credit_charge: 'Cobrança de crédito',
  tunnel_test: 'Teste de conexão',
  backup: 'Backup do banco',
  outro: 'Outra operação',
});

// Transforma o erro cru numa frase que o dono do sistema entende de relance.
// A mensagem técnica continua guardada em `detail` - só não é ela que aparece
// na lista.
function resumir(err) {
  const bruto = String((err && err.message) || err || 'Erro sem mensagem.');

  // Casos que aparecem com frequência ganham tradução; o resto passa cortado.
  if (/Sign in to confirm|not a bot/i.test(bruto)) {
    return 'O YouTube bloqueou o download achando que era robô.';
  }
  if (/did not authorize the scope/i.test(bruto)) {
    return 'O TikTok recusou a publicação por falta de permissão no aplicativo.';
  }
  // Este erro NAO se resolve mexendo no sistema: a TikTok so libera publicacao
  // direta no perfil depois de auditar o aplicativo. Sem auditoria, o unico
  // caminho que funciona e o rascunho. A mensagem crua da TikTok e um link
  // generico de diretrizes, que nao diz nada disso - e ficou horas parecendo
  // bug nosso em producao (2026-08-14).
  if (/unaudited_client_can_only_post_to_private_accounts/i.test(bruto)) {
    return 'O TikTok ainda não liberou a publicação direta no perfil para este aplicativo (falta a auditoria deles). Enquanto isso, mude a conta para o modo "rascunho": o corte chega pronto no seu TikTok e você só toca em publicar.';
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up/i.test(bruto)) {
    return 'Não consegui me conectar ao serviço externo.';
  }
  if (/ENOSPC|no space left/i.test(bruto)) {
    return 'Acabou o espaço em disco no servidor.';
  }
  if (/invalid_grant|token.*(expirad|invalid)/i.test(bruto)) {
    return 'A autorização da conta expirou e precisa ser reconectada.';
  }
  if (/Playlists that require authentication|skip=authcheck/i.test(bruto)) {
    return 'Não consegui ler a lista de vídeos do canal no YouTube.';
  }
  if (/HTTP Error 429|Too Many Requests/i.test(bruto)) {
    return 'Fizemos pedidos demais e o serviço pediu pra esperar.';
  }
  if (/ffmpeg|Conversion failed/i.test(bruto)) {
    return 'A montagem do vídeo falhou na hora de renderizar.';
  }
  return bruto.slice(0, 200);
}

function detalhar(err) {
  if (!err) return null;
  const partes = [];
  if (err.message) partes.push(err.message);
  if (err.stack && err.stack !== err.message) partes.push(err.stack);
  if (!partes.length) partes.push(String(err));
  // 8000 caracteres cobre stack + saída de ferramenta externa sem inchar o
  // banco com megabyte de log.
  return partes.join('\n\n').slice(0, 8000);
}

// `contexto`: tudo que ajuda a investigar (conta, rede, arquivo, etapa,
// tentativa, resposta da API). Vai limpo de segredos pra system_error_events,
// uma linha por ocorrência - ver lib/contextoDeErro.
async function report({ operation, entityType = null, entityId = null, clientUserId = null, error, message = null, contexto = null }) {
  try {
    return await systemErrorsRepository.record({
      operation,
      entityType,
      entityId,
      clientUserId,
      message: message || resumir(error),
      detail: detalhar(error),
      contexto: contextoDeErro.montar(contexto, error),
    });
  } catch (falhaAoRegistrar) {
    logger.error('Nao consegui registrar um erro no painel de erros:', falhaAoRegistrar.message);
    return null;
  }
}

// Chamado quando a mesma coisa volta a funcionar. Fecha o erro sozinho, pra
// lista não encher de problema que já passou.
async function clear(operation, entityType, entityId) {
  try {
    return await systemErrorsRepository.resolveByEntity(operation, entityType, entityId);
  } catch (err) {
    logger.error('Nao consegui fechar um erro resolvido:', err.message);
    return 0;
  }
}

// Desde 12/10/2026 (painel novo aberto pra todos) este grupo virou "Limites e
// vagas": avisos que não são defeito. O resto vai pra "Erros".
// Erros das novidades que ainda estão em teste com o admin e a Rise Style
// (painel novo). Ficam numa tela própria ("Erros em teste") pra não se
// misturarem com os erros do que todo cliente já usa (pedido do fundador em
// 12/10/2026). Quando uma novidade abrir pra todos, a operação dela sai daqui.
const OPERACOES_EM_TESTE = Object.freeze(['limite_do_plano', 'lives_capacidade']);

module.exports = { report, clear, OPERACOES, ROTULO_OPERACAO, OPERACOES_EM_TESTE, resumir };
