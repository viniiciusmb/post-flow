// As ferramentas que a IA do suporte pode usar.
//
// Permissoes, em uma frase: a IA LE os dados do cliente que esta logado e
// PEDE duas acoes (devolver os minutos de um video e processar de novo sem
// cobrar), e o servidor decide se cada pedido vale. Nao existe ferramenta pra
// dar minutos avulsos, mudar plano, mexer em preco, ver outro cliente, ler
// configuracao do sistema ou executar consulta livre.
//
// O id do cliente NUNCA e parametro de ferramenta: vem da sessao, preso em
// `contexto` quando a conversa comeca. Mesmo que alguem convenca a IA a pedir
// "o video 123 do cliente 7", nao ha campo onde caber o cliente 7 - e o video
// 123 so e encontrado se for do cliente da sessao.
'use strict';

const supportRepository = require('../../repositories/supportRepository');
const sourceVideosRepository = require('../../repositories/sourceVideosRepository');
const clipsRepository = require('../../repositories/clipsRepository');
const clientCreditsRepository = require('../../repositories/clientCreditsRepository');
const clientSubscriptionsRepository = require('../../repositories/clientSubscriptionsRepository');
const queueService = require('../queueService');
const queuePriorityService = require('../queuePriorityService');
const cicloDeCredito = require('../../lib/cicloDeCredito');
const { diagnosticar } = require('./diagnosticoDeVideo');
const reembolsoDeCreditoService = require('./reembolsoDeCreditoService');

const QUEUE_VIDEO_PROCESSING = 'video-processing';

// Texto que veio de fora (titulo do YouTube, nome de canal) entra na conversa
// como DADO. Corta o tamanho e tira quebras de linha pra ninguem montar um
// "paragrafo de instrucoes" dentro de um titulo de video.
function textoExterno(valor, max = 100) {
  return String(valor || '').replace(/[\r\n\t]+/g, ' ').replace(/[<>]/g, '').slice(0, max);
}

function videoIdValido(entrada) {
  const id = Number(entrada && entrada.video_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

const DEFINICOES = [
  {
    name: 'ver_minha_conta',
    description:
      'Mostra o plano do cliente, quantos minutos ele tem disponíveis agora (cota da semana e avulsos), quando a cota renova e quantos minutos foram usados em vídeos que o próprio cliente apagou. Use quando a pergunta envolver créditos, minutos ou plano.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'listar_meus_videos',
    description:
      'Lista os 15 vídeos mais recentes do cliente com o diagnóstico de cada um (situação, minutos cobrados, cortes prontos, se dá pra devolver os minutos). Use para descobrir de qual vídeo o cliente está falando.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'diagnosticar_video',
    description: 'Diagnóstico detalhado de UM vídeo do cliente: em que etapa falhou, se foi cobrado e se os minutos podem ser devolvidos.',
    input_schema: {
      type: 'object',
      properties: { video_id: { type: 'integer', description: 'O número do vídeo (campo videoId da lista).' } },
      required: ['video_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'devolver_minutos_do_video',
    description:
      'Devolve ao cliente os minutos que um vídeo cobrou, quando o diagnóstico diz podeDevolver=true. O valor devolvido é sempre o que o vídeo cobrou - não é possível escolher outro valor. O servidor confere tudo de novo e pode recusar.',
    input_schema: {
      type: 'object',
      properties: { video_id: { type: 'integer' } },
      required: ['video_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'processar_video_de_novo',
    description:
      'Manda um vídeo que terminou em erro ser processado de novo SEM cobrar outra vez. Só funciona quando o diagnóstico diz podeTentarDeNovoSemCobrar=true. Pergunte ao cliente antes se ele prefere tentar de novo ou receber os minutos de volta - não faça os dois.',
    input_schema: {
      type: 'object',
      properties: { video_id: { type: 'integer' } },
      required: ['video_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'ver_minhas_postagens',
    description:
      'Situação das contas do TikTok do cliente: se estão conectadas, se a postagem automática está ligada, quantos cortes estão na fila, próxima postagem e problemas recentes de publicação.',
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'encaminhar_para_equipe',
    description:
      'Encaminha a conversa para uma pessoa da equipe. Use quando o problema não puder ser resolvido com as outras ferramentas, quando o servidor recusar uma devolução por limite, ou quando o cliente pedir algo fora do que você pode fazer (reembolso em dinheiro, mudar plano, problema de pagamento).',
    input_schema: {
      type: 'object',
      properties: {
        resumo: { type: 'string', description: 'Resumo curto do problema e do que já foi verificado, para a equipe.' },
      },
      required: ['resumo'],
      additionalProperties: false,
    },
  },
].map((d) => ({ ...d, strict: true }));

function diagnosticoDaLinha(linha) {
  const d = diagnosticar(reembolsoDeCreditoService.linhaParaDiagnostico(linha));
  return { ...d, titulo: textoExterno(d.titulo), canal: linha.channel_name ? textoExterno(linha.channel_name, 60) : null };
}

// Categoria em vez do texto cru do erro: a mensagem tecnica pode ter caminho
// de arquivo, resposta de API de terceiro, e nao ajuda o cliente.
function categoriaDoErroDePostagem(mensagem) {
  const m = String(mensagem || '').toLowerCase();
  if (m.includes('spam_risk') || m.includes('too many posts')) return 'O TikTok limitou quantas publicações por dia esse perfil pode receber pelo app. Vale reduzir a quantidade de postagens por dia.';
  if (m.includes('rate_limit')) return 'O TikTok pediu para esperar antes de publicar de novo (limite temporário).';
  if (m.includes('token') || m.includes('scope') || m.includes('authoriz') || m.includes('access_token')) return 'A conexão com o TikTok precisa ser refeita (desconectar e conectar a conta de novo).';
  if (m.includes('duration') || m.includes('excede o maximo')) return 'O corte é mais longo do que esse perfil do TikTok aceita.';
  return 'Falha ao publicar no TikTok.';
}

const EXECUTORES = {
  async ver_minha_conta({ clientUserId }) {
    const assinatura = await clientSubscriptionsRepository.getOrCreate(clientUserId);
    const creditos = await clientCreditsRepository.getOrCreate(clientUserId);
    const apagados = await supportRepository.minutesOnDeletedVideos(clientUserId, { days: 30 });
    const cotaLivre = Math.max(0, Number(creditos.quota_normal) - Number(creditos.used_normal));
    const renova = cicloDeCredito.proximoReset(creditos, assinatura);
    return {
      plano: assinatura.plan_name || 'sem plano',
      situacaoDoPlano: assinatura.status,
      minutosDisponiveis: cotaLivre + Number(creditos.extra_normal),
      cotaDaSemana: { total: Number(creditos.quota_normal), usados: Number(creditos.used_normal), livres: cotaLivre },
      minutosAvulsos: Number(creditos.extra_normal),
      cotaRenovaEm: renova ? renova.toISOString() : null,
      ultimos30Dias_videosApagadosPeloCliente: { videos: apagados.videos, minutosUsados: apagados.minutos },
    };
  },

  async listar_meus_videos({ clientUserId }) {
    const linhas = await supportRepository.listVideosForClient(clientUserId, { limit: 15 });
    return { videos: linhas.map(diagnosticoDaLinha) };
  },

  async diagnosticar_video({ clientUserId }, entrada) {
    const id = videoIdValido(entrada);
    if (!id) return { erro: 'Número de vídeo inválido.' };
    const linha = await supportRepository.findVideoForClient(id, clientUserId);
    if (!linha) return { erro: 'Não encontrei esse vídeo na conta do cliente.' };
    return diagnosticoDaLinha(linha);
  },

  async devolver_minutos_do_video({ clientUserId, conversationId, acoes }, entrada) {
    const id = videoIdValido(entrada);
    if (!id) return { erro: 'Número de vídeo inválido.' };
    const r = await reembolsoDeCreditoService.devolverMinutosDoVideo({ clientUserId, sourceVideoId: id, conversationId });
    if (r.ok) {
      acoes.push({ tipo: 'devolucao', videoId: id, minutos: r.minutos });
      return { devolvido: true, minutos: r.minutos };
    }
    return { devolvido: false, motivo: r.motivo, explicacao: r.mensagem };
  },

  async processar_video_de_novo({ clientUserId, acoes }, entrada) {
    const id = videoIdValido(entrada);
    if (!id) return { erro: 'Número de vídeo inválido.' };
    const linha = await supportRepository.findVideoForClient(id, clientUserId);
    if (!linha) return { erro: 'Não encontrei esse vídeo na conta do cliente.' };
    const d = diagnosticoDaLinha(linha);
    if (!d.podeTentarDeNovoSemCobrar) {
      return { reiniciado: false, explicacao: 'Esse vídeo não pode ser processado de novo sem cobrança por aqui. Se o cliente quiser, ele pode clicar em "Tentar de novo" na tela Cortes (isso cobra os minutos normalmente).' };
    }
    // Mesmo caminho do botao "Tentar de novo" da tela: a cobranca continua
    // 'confirmado', entao o pipeline nao cobra de novo (already_charged).
    await clipsRepository.deleteBySourceVideoId(id);
    const atualizado = await sourceVideosRepository.resetForRetry(id);
    if (!atualizado) return { reiniciado: false, explicacao: 'O vídeo mudou de situação agora há pouco; confira de novo.' };
    const boss = await queueService.getBoss();
    const priority = await queuePriorityService.resolveQueuePriorityForClient(clientUserId);
    await boss.send(QUEUE_VIDEO_PROCESSING, { sourceVideoId: id }, { priority });
    acoes.push({ tipo: 'reprocessamento', videoId: id });
    return { reiniciado: true };
  },

  async ver_minhas_postagens({ clientUserId }) {
    const contas = await supportRepository.postingsSummaryForClient(clientUserId);
    const erros = await supportRepository.recentPostingErrorsForClient(clientUserId);
    return {
      contas: contas.map((c) => ({
        conta: textoExterno(c.display_name, 60),
        conectada: c.is_active,
        postagemAutomaticaLigada: c.auto_post_enabled,
        filaPausada: Boolean(c.paused),
        modoDeHorario: c.mode === 'manual' ? 'horários escolhidos pelo cliente' : 'padrão',
        postagensPorDia: c.videos_per_day,
        cortesNaFila: c.na_fila,
        proximaPostagem: c.proxima,
        ultimaPostagem: c.ultima_postagem,
        publicadosUltimos7Dias: c.postados_7d,
        errosUltimos7Dias: c.erros_7d,
        problemasRecentes: [...new Set(erros.filter((e) => Number(e.tiktok_account_id) === Number(c.id)).map((e) => categoriaDoErroDePostagem(e.message)))],
      })),
    };
  },

  async encaminhar_para_equipe({ clientUserId, conversationId, acoes }, entrada) {
    const resumo = String((entrada && entrada.resumo) || '').slice(0, 1500);
    await supportRepository.escalate(conversationId, clientUserId, resumo);
    acoes.push({ tipo: 'encaminhado' });
    return { encaminhado: true };
  },
};

async function executar(nome, entrada, contexto) {
  const fn = Object.prototype.hasOwnProperty.call(EXECUTORES, nome) ? EXECUTORES[nome] : null;
  if (!fn) return { erro: `Ferramenta desconhecida: ${textoExterno(nome, 40)}` };
  return fn(contexto, entrada || {});
}

module.exports = { DEFINICOES, executar, categoriaDoErroDePostagem, textoExterno };
