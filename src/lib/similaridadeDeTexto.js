// Quanto dois textos dizem a mesma coisa, palavra a palavra (0 a 1):
// 1 - distancia de edicao entre as listas de palavras / palavras da
// referencia. Sem acento, sem pontuacao, sem maiuscula - "Tá" e "ta" contam
// como a mesma palavra. Usado pra vigiar a transcricao acelerada das lives.
'use strict';

function palavras(texto) {
  return String(texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function similaridade(referencia, outro) {
  const a = palavras(referencia);
  const b = palavras(outro);
  if (!a.length) return b.length ? 0 : 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    anterior = atual;
  }
  return Math.max(0, 1 - anterior[b.length] / a.length);
}

module.exports = { similaridade, palavras };
