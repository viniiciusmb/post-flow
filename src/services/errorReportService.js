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
const logger = require('../lib/logger');

// As operações que o painel sabe tentar de novo. O valor é o que aparece na
// tela; a chave é o que fica gravado.
const OPERACOES = Object.freeze({
  VIDEO_PROCESSING: 'video_processing',
  CHANNEL_CHECK: 'channel_check',
  TIKTOK_POSTING: 'tiktok_posting',
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

async function report({ operation, entityType = null, entityId = null, clientUserId = null, error, message = null }) {
  try {
    return await systemErrorsRepository.record({
      operation,
      entityType,
      entityId,
      clientUserId,
      message: message || resumir(error),
      detail: detalhar(error),
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

module.exports = { report, clear, OPERACOES, ROTULO_OPERACAO, resumir };
