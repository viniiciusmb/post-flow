'use strict';

// GET /api/client/maquina - o estado da linha de produção do cliente, pra tela
// Início do painel novo. GET /api/admin/maquina - o mesmo, do sistema inteiro,
// pro Início do admin. A tela consulta isto a cada poucos segundos, então
// tudo aqui é leitura barata e nenhuma decisão é tomada.

const maquinaRepository = require('../../../repositories/maquinaRepository');
const metricsRepository = require('../../../repositories/metricsRepository');
const { resolveRange } = require('../../../lib/dateRanges');

// Mesmo padrão da tela de Cortes quando ainda não há histórico.
const DEFAULT_AVG_PROCESSING_SECONDS = 15 * 60;

function capaDoCorte(clipId, liveClipId, temCapa) {
  if (!temCapa) return null;
  if (liveClipId) return `/api/client/lives/cortes/${liveClipId}/arquivo?capa=1`;
  return `/api/client/source-videos/clips/${clipId}/thumbnail`;
}

// Ordem das faixas na tela: a mesma da tela Redes sociais.
const ORDEM_DAS_REDES = ['tiktok', 'instagram', 'facebook', 'youtube', 'threads', 'linkedin', 'pinterest', 'bluesky'];

// A chave de cada faixa da saída - e do destino de cada corte. As duas
// TÊM que sair da mesma regra, senão o corte "voa" pra uma faixa que não é a
// dele. Cliente: uma faixa por conta ("tiktok:12"). Sistema inteiro: uma por
// rede ("tiktok"), senão seriam dezenas de faixas.
function chaveDaFaixa(rede, contaId, porConta) {
  return porConta ? `${rede}:${contaId}` : rede;
}

function montarFilas({ contas, numeros, proximas }, porConta) {
  const faixas = new Map();
  const faixa = (rede, contaId) => {
    const chave = chaveDaFaixa(rede, contaId, porConta);
    if (!faixas.has(chave)) {
      faixas.set(chave, { chave, rede, contas: 0, nomesDasContas: [], avatarUrl: null, naFila: 0, publicandoAgora: 0, publicadosHoje: 0, proximas: [] });
    }
    return faixas.get(chave);
  };
  for (const c of contas) {
    const f = faixa(c.rede, c.id);
    f.contas += 1;
    if (c.nome) f.nomesDasContas.push(c.nome);
    if (!f.avatarUrl) f.avatarUrl = c.avatar;
  }
  for (const n of numeros) {
    const f = faixa(n.rede, n.conta_id);
    f.naFila += n.na_fila;
    f.publicandoAgora += n.publicando;
    f.publicadosHoje += n.publicados_hoje;
  }
  for (const p of proximas) {
    faixa(p.rede, p.conta_id).proximas.push({
      id: Number(p.id),
      quando: p.scheduled_for,
      titulo: p.titulo,
      capaUrl: capaDoCorte(p.clip_id, p.live_clip_id, p.tem_capa),
    });
  }
  const ordem = (r) => {
    const i = ORDEM_DAS_REDES.indexOf(r);
    return i < 0 ? 99 : i;
  };
  return [...faixas.values()]
    .map((f) => ({
      ...f,
      nomesDasContas: f.nomesDasContas.slice(0, 3),
      // Na visão por rede junta as próximas de várias contas: reordena por horário.
      proximas: f.proximas
        .sort((a, b) => (a.quando ? new Date(a.quando).getTime() : Infinity) - (b.quando ? new Date(b.quando).getTime() : Infinity))
        .slice(0, 5),
    }))
    .sort((a, b) => ordem(a.rede) - ordem(b.rede) || a.chave.localeCompare(b.chave));
}

function destinosDoVideo(destinos, porConta) {
  const chaves = (destinos || []).map((d) => {
    const [rede, id] = String(d).split(':');
    return chaveDaFaixa(rede, id, porConta);
  });
  return [...new Set(chaves)];
}

// clientUserId null = o sistema inteiro (Início do admin).
async function montarEstado(clientUserId) {
  const hoje = resolveRange('today');
  const since90d = new Date(Date.now() - 90 * 24 * 3600 * 1000);

  const [canais, etapas, processando, proximos, lives, fila, publicadosHoje, registro, saude, filas] = await Promise.all([
    maquinaRepository.canais(clientUserId),
    maquinaRepository.contagemPorEtapa(clientUserId),
    maquinaRepository.emProcessamento(clientUserId),
    maquinaRepository.proximosNaLinha(clientUserId),
    maquinaRepository.lives(clientUserId),
    maquinaRepository.filaDePublicacao(clientUserId),
    maquinaRepository.publicadosDesde(clientUserId, hoje.since),
    maquinaRepository.registro(clientUserId),
    metricsRepository.pipelineHealthSince(since90d),
    maquinaRepository.filasPorConta(clientUserId, hoje.since),
  ]);

  return {
    escopo: clientUserId ? 'cliente' : 'sistema',
    agora: new Date().toISOString(),
    avgProcessingSeconds: saude.avgProcessingSeconds || DEFAULT_AVG_PROCESSING_SECONDS,
    fontes: {
      canaisAtivos: canais.ativos,
      canaisTotal: canais.total,
      ultimaChecagem: canais.ultima_checagem,
      canais: canais.avatares.map((c) => ({ id: Number(c.id), nome: c.channel_name, avatarUrl: c.avatar_url })),
      livesSeguidas: lives.seguindo,
      lives: lives.canais.map((c) => ({
        id: Number(c.id),
        nome: c.nome,
        avatarUrl: c.profile_image_url,
        plataforma: c.platform,
        aoVivo: c.is_live,
      })),
    },
    etapas: {
      esperando: etapas.esperando,
      baixando: etapas.baixando,
      transcrevendo: etapas.transcrevendo,
      escolhendo: etapas.escolhendo,
      cortando: etapas.cortando + lives.cortesProduzindo,
      bloqueados: etapas.bloqueados,
      pausados: etapas.pausados,
    },
    processando: processando.map((v) => {
      const cortes = Array.isArray(v.cortes) ? v.cortes : [];
      return {
        id: Number(v.id),
        titulo: v.title,
        thumbnailUrl: v.thumbnail_url,
        canal: v.channel_name,
        // Só no Início do admin: lá a linha tem vídeo de todo mundo.
        cliente: clientUserId ? null : v.cliente,
        avulso: v.input_type !== 'channel',
        status: v.status,
        duracaoSegundos: v.duration_seconds,
        iniciadoEm: v.processing_started_at,
        baixadoEm: v.download_completed_at,
        transcritoEm: v.transcription_completed_at,
        escolhidoEm: v.clip_selection_completed_at,
        // Reaproveitado de outro cliente: não baixou nem transcreveu de novo.
        reaproveitado: v.download_egress_type === 'reuse',
        destinos: destinosDoVideo(v.destinos, Boolean(clientUserId)),
        cortes: cortes.map((c) => ({
          id: Number(c.id),
          status: c.s,
          progresso: c.p ?? 0,
          titulo: c.t,
          capaUrl: capaDoCorte(c.id, null, c.capa),
        })),
      };
    }),
    proximosNaLinha: proximos.map((v) => ({
      id: Number(v.id),
      titulo: v.title,
      thumbnailUrl: v.thumbnail_url,
      canal: v.channel_name,
    })),
    aoVivo: lives.aoVivo.map((l) => ({
      id: Number(l.id),
      nome: l.nome,
      avatarUrl: l.profile_image_url,
      plataforma: l.platform,
      titulo: l.stream_title,
      liveDesde: l.live_started_at,
      gravandoDesde: l.gravando_desde,
      segundosGravados: Number(l.recorded_seconds) || 0,
      segundosAnalisados: Number(l.triaged_until) || 0,
      cortesProntos: l.cortes_prontos,
      cortesProduzindo: l.cortes_produzindo,
      segundosTranscritos: Number(l.transcrito_ate) || 0,
      trechosEmAvaliacao: l.candidatos,
      cortes: (l.cortes || []).map((c) => ({
        id: Number(c.id),
        status: c.s,
        progresso: c.p ?? 0,
        inicio: Number(c.i),
        fim: Number(c.f),
        titulo: c.t,
        capaUrl: capaDoCorte(null, c.id, c.capa),
      })),
    })),
    // Cortes de live prontos: esperam no Feed a pessoa escolher o que postar.
    feed: {
      prontos: lives.feed.n,
      ultimos: (lives.feed.ultimos || []).map((c) => ({
        id: Number(c.id),
        titulo: c.title,
        prontoEm: c.ready_at,
        capaUrl: capaDoCorte(null, c.id, c.capa),
      })),
    },
    fila: {
      total: fila.na_fila,
      publicandoAgora: fila.publicando,
      publicadosHoje,
      proximas: fila.proximas.map((p) => ({
        rede: p.rede,
        id: Number(p.id),
        quando: p.scheduled_for,
        conta: p.conta,
        avatarUrl: p.avatar,
        titulo: p.titulo,
        capaUrl: capaDoCorte(p.clip_id, p.live_clip_id, p.tem_capa),
      })),
    },
    filas: montarFilas(filas, Boolean(clientUserId)),
    registro: registro.map((e) => ({
      tipo: e.tipo,
      em: e.em,
      titulo: e.titulo,
      extra: e.extra,
      n: e.n,
    })),
  };
}

function montarResumo(r) {
  return {
    naLinha: r.na_linha,
    esperando: r.esperando,
    livesGravando: r.lives_gravando,
    naFila: r.na_fila,
    publicandoAgora: r.publicando,
    fontes: r.fontes,
  };
}

async function resumo(req, res) {
  res.json(montarResumo(await maquinaRepository.resumo(req.session.user.id)));
}

async function resumoDoSistema(req, res) {
  res.json(montarResumo(await maquinaRepository.resumo(null)));
}

async function estado(req, res) {
  res.json(await montarEstado(req.session.user.id));
}

async function estadoDoSistema(req, res) {
  res.json(await montarEstado(null));
}

module.exports = { estado, estadoDoSistema, resumo, resumoDoSistema, montarEstado, chaveDaFaixa };
