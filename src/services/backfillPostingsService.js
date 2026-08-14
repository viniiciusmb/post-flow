'use strict';

// Cortes que ficaram prontos ANTES de existir conta do TikTok.
//
// O pipeline só cria a postagem no momento em que o corte termina de renderizar
// (ver processVideoJob). Se naquele instante o cliente ainda não tinha conta
// conectada, o corte fica pronto e simplesmente nunca entra em fila nenhuma -
// e conectar a conta depois não voltava atrás pra buscá-lo.
//
// Na prática isso é a ordem natural de quem está começando: a pessoa cadastra o
// canal, deixa o sistema cortar, e só depois conecta o TikTok. Ela então abre a
// fila esperando ver os cortes prontos, e encontra uma tela vazia sem nenhuma
// explicação do porquê.
//
// Isto roda ao conectar (ou reconectar) uma conta e enfileira o que ficou pra
// trás. Só pega corte que nunca foi pra fila de conta NENHUMA: um corte já
// postado, já cancelado ou já esperando em outra conta não é "esquecido", e
// duplicá-lo seria pior que o problema original.

const fs = require('fs');
const pool = require('../db/pool');
const postingsRepository = require('../repositories/postingsRepository');
const logger = require('../lib/logger');

// Cortes prontos, com arquivo em disco, do cliente, que nunca viraram postagem.
//
// owner_client_user_id é o dono real nos dois casos (vídeo avulso e vídeo vindo
// de canal) desde a migration 042, e é NOT NULL - não precisa de JOIN em
// youtube_channels pra descobrir de quem é o corte.
//
// "Nunca virou postagem" cobre mais do que parece: o corte pode não ter nem
// linha em `videos` (nunca houve conta), ou ter a linha e nenhuma postagem
// (a conta foi desconectada antes de postar). Os dois contam como órfão.
//
// Exige local_clip_path porque enfileirar um corte cujo arquivo a retenção já
// apagou só encheria a fila de postagem que vai falhar.
async function listarCortesOrfaos(clientUserId) {
  const { rows } = await pool.query(
    `SELECT c.id, c.title, c.description, c.local_clip_path
       FROM clips c
       JOIN source_videos sv ON sv.id = c.source_video_id
       LEFT JOIN videos v ON v.clip_id = c.id
      WHERE c.status = 'ready'
        AND c.local_clip_path IS NOT NULL
        AND sv.owner_client_user_id = $1
        AND NOT EXISTS (SELECT 1 FROM postings p WHERE p.video_id = v.id)
      ORDER BY c.id ASC`,
    [clientUserId]
  );
  return rows;
}

// Garante a linha em `videos` (o arquivo publicável) e devolve o id. O corte
// pode já ter uma - quem tinha conta antes, desconectou e voltou.
async function garantirVideo(clip) {
  const { rows } = await pool.query(
    `INSERT INTO videos (source_type, clip_id, filename, mime_type)
     VALUES ('youtube_clip', $1, $2, 'video/mp4')
     ON CONFLICT (clip_id) WHERE clip_id IS NOT NULL DO UPDATE SET filename = EXCLUDED.filename
     RETURNING id`,
    [clip.id, clip.title]
  );
  return rows[0].id;
}

/**
 * Enfileira, na conta recém-conectada, os cortes prontos que ficaram órfãos.
 *
 * Não liga a postagem automática: a postagem entra como pendente e o job de
 * publicação continua respeitando o auto_post_enabled da conta (desligado por
 * padrão). O efeito é o cliente VER os cortes na fila e poder publicar quando
 * quiser - não um monte de vídeo antigo saindo sozinho no perfil dele.
 *
 * Nunca derruba a conexão: se algo falhar aqui, a conta já está conectada e o
 * pior caso é a fila continuar como estava.
 */
// Caminho gravado no banco nao e o mesmo que arquivo existindo em disco.
// Renderizacao interrompida no meio deixa um arquivo de 0 byte, e a retencao
// apaga o arquivo sem limpar a coluna - nos dois casos o corte parece pronto e
// nao e. Enfileirar um desses enche a fila com algo que abre a previa vazia e
// falha na publicacao (aconteceu de verdade, 2026-08-15).
function arquivoUtilizavel(caminho) {
  try {
    return fs.statSync(caminho).size > 0;
  } catch {
    return false;
  }
}

async function enfileirarCortesProntos({ clientUserId, tiktokAccountId }) {
  let enfileirados = 0;
  let ignorados = 0;
  try {
    const cortes = await listarCortesOrfaos(clientUserId);
    for (const clip of cortes) {
      if (!arquivoUtilizavel(clip.local_clip_path)) {
        ignorados++;
        continue;
      }
      const videoId = await garantirVideo(clip);
      const criado = await postingsRepository.createIfNotExists({
        videoId,
        tiktokAccountId,
        caption: clip.description,
      });
      if (criado) enfileirados++;
    }

    if (enfileirados > 0) {
      logger.info(
        `Conta TikTok ${tiktokAccountId}: ${enfileirados} corte(s) que estavam prontos sem conta foram pra fila.`
      );
    }
    if (ignorados > 0) {
      logger.warn(
        `Conta TikTok ${tiktokAccountId}: ${ignorados} corte(s) marcados como prontos foram ignorados - o arquivo nao existe mais ou esta vazio.`
      );
    }
  } catch (err) {
    logger.error(
      `Nao consegui enfileirar os cortes prontos na conta TikTok ${tiktokAccountId} (a conexao continua valendo):`,
      err.message
    );
  }
  return enfileirados;
}

module.exports = { enfileirarCortesProntos, listarCortesOrfaos };
