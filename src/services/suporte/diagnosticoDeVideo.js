// O que aconteceu com um video, em palavras do cliente, e se os minutos dele
// podem ser devolvidos.
//
// Funcao PURA de proposito: recebe o que ja foi lido do banco e decide. E a
// mesma decisao que a tela de suporte mostra e que o reembolso aplica - a IA
// so le o resultado. Se a IA decidisse ("parece justo devolver"), bastaria o
// cliente escrever bem pra ganhar minutos; aqui nada que o cliente escreve
// muda a resposta.
'use strict';

// Um video so devolve minutos se a falha for nossa e o cliente nao recebeu
// nada. O credito e confirmado no fim do DOWNLOAD (ver creditsService), entao
// "cobrado e em erro" sempre quer dizer que quebrou depois de baixar:
// transcricao, escolha dos trechos pela IA ou renderizacao - nenhuma delas
// depende do cliente.
const DIAS_PRA_PEDIR_DEVOLUCAO = 45;
const TENTATIVAS_AUTOMATICAS = 3;

const EM_ANDAMENTO = new Set(['downloading', 'transcribing', 'selecting_clips', 'cutting']);

// Em que etapa parou, pelos carimbos de cada etapa - mais confiavel que ler a
// mensagem de erro, que hoje nem e mais gravada no video (vive em
// system_errors) e as vezes e so "fetch failed".
function etapaDaFalha(video) {
  if (!video.download_completed_at) return 'download';
  if (!video.transcription_completed_at && !video.transcript_reused) return 'transcricao';
  if (!video.clip_selection_completed_at) return 'selecao';
  return 'corte';
}

const ETAPA_EM_PALAVRAS = {
  download: 'ao baixar o vídeo do YouTube',
  transcricao: 'ao transcrever o áudio do vídeo',
  selecao: 'quando a IA escolhia os melhores trechos',
  corte: 'ao montar (renderizar) os cortes',
};

function retryAutomaticoPendente(video) {
  return video.status === 'error' && video.error_transient === true && Number(video.auto_retry_count || 0) < TENTATIVAS_AUTOMATICAS;
}

/**
 * @param {object} p
 * @param {object} p.video        linha de source_videos (do cliente, ja conferido)
 * @param {object|null} p.cobranca linha de credit_transactions do video
 * @param {number} p.cortesProntos
 * @param {number} p.cortesTotal
 * @param {object|null} p.devolucao linha de support_credit_refunds do video
 * @param {Date} [p.agora]
 */
function diagnosticar({ video, cobranca, cortesProntos, cortesTotal, devolucao, agora = new Date() }) {
  const minutosCobrados = cobranca && ['confirmado', 'reservado'].includes(cobranca.status) ? Number(cobranca.minutes_charged) : 0;
  const base = {
    videoId: Number(video.id),
    titulo: String(video.title || '').slice(0, 120),
    status: video.status,
    criadoEm: video.created_at,
    duracaoMinutos: video.duration_seconds ? Math.ceil(Number(video.duration_seconds) / 60) : null,
    cortesProntos,
    cortesTotal,
    minutosCobrados,
    minutosJaDevolvidos: devolucao ? Number(devolucao.minutes) : cobranca && cobranca.status === 'liberado' ? Number(cobranca.minutes_charged) : 0,
  };

  function resultado(situacao, explicacao, extra = {}) {
    return { ...base, situacao, explicacao, podeDevolver: false, motivoSemDevolucao: null, podeTentarDeNovoSemCobrar: false, ...extra };
  }

  if (devolucao) {
    return resultado('ja_devolvido', `Os ${devolucao.minutes} minutos desse vídeo já foram devolvidos.`, {
      motivoSemDevolucao: 'ja_devolvido',
    });
  }

  if (video.status === 'ready' && cortesProntos > 0) {
    return resultado('pronto', `O vídeo foi processado e gerou ${cortesProntos} corte(s). Eles estão na tela Cortes.`, {
      motivoSemDevolucao: 'video_processado',
    });
  }

  if (EM_ANDAMENTO.has(video.status)) {
    return resultado('em_andamento', 'O vídeo está sendo processado agora. Os cortes aparecem na tela Cortes assim que ficarem prontos.', {
      motivoSemDevolucao: 'em_andamento',
    });
  }

  if (video.status === 'detected') {
    const porque = {
      duracao: 'Ele passou do limite de duração que você configurou para o canal, então não entrou sozinho.',
      mais_recente: 'O canal publicou um vídeo mais novo e o sistema pegou o mais recente.',
      aguardando_estilo: 'Ele está esperando você terminar de configurar o estilo do corte e clicar em "Começar a cortar".',
    }[video.auto_skipped_reason] || 'Ele está na fila e ainda não começou a ser processado.';
    return resultado('nao_iniciado', `${porque} Nenhum minuto foi descontado por ele. Dá pra mandar processar pelo botão "Processar agora" na tela Cortes.`, {
      motivoSemDevolucao: 'nada_cobrado',
    });
  }

  if (video.status === 'aguardando_creditos') {
    return resultado('sem_creditos', 'O vídeo está esperando minutos disponíveis. Nada foi descontado por ele. Ele entra na fila sozinho quando a cota renovar ou quando você comprar minutos.', {
      motivoSemDevolucao: 'nada_cobrado',
    });
  }

  if (video.status === 'aguardando_conexao') {
    return resultado('aguardando_conexao', 'O vídeo está esperando o programa da sua conexão ficar online. Nada foi descontado por ele.', {
      motivoSemDevolucao: 'nada_cobrado',
    });
  }

  if (video.status === 'somente_membros') {
    return resultado('somente_membros', 'É um vídeo exclusivo para membros do canal no YouTube, então não dá pra baixar. Se o canal liberar para todos, ele entra na fila sozinho. Nada foi descontado por ele.', {
      motivoSemDevolucao: 'nada_cobrado',
    });
  }

  if (video.status === 'paused') {
    return resultado('pausado', 'O vídeo está pausado. Para continuar de onde parou, clique em "Retomar" na tela Cortes (não cobra de novo).', {
      motivoSemDevolucao: 'pausado',
    });
  }

  if (video.status === 'cancelled') {
    return resultado('cancelado', 'O processamento desse vídeo foi cancelado.', {
      motivoSemDevolucao: minutosCobrados > 0 ? 'cancelado_pelo_cliente' : 'nada_cobrado',
    });
  }

  // Daqui pra baixo: terminou em erro, ou terminou "pronto" sem nenhum corte.
  const falhou = video.status === 'error' || (video.status === 'ready' && cortesProntos === 0);
  if (!falhou) {
    return resultado('desconhecido', 'Não consegui identificar a situação desse vídeo.', { motivoSemDevolucao: 'situacao_desconhecida' });
  }

  const etapa = etapaDaFalha(video);
  const ondeFalhou = video.status === 'ready'
    ? 'O vídeo foi processado, mas nenhum corte foi gerado.'
    : `O processamento falhou ${ETAPA_EM_PALAVRAS[etapa]}.`;

  if (retryAutomaticoPendente(video)) {
    return resultado('vai_tentar_de_novo', `${ondeFalhou} Foi uma falha temporária e o sistema vai tentar de novo sozinho em breve, sem cobrar outra vez.`, {
      etapa,
      motivoSemDevolucao: 'nova_tentativa_automatica',
    });
  }

  if (minutosCobrados === 0) {
    return resultado('falhou_sem_cobranca', `${ondeFalhou} Nenhum minuto foi descontado por esse vídeo.`, {
      etapa,
      motivoSemDevolucao: 'nada_cobrado',
    });
  }

  const idadeDias = (agora.getTime() - new Date(video.created_at).getTime()) / (24 * 60 * 60 * 1000);
  if (idadeDias > DIAS_PRA_PEDIR_DEVOLUCAO) {
    return resultado('falhou_antigo', `${ondeFalhou} Esse vídeo é de mais de ${DIAS_PRA_PEDIR_DEVOLUCAO} dias atrás, então a devolução automática não vale para ele.`, {
      etapa,
      motivoSemDevolucao: 'muito_antigo',
    });
  }

  return resultado('falhou_por_nossa_causa', `${ondeFalhou} A falha foi do nosso lado, e ${minutosCobrados} minuto(s) foram descontados por ele.`, {
    etapa,
    podeDevolver: true,
    // Processar de novo nao cobra outra vez enquanto a cobranca continuar de
    // pe (creditsService devolve 'already_charged'). Depois de devolver, uma
    // nova tentativa cobra normalmente.
    podeTentarDeNovoSemCobrar: video.status === 'error' && cobranca && cobranca.status === 'confirmado',
  });
}

module.exports = { diagnosticar, etapaDaFalha, DIAS_PRA_PEDIR_DEVOLUCAO, TENTATIVAS_AUTOMATICAS };
