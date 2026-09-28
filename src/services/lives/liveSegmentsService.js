// Le as listas que o ffmpeg escreve (video.csv / audio.csv) e registra no
// banco cada pedaco que ficou COMPLETO. O ffmpeg so acrescenta a linha quando
// fecha o arquivo, entao "esta na lista" = "pode ler sem pegar arquivo pela
// metade".
'use strict';

const fs = require('fs');
const path = require('path');
const livesRepository = require('../../repositories/livesRepository');

// Uma linha por pedaco: "seg_000012.ts,120.000000,130.000333". Linha pela
// metade (o ffmpeg escrevendo naquele instante) nao casa e fica pra proxima.
function lerLista(arquivoCsv) {
  let texto;
  try {
    texto = fs.readFileSync(arquivoCsv, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const itens = [];
  for (const linha of texto.split('\n')) {
    const m = linha.trim().match(/^((?:seg|aud)_(\d+)\.(?:ts|ogg)),([\d.]+),([\d.]+)$/);
    if (!m) continue;
    itens.push({ nome: m[1], seq: Number(m[2]), inicio: Number(m[3]), fim: Number(m[4]) });
  }
  return itens;
}

async function sincronizar(sessao) {
  const dir = sessao.dir_path;
  for (const [kind, lista] of [['video', 'video.csv'], ['audio', 'audio.csv']]) {
    const itens = lerLista(path.join(dir, lista)).map((i) => {
      const arquivo = path.join(dir, i.nome);
      let bytes = 0;
      try {
        bytes = fs.statSync(arquivo).size;
      } catch {
        return null; // listado mas ja apagado (limpeza) - nao registra de novo
      }
      return { seq: i.seq, file_path: arquivo, start_offset: i.inicio, end_offset: i.fim, bytes };
    }).filter(Boolean);
    await livesRepository.insertSegments(sessao.id, kind, itens);
  }
  const totais = await livesRepository.sessionTotals(sessao.id);
  await livesRepository.updateSessionProgress(sessao.id, totais);
  return totais;
}

module.exports = { lerLista, sincronizar };
