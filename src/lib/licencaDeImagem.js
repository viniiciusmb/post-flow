// Decide se uma imagem encontrada na web pode entrar num video que vai ser
// publicado.
//
// Esta e a regra mais importante do produto de video narrado, e ela e
// juridica, nao tecnica: "buscar imagem na internet" no sentido de pegar do
// Google Imagens e violacao de direito autoral, e quem leva o strike no
// YouTube e o cliente que publicou. Por isso a imagem so entra quando a
// licenca dela permite EXPLICITAMENTE uso comercial e obra derivada (um video
// e as duas coisas).
//
// A licenca e GRAVADA junto com a imagem (narrated_video_scenes.image_license),
// nunca deduzida depois. Reconstituir "essa imagem podia?" a partir da regra
// ATUAL responderia errado assim que a regra mudasse - a mesma licao de
// auto_skipped_reason e de erroDeProcessamento.
'use strict';

// Aceitas, e por que:
//   pd / pdm  - dominio publico: sem restricao nenhuma
//   cc0       - o autor abriu mao dos direitos
//   by        - exige credito, que o video da na tela de creditos do fim
const ACEITAS = ['pd', 'pdm', 'cc0', 'by'];

// Recusadas, e por que cada uma:
//   by-sa - "share-alike": obrigaria licenciar o VIDEO INTEIRO na mesma
//           licenca. Discutivel para conteudo comercial, e o tipo de duvida
//           que nao se resolve depois que o video ja esta no ar.
//   nc    - proibe uso comercial, e o cliente monetiza.
//   nd    - proibe obra derivada, e o video e exatamente isso.
const RECUSADAS = ['by-sa', 'nc', 'nd', 'sa'];

// Bancos cujo proprio termo de uso ja libera uso comercial sem atribuicao
// obrigatoria. Entram pelo NOME da fonte, nao por codigo de licenca, porque e
// assim que eles se descrevem.
const FONTES_LIVRES = ['pexels', 'unsplash', 'pixabay'];

// Normaliza o que as varias APIs chamam de licenca para um codigo so.
// O Wikimedia manda coisas como "CC BY-SA 4.0", "Public domain", "CC0";
// o Openverse manda "by", "by-sa", "cc0", "pdm".
function normalizar(licenca) {
  const bruto = String(licenca || '').trim().toLowerCase();
  if (!bruto) return '';

  if (bruto.includes('public domain') || bruto === 'pd' || bruto.includes('pd-') || bruto === 'pdm') {
    return 'pd';
  }
  if (bruto.includes('cc0') || bruto.includes('zero')) return 'cc0';

  // "CC BY-SA 4.0" -> "by-sa"; "CC BY 4.0" -> "by"
  const semPrefixo = bruto.replace(/^cc[\s-]*/, '');
  const codigo = semPrefixo.split(/[\s,(]/)[0].replace(/[^a-z-]/g, '');
  return codigo || bruto;
}

// A ordem importa: as variantes RECUSADAS sao testadas antes das aceitas,
// porque "by-sa" contem "by". Testar na ordem inversa aprovaria todo CC BY-SA
// - e essa e exatamente a licenca que nao pode entrar.
function permitida(licenca, { fonte } = {}) {
  if (FONTES_LIVRES.includes(String(fonte || '').toLowerCase())) return true;

  const codigo = normalizar(licenca);
  if (!codigo) return false;

  // Recusa por partes: "by-nc-sa" tem que cair aqui tanto pelo nc quanto pelo sa.
  const partes = codigo.split('-');
  if (RECUSADAS.some((r) => codigo === r || partes.includes(r))) return false;

  return ACEITAS.includes(codigo);
}

// Texto do credito para a tela de creditos no fim do video. Dominio publico e
// CC0 nao exigem atribuicao, mas creditar mesmo assim nao custa nada e evita
// ter que decidir caso a caso.
function credito({ titulo, autor, licenca }) {
  const nome = String(titulo || '').replace(/^File:/, '').replace(/\.(jpg|jpeg|png|webp)$/i, '').trim();
  const partes = [nome];
  if (autor) partes.push(String(autor).replace(/<[^>]*>/g, '').trim());
  if (licenca) partes.push(String(licenca).trim());
  return partes.filter(Boolean).join(' — ');
}

module.exports = { permitida, normalizar, credito, ACEITAS, RECUSADAS, FONTES_LIVRES };
