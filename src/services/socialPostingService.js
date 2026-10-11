// Publicação de cortes no Instagram e no Facebook pela Outstand (10/10/2026).
//
// Ciclo de uma postagem (tabela social_postings):
//   pending -> sending -> processing -> posted
//                     \-> pending (falha passageira, com espera)  \-> error
//
// 1. `sending`: manda o arquivo do corte pra Outstand e cria a publicação, pra
//    sair na hora. A chave de idempotência (`pf-social-<id>-<tentativa>`) faz
//    uma repetição - processo que caiu no meio, rede que falhou depois de a
//    Outstand já ter criado - devolver a publicação existente em vez de
//    publicar o vídeo duas vezes no perfil do cliente.
// 2. `processing`: a Outstand aceitou; quem publica é ela, em segundos. A
//    conferência pergunta o resultado a cada rodada.
//
// Roda no video-worker (é ele que lê arquivo de corte em disco), de minuto em
// minuto, e é chamado na hora quando o cliente manda um corte.
'use strict';

const path = require('node:path');
const socialPostingsRepository = require('../repositories/socialPostingsRepository');
const outstandService = require('./outstandService');
const backfillPostingsService = require('./backfillPostingsService');
const errorReportService = require('./errorReportService');
const logger = require('../lib/logger');

// Limites que valem pra Reels nas duas redes pelo nosso produto. A API do
// Instagram aceita até 15 min, mas o Reel do Facebook vai só até 90 s e o
// fundador escolheu 90 s pras duas (08/10/2026).
const DURACAO_MINIMA_S = 3;
const DURACAO_MAXIMA_S = 90;
const LIMITE_LEGENDA = 2200;
const MAX_FALHAS_DE_ENVIO = 4;
const ESPERAS_MIN = [2, 10, 30, 60];
// Depois disso sem resposta da rede, desiste de esperar e mostra pro cliente
// conferir o perfil (não reenvia sozinho: poderia publicar duas vezes).
const ESPERA_MAXIMA_PELA_REDE_H = 6;
const POR_RODADA = 5;

const NOME_DA_REDE = { instagram: 'Instagram', facebook: 'Facebook' };

function chaveDeIdempotencia(p) {
  return `pf-social-${p.id}-${p.tentativa}`;
}

// Erro da Outstand que vale tentar de novo sozinho: rede, tempo esgotado,
// limite de requisições e erro do lado deles. 4xx é pedido nosso recusado -
// repetir dá o mesmo "não".
function passageiro(err) {
  if (!(err instanceof outstandService.OutstandError)) return true;
  const s = Number(err.status) || 0;
  return s === 0 || s === 429 || s >= 500;
}

// Frase que o cliente entende, a partir do erro que a rede devolveu.
function mensagemParaOCliente(rede, erro) {
  const nome = NOME_DA_REDE[rede] || 'A rede';
  const t = String(erro || '').toLowerCase();
  if (/token|expired|reauth|re-auth|reconnect|session has been invalidated|permission/.test(t)) {
    return `${nome} pediu pra conectar a conta de novo. Vá em Redes sociais, desconecte e conecte a conta outra vez.`;
  }
  if (/business|professional|creator|personal account/.test(t)) {
    return `${nome} só aceita publicação por aplicativo em conta profissional (Empresa ou Criador de conteúdo). Mude o tipo da conta no app e tente de novo.`;
  }
  if (/rate limit|too many|limit reached|quota/.test(t)) {
    return `${nome} limitou as publicações desta conta por enquanto (no máximo 100 por dia). Tente de novo mais tarde.`;
  }
  const original = String(erro || 'motivo não informado').slice(0, 300);
  return `${nome} recusou a publicação: ${original}`;
}

async function enviarUma(p) {
  const d = await socialPostingsRepository.detalhesParaEnviar(p.id);
  if (!d || d.disconnected_at) {
    await socialPostingsRepository.marcarErro(p.id, 'A conta foi desconectada antes de a publicação sair.');
    return;
  }
  if (!backfillPostingsService.arquivoUtilizavel(d.caminho)) {
    await socialPostingsRepository.marcarErro(p.id, 'O arquivo deste corte não existe mais (passou do prazo de retenção).');
    return;
  }
  const nomeDoArquivo = `corte-${d.clip_id ? 'yt' : 'live'}-${d.clip_id || d.live_clip_id}${path.extname(d.caminho) || '.mp4'}`;
  try {
    // A mídia enviada numa tentativa é reaproveitada na repetição da MESMA
    // tentativa: a chave de idempotência só devolve a publicação antiga se o
    // corpo for igual, e uma URL de mídia nova mudaria o corpo.
    let midiaUrl = d.outstand_media_url;
    if (!midiaUrl) {
      midiaUrl = await outstandService.enviarMidia(d.caminho, nomeDoArquivo);
      await socialPostingsRepository.guardarMidia(p.id, midiaUrl);
    }
    const post = await outstandService.criarPublicacao({
      accountId: d.outstand_account_id,
      rede: d.network,
      legenda: (d.caption || '').slice(0, LIMITE_LEGENDA),
      midiaUrl,
      nomeDoArquivo,
      chave: chaveDeIdempotencia(d),
    });
    await socialPostingsRepository.marcarEnviada(p.id, post.id);
    logger.info(`Publicacao ${p.id} entregue a Outstand (${d.network}, post ${post.id}).`);
  } catch (err) {
    const falhas = Number(d.falhas_de_envio) + 1;
    if (passageiro(err) && falhas < MAX_FALHAS_DE_ENVIO) {
      const espera = ESPERAS_MIN[Math.min(falhas - 1, ESPERAS_MIN.length - 1)];
      logger.warn(`Publicacao ${p.id} falhou no envio (${err.message}) - nova tentativa em ${espera} min.`);
      await socialPostingsRepository.adiarEnvio(p.id, espera, err.message);
      return;
    }
    logger.error(`Publicacao ${p.id} desistiu no envio: ${err.message}`);
    await socialPostingsRepository.marcarErro(
      p.id,
      passageiro(err)
        ? `Não foi possível falar com o ${NOME_DA_REDE[d.network] || 'serviço'} agora. Mande o corte de novo daqui a pouco.`
        : mensagemParaOCliente(d.network, err.message)
    );
    await errorReportService.report({
      operation: errorReportService.OPERACOES.SOCIAL_POSTING,
      entityType: 'social_posting',
      entityId: p.id,
      clientUserId: d.client_user_id,
      error: err,
    });
  }
}

async function enviarPendentes() {
  for (let i = 0; i < POR_RODADA; i++) {
    const p = await socialPostingsRepository.pegarParaEnviar();
    if (!p) return;
    await enviarUma(p);
  }
}

async function conferirUma(p) {
  let situacao;
  try {
    situacao = await outstandService.situacaoDaPublicacao(p.outstand_post_id, p.outstand_account_id);
  } catch (err) {
    // Consulta é só leitura: falhou, confere na próxima rodada.
    logger.warn(`Nao deu pra conferir a publicacao ${p.id} na Outstand: ${err.message}`);
    return;
  }
  if (situacao.status === 'published') {
    await socialPostingsRepository.marcarPublicada(p.id, situacao.url);
    logger.info(`Publicacao ${p.id} saiu na rede (${situacao.url || 'sem link'}).`);
    return;
  }
  if (situacao.status === 'failed' || situacao.status === 'deleted') {
    const rede = await redeDa(p);
    await socialPostingsRepository.marcarErro(p.id, mensagemParaOCliente(rede, situacao.error || situacao.status));
    logger.error(`Publicacao ${p.id} recusada pela rede: ${situacao.error}`);
    await errorReportService.report({
      operation: errorReportService.OPERACOES.SOCIAL_POSTING,
      entityType: 'social_posting',
      entityId: p.id,
      clientUserId: p.client_user_id,
      error: new Error(situacao.error || `publicacao ${situacao.status}`),
    });
    return;
  }
  const horas = (Date.now() - new Date(p.sent_at).getTime()) / 3600000;
  if (horas > ESPERA_MAXIMA_PELA_REDE_H) {
    await socialPostingsRepository.marcarErro(
      p.id,
      'A rede não confirmou a publicação a tempo. Confira no perfil se o vídeo saiu antes de mandar de novo.'
    );
  }
}

async function redeDa(p) {
  const d = await socialPostingsRepository.detalhesParaEnviar(p.id);
  return d ? d.network : null;
}

async function conferirEmAndamento() {
  for (const p of await socialPostingsRepository.emAndamento()) {
    await conferirUma(p);
  }
}

async function run() {
  if (!outstandService.configurado()) return;
  await socialPostingsRepository.devolverEnviosTravados();
  await enviarPendentes();
  await conferirEmAndamento();
}

module.exports = {
  run,
  enviarPendentes,
  conferirEmAndamento,
  mensagemParaOCliente,
  DURACAO_MINIMA_S,
  DURACAO_MAXIMA_S,
};
