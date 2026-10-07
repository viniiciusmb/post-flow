// Idioma devolvido pela transcricao -> codigo ISO de 2 letras ("pt").
//
// Cada provedor responde de um jeito: a DeepInfra devolve "pt", a OpenAI
// "portuguese" e a Groq "Portuguese". O resto do sistema espera o codigo: a
// escolha de cortes so escreve "o video e falado em portugues" quando
// reconhece o codigo (com "portuguese" a instrucao nunca era enviada), e a
// Groq/OpenAI RECUSAM o nome por extenso no parametro language - a segunda
// parte de um audio dividido falharia com "unsupported language".
'use strict';

// Os idiomas que o Whisper conhece (lista do proprio modelo).
const CODIGOS = (
  'af am ar as az ba be bg bn bo br bs ca cs cy da de el en es et eu fa fi fo fr gl gu ha haw he hi hr ht hu hy ' +
  'id is it ja jw ka kk km kn ko la lb ln lo lt lv mg mi mk ml mn mr ms mt my ne nl nn no oc pa pl ps pt ro ru ' +
  'sa sd si sk sl sn so sq sr su sv sw ta te tg th tk tl tr tt uk ur uz vi yi yo yue zh'
).split(' ');

const NOME_PARA_CODIGO = (() => {
  const mapa = new Map();
  let nomes = null;
  try {
    nomes = new Intl.DisplayNames(['en'], { type: 'language' });
  } catch {
    nomes = null;
  }
  for (const codigo of CODIGOS) {
    const nome = nomes ? nomes.of(codigo) : null;
    if (nome && nome.toLowerCase() !== codigo) mapa.set(nome.toLowerCase(), codigo);
  }
  // Nomes que o Whisper usa e o Intl escreve diferente.
  mapa.set('castilian', 'es');
  mapa.set('valencian', 'ca');
  mapa.set('flemish', 'nl');
  mapa.set('moldavian', 'ro');
  mapa.set('moldovan', 'ro');
  mapa.set('sinhalese', 'si');
  mapa.set('haitian creole', 'ht');
  mapa.set('pushto', 'ps');
  mapa.set('panjabi', 'pa');
  mapa.set('burmese', 'my');
  mapa.set('mandarin', 'zh');
  mapa.set('cantonese', 'yue');
  mapa.set('javanese', 'jw');
  return mapa;
})();

function codigoDeIdioma(bruto) {
  const s = String(bruto || '').trim().toLowerCase();
  if (!s) return null;
  if (CODIGOS.includes(s)) return s;
  const raiz = s.split(/[-_]/)[0];
  if (CODIGOS.includes(raiz)) return raiz;
  return NOME_PARA_CODIGO.get(s) || null;
}

module.exports = { codigoDeIdioma };
