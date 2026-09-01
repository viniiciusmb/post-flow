// Qual trilha de áudio baixar quando o vídeo do YouTube tem várias.
//
// Canais grandes publicam o mesmo vídeo dublado em muitos idiomas — o YouTube
// entrega todas como trilhas de áudio do MESMO vídeo, e o yt-dlp as expõe com
// um campo `language` por formato. Verificado num vídeo real do MrBeast Gaming
// em 01/09/2026: 13 trilhas (ar, bn, en, es, hi, id, it, pl, pt, ru, th, tr,
// vi), sendo o inglês a original.
//
// Escolher a trilha certa no DOWNLOAD resolve o pipeline inteiro: o Whisper
// transcreve o áudio que recebeu, e o Claude já escreve título e legenda no
// idioma da transcrição. Não há tradução em lugar nenhum — e é por isso que
// funciona: um corte dublado em português tem áudio E legenda em português,
// ambos vindos da mesma fonte.
'use strict';

// "Deixa o YouTube decidir" — o comportamento de sempre, e o padrão.
const ORIGINAL = 'original';

// Os idiomas oferecidos na tela.
//
// Não é a lista de idiomas do vídeo (isso só dá para saber consultando cada
// vídeo, e a configuração é feita antes de existir vídeo nenhum): é a lista de
// idiomas em que dublagem automática do YouTube costuma existir. Pedir um
// idioma que o vídeo não tem NÃO quebra nada — o download cai no original.
const IDIOMAS = [
  { codigo: ORIGINAL, nome: 'Original do vídeo' },
  { codigo: 'pt', nome: 'Português' },
  { codigo: 'en', nome: 'Inglês' },
  { codigo: 'es', nome: 'Espanhol' },
  { codigo: 'fr', nome: 'Francês' },
  { codigo: 'de', nome: 'Alemão' },
  { codigo: 'it', nome: 'Italiano' },
  { codigo: 'ja', nome: 'Japonês' },
  { codigo: 'ko', nome: 'Coreano' },
  { codigo: 'hi', nome: 'Hindi' },
  { codigo: 'ar', nome: 'Árabe' },
  { codigo: 'ru', nome: 'Russo' },
  { codigo: 'id', nome: 'Indonésio' },
  { codigo: 'tr', nome: 'Turco' },
  { codigo: 'pl', nome: 'Polonês' },
  { codigo: 'th', nome: 'Tailandês' },
  { codigo: 'vi', nome: 'Vietnamita' },
];

const CODIGOS = IDIOMAS.map((i) => i.codigo);

function ehValido(codigo) {
  return CODIGOS.includes(String(codigo || ''));
}

// Normaliza o que o yt-dlp devolveu como idioma da trilha escolhida.
//
// Um vídeo com UMA trilha só não declara idioma nenhum (o yt-dlp imprime "NA"),
// e é isso que 'original' significa: não há escolha a fazer. Tratar esse caso
// como um idioma qualquer criaria duas chaves para o mesmo arquivo e o
// reaproveitamento pararia de funcionar em todo canal de um idioma só — que é
// a maioria deles.
//
// O YouTube também usa códigos regionais ("pt-BR", "en-US"). Guardamos só a
// raiz: pt-BR e pt são a mesma dublagem para o que o sistema faz com ela, e
// separá-las faria o mesmo áudio ser baixado duas vezes.
function normalizar(bruto) {
  const limpo = String(bruto || '').trim().toLowerCase();
  if (!limpo || limpo === 'na' || limpo === 'none' || limpo === 'null' || limpo === ORIGINAL) return ORIGINAL;
  const raiz = limpo.split(/[-_]/)[0];
  return /^[a-z]{2,3}$/.test(raiz) ? raiz : ORIGINAL;
}

// O seletor de formato do yt-dlp.
//
// `[language^=pt]` casa pt, pt-BR e pt-PT de uma vez. A alternativa depois da
// barra é o que faz o pedido nunca virar erro: vídeo sem a trilha pedida cai no
// seletor de sempre. Confirmado nos dois sentidos num vídeo real (pedindo um
// idioma que existe e um que não existe).
//
// A altura máxima entra por parâmetro em vez de ficar escrita aqui: quem manda
// nela é o ytDlpService (480p, decisão de custo do fundador), e duplicar o
// número criaria duas verdades que sairiam de sincronia.
function seletorDeFormato(idioma, alturaMaxima) {
  const padrao = `bestvideo[height<=${alturaMaxima}]+bestaudio/best[height<=${alturaMaxima}]`;
  const codigo = normalizar(idioma);
  if (codigo === ORIGINAL) return padrao;
  return `bestvideo[height<=${alturaMaxima}]+bestaudio[language^=${codigo}]/${padrao}`;
}

// Quais trilhas de áudio um vídeo oferece, lidas do JSON que o yt-dlp já
// devolve. De graça: os formatos vêm no mesmo `--dump-json` que já é feito
// para saber título e duração — não é uma consulta a mais.
//
// Só interessam os formatos de ÁUDIO PURO (acodec presente, sem vídeo): são
// eles que carregam a dublagem. Um formato combinado não declara idioma, e
// contá-lo aqui inventaria uma trilha que não existe.
//
// Vídeo de uma trilha só devolve lista VAZIA, não ['original']: "não há escolha
// a fazer" é diferente de "há uma escolha, e ela se chama original" — é essa
// diferença que decide se a tela mostra ou não o seletor.
function trilhasDisponiveis(formats) {
  if (!Array.isArray(formats)) return [];
  const codigos = new Set();
  for (const f of formats) {
    if (!f || !f.acodec || f.acodec === 'none') continue;
    if (f.vcodec && f.vcodec !== 'none') continue;
    if (!f.language) continue;
    codigos.add(normalizar(f.language));
  }
  codigos.delete(ORIGINAL);
  return [...codigos].sort();
}

// Qual idioma deixar marcado no seletor.
//
// A regra do fundador: quem usa o painel em português vê português marcado por
// padrão, e troca se quiser. O idioma do painel é o melhor palpite que existe
// sobre em que língua a pessoa quer publicar — ela está lendo a tela nele.
//
// Quando o vídeo não tem a língua do painel, marca 'original': marcar uma
// terceira língua qualquer seria escolher pelo cliente sem ele saber.
function sugestaoPara(idiomaDoPainel, trilhas) {
  const alvo = normalizar(idiomaDoPainel);
  if (alvo !== ORIGINAL && Array.isArray(trilhas) && trilhas.includes(alvo)) return alvo;
  return ORIGINAL;
}

// O nome de um código, para a tela poder listar trilhas que não estão em
// IDIOMAS (um canal pode dublar em língua que não previmos). Sem isto, uma
// trilha desconhecida apareceria como um código cru no meio de nomes escritos.
function nomeDoIdioma(codigo) {
  const conhecido = IDIOMAS.find((i) => i.codigo === normalizar(codigo));
  return conhecido ? conhecido.nome : String(codigo || '').toUpperCase();
}

module.exports = {
  ORIGINAL,
  IDIOMAS,
  CODIGOS,
  ehValido,
  normalizar,
  seletorDeFormato,
  trilhasDisponiveis,
  sugestaoPara,
  nomeDoIdioma,
};
