// Publicação de cortes nas redes da Outstand: Instagram, Facebook, Threads,
// LinkedIn, Pinterest, Bluesky e YouTube (10-11/10/2026).
//
// Cada conta tem a sua fila, com as mesmas regras da do TikTok: horário de
// cada corte (scheduled_for), quantos por dia, publicar sozinho e pausa (ver
// socialPostingsRepository e lib/postingSchedule.js).
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
// 2. `processing`: a Outstand aceitou; quem publica é ela. A conferência
//    pergunta o resultado a cada rodada.
//
// Roda no video-worker (é ele que lê arquivo de corte em disco), de minuto em
// minuto, e é chamado na hora quando o cliente usa "Postar agora".
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const socialPostingsRepository = require('../repositories/socialPostingsRepository');
const outstandService = require('./outstandService');
const videoParaRedeService = require('./videoParaRedeService');
const backfillPostingsService = require('./backfillPostingsService');
const errorReportService = require('./errorReportService');
const redesSociais = require('../lib/redesSociais');
const saudeDasContasSociaisService = require('./saudeDasContasSociaisService');
const logger = require('../lib/logger');

const MAX_FALHAS_DE_ENVIO = 4;
const ESPERAS_MIN = [2, 10, 30, 60];
// Depois disso sem resposta da rede, desiste de esperar e mostra pro cliente
// conferir o perfil (não reenvia sozinho: poderia publicar duas vezes).
const ESPERA_MAXIMA_PELA_REDE_H = 6;
// YouTube sem vaga: quantas vezes o corte espera a próxima vaga antes de
// desistir (as vagas abrem a cada 15 min e o dia do Pacífico vira à meia-noite
// deles; 40 esperas cobrem alguns dias).
const MAX_ESPERAS_DE_COTA = 40;
const CODIGOS_DE_COTA = /release_pending|org_limit_reached|daily_limit_reached|provider_quota_exhausted|quota_unavailable/i;

// Mantidos pra quem já usava (feed); valem pro Instagram.
const DURACAO_MINIMA_S = redesSociais.REDES.instagram.duracaoMin;
const DURACAO_MAXIMA_S = redesSociais.REDES.instagram.duracaoMax;

function nomeDa(rede) {
  return (redesSociais.info(rede) || {}).nome || 'A rede';
}

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
  const nome = nomeDa(rede);
  const t = String(erro || '').toLowerCase();
  if (/token|expired|reauth|re-auth|reconnect|session has been invalidated|permission/.test(t)) {
    return `${nome} pediu pra conectar a conta de novo. Vá em Redes sociais, desconecte e conecte a conta outra vez.`;
  }
  if (/business|professional|creator|personal account/.test(t)) {
    return `${nome} só aceita publicação por aplicativo em conta profissional (Empresa ou Criador de conteúdo). Mude o tipo da conta no app e tente de novo.`;
  }
  if (/email.*verif|verif.*email/.test(t)) {
    return `${nome} só deixa publicar vídeo depois que o e-mail da conta é confirmado. Confirme o e-mail nas configurações do ${nome} e tente de novo.`;
  }
  if (/rate limit|too many|limit reached|quota/.test(t)) {
    return `${nome} limitou as publicações desta conta por enquanto. Tente de novo mais tarde.`;
  }
  const original = String(erro || 'motivo não informado').slice(0, 300);
  return `${nome} recusou a publicação: ${original}`;
}

// O bloco de configuração que vai junto pra cada rede (o nome da chave é o da
// rede, exigência da Outstand).
function configDaRede(d) {
  const r = redesSociais.info(d.network) || {};
  const opcoes = d.opcoes || {};
  const titulo = redesSociais.cortarTexto((d.title || d.caption || '').replace(/[<>]/g, '').split('\n')[0], r.tituloMax || 100);
  switch (d.network) {
    case 'facebook':
      // Sem esta marca o vídeo sai como vídeo comum da Página, não como Reel.
      return { facebook: { publishAsReel: true } };
    case 'youtube':
      return {
        youtube: {
          title: titulo || 'Corte',
          isShort: Number(d.duracao) <= r.shortAte,
          privacyStatus: ['public', 'unlisted', 'private'].includes(opcoes.youtubePrivacidade) ? opcoes.youtubePrivacidade : 'public',
          madeForKids: opcoes.youtubeInfantil === true,
        },
      };
    case 'pinterest':
      return { pinterest: { board_id: String(opcoes.pinterestPasta), ...(titulo ? { title: titulo } : {}) } };
    default:
      return {};
  }
}

async function registrarErro(p, err) {
  await errorReportService.report({
    operation: errorReportService.OPERACOES.SOCIAL_POSTING,
    entityType: 'social_posting',
    entityId: p.id,
    clientUserId: p.client_user_id,
    error: err,
  });
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
  // Conferido de novo aqui (a fila já recusa na entrada): o limite pode ter
  // mudado depois que o corte entrou, e mandar só pra rede recusar gasta envio.
  const motivo = redesSociais.motivoDaDuracao(d.network, d.duracao);
  if (motivo) {
    await socialPostingsRepository.marcarErro(p.id, motivo, 'duracao');
    return;
  }
  if (d.network === 'pinterest' && !(d.opcoes && d.opcoes.pinterestPasta)) {
    await socialPostingsRepository.marcarErro(
      p.id,
      'Escolha em qual pasta do Pinterest os cortes vão ser publicados (Redes sociais → esta conta → Configurar) e tente de novo.'
    );
    return;
  }
  const r = redesSociais.info(d.network) || {};
  const nomeDoArquivo = `corte-${d.clip_id ? 'yt' : 'live'}-${d.clip_id || d.live_clip_id}${path.extname(d.caminho) || '.mp4'}`;
  let temporario = null;
  try {
    // A mídia enviada é reaproveitada na repetição da MESMA tentativa: a chave
    // de idempotência só devolve a publicação antiga se o corpo for igual, e
    // uma URL de mídia nova mudaria o corpo.
    let midiaUrl = d.outstand_media_url;
    if (!midiaUrl) {
      const arquivo = await videoParaRedeService.caberEm(d.caminho, r.bytesMax, d.duracao);
      if (arquivo.temporario) temporario = arquivo.caminho;
      midiaUrl = await outstandService.enviarMidia(arquivo.caminho, nomeDoArquivo);
      await socialPostingsRepository.guardarMidia(p.id, midiaUrl);
    }
    const post = await outstandService.criarPublicacao({
      accountId: d.outstand_account_id,
      legenda: redesSociais.cortarTexto(d.caption || '', r.legendaMax),
      midiaUrl,
      nomeDoArquivo,
      chave: chaveDeIdempotencia(d),
      configuracao: configDaRede(d),
    });
    await socialPostingsRepository.marcarEnviada(p.id, post.id);
    logger.info(`Publicacao ${p.id} entregue a Outstand (${d.network}, post ${post.id}).`);
    if (post.avisos && post.avisos.length) {
      logger.warn(`Outstand ignorou campos na publicacao ${p.id}: ${post.avisos.join(' | ')}`);
      await errorReportService.report({
        operation: errorReportService.OPERACOES.SOCIAL_POSTING,
        entityType: 'social_posting',
        entityId: p.id,
        clientUserId: d.client_user_id,
        error: new Error(post.avisos.join(' | ')),
        message: `A Outstand ignorou uma opção enviada pro ${nomeDa(d.network)}: ${post.avisos[0]}`,
      });
    }
  } catch (err) {
    const falhas = Number(d.falhas_de_envio) + 1;
    if (passageiro(err) && falhas < MAX_FALHAS_DE_ENVIO) {
      const espera = ESPERAS_MIN[Math.min(falhas - 1, ESPERAS_MIN.length - 1)];
      logger.warn(`Publicacao ${p.id} falhou no envio (${err.message}) - nova tentativa em ${espera} min.`);
      await socialPostingsRepository.adiarEnvio(p.id, espera, err.message);
      return;
    }
    logger.error(`Publicacao ${p.id} desistiu no envio: ${err.message}`);
    if (!passageiro(err) && saudeDasContasSociaisService.ehFalhaDeAutorizacao(err.message)) {
      await saudeDasContasSociaisService.marcarPrecisaReconectar(p.social_account_id, err.message);
    }
    await socialPostingsRepository.marcarErro(
      p.id,
      passageiro(err)
        ? `Não foi possível falar com o ${nomeDa(d.network)} agora. Tente de novo daqui a pouco.`
        : mensagemParaOCliente(d.network, err.message)
    );
    await registrarErro(d, err);
  } finally {
    if (temporario) fs.rmSync(temporario, { force: true });
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
    await saudeDasContasSociaisService.marcarSaudavel(p.social_account_id);
    logger.info(`Publicacao ${p.id} saiu na rede (${situacao.url || 'sem link'}).`);
    return;
  }
  if (situacao.status === 'failed' || situacao.status === 'deleted') {
    const erro = situacao.error || situacao.status;
    // YouTube sem vaga no limite compartilhado: não é erro do corte, é fila.
    // Espera a vaga e tenta de novo sozinho (decisão do fundador, 11/10/2026).
    if (p.network === 'youtube' && CODIGOS_DE_COTA.test(erro)) {
      if (Number(p.esperas_de_cota) + 1 >= MAX_ESPERAS_DE_COTA) {
        await socialPostingsRepository.marcarErro(
          p.id,
          'O YouTube ficou sem vaga de envio por dias seguidos (o limite é dividido com outros usuários). Tente de novo mais tarde.'
        );
        return;
      }
      const iso = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z/.exec(erro);
      const quando = iso && new Date(iso[0]) > new Date() ? new Date(iso[0]) : new Date(Date.now() + 60 * 60000);
      await socialPostingsRepository.esperarVaga(
        p.id,
        quando,
        'Esperando vaga no YouTube: o limite de envios do dia acabou. Sai sozinho quando abrir vaga.'
      );
      logger.warn(`Publicacao ${p.id} sem vaga no YouTube (${erro.slice(0, 120)}) - nova tentativa em ${quando.toISOString()}.`);
      return;
    }
    await socialPostingsRepository.marcarErro(p.id, mensagemParaOCliente(p.network, erro));
    logger.error(`Publicacao ${p.id} recusada pela rede: ${erro}`);
    // Autorização recusada: a conta inteira precisa reconectar, e a fila dela
    // espera em vez de cada corte seguinte falhar igual.
    if (saudeDasContasSociaisService.ehFalhaDeAutorizacao(erro)) {
      await saudeDasContasSociaisService.marcarPrecisaReconectar(p.social_account_id, erro);
    }
    await registrarErro(p, new Error(erro));
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

async function conferirEmAndamento() {
  for (const p of await socialPostingsRepository.emAndamento()) {
    await conferirUma(p);
  }
}

// Uma rodada: os "Postar agora" primeiro, depois um corte por conta (o que
// venceu o horário, se a conta ainda não bateu o "N por dia").
async function publicarVencidos() {
  for (const conta of await socialPostingsRepository.contasComPostarAgora()) {
    const p = await socialPostingsRepository.pegarSeVenceu(conta.id, { soPostarAgora: true });
    if (p) await enviarUma(p);
  }
  for (const conta of await socialPostingsRepository.contasQuePublicamSozinhas()) {
    try {
      const hoje = await socialPostingsRepository.contarHoje(conta.id, conta.timezone);
      if (hoje >= Number(conta.videos_per_day)) continue;
      const p = await socialPostingsRepository.pegarSeVenceu(conta.id);
      if (p) await enviarUma(p);
    } catch (err) {
      logger.error(`Falha na fila da conta social ${conta.id}:`, err);
    }
  }
}

async function run() {
  if (!outstandService.configurado()) return;
  await socialPostingsRepository.devolverEnviosTravados();
  await publicarVencidos();
  await conferirEmAndamento();
}

module.exports = {
  run,
  publicarVencidos,
  conferirEmAndamento,
  mensagemParaOCliente,
  configDaRede,
  DURACAO_MINIMA_S,
  DURACAO_MAXIMA_S,
};
