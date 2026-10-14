// O manual da Flora tem que falar do painel que o cliente está vendo.
//
// Em 13/10/2026 a Flora mandou clientes para "Publicação, na aba Fila",
// "Cortes → Configurar cortes" e "Canais" - menus que deixaram de existir
// quando o painel novo abriu para todos (12/10). O manual é texto solto, e
// nada quebrava: a Flora só passava a dar instruções que ninguém conseguia
// seguir. Estes testes ligam o manual ao código da tela.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { MANUAL } = require('../../src/services/suporte/conhecimentoDoSistema');
const { DEFINICOES } = require('../../src/services/suporte/ferramentasDoSuporte');
const { COMPANY } = require('../../src/config/constants');

const RAIZ_DA_TELA = path.join(__dirname, '../../web-client/src');

function arquivos(pasta) {
  return fs
    .readdirSync(pasta, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? arquivos(path.join(pasta, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(pasta, e.name)] : []));
}
const codigoDaTela = arquivos(RAIZ_DA_TELA)
  .map((f) => fs.readFileSync(f, 'utf8'))
  .join('\n');

test('todo nome de menu ou botão citado entre aspas no manual existe no painel', () => {
  // A seção de problemas comuns cita frases de CLIENTE ("o vídeo não entrou"),
  // não nomes de tela.
  const parteDaTela = MANUAL.split('## Problemas comuns')[0];
  const citados = [...new Set([...parteDaTela.matchAll(/"([^"\n]{3,70})"/g)].map((m) => m[1]))];
  assert.ok(citados.length > 20, 'a varredura não achou os nomes citados - o formato do manual mudou?');
  const faltando = citados.filter((c) => !codigoDaTela.includes(c));
  assert.deepEqual(faltando, [], `o manual cita nomes que não existem na tela: ${faltando.join(' | ')}`);
});

test('o manual não manda o cliente para os menus antigos', () => {
  assert.doesNotMatch(MANUAL, /(Canais|Cortes|Publicação) →/);
  assert.doesNotMatch(MANUAL, /menus? (Canais|Cortes|Publicação)\b/);
});

test('o manual sabe qual empresa aparece no comprovante', () => {
  assert.ok(MANUAL.includes(COMPANY.legalName));
  assert.ok(MANUAL.includes(COMPANY.cnpj));
});

test('cada atalho que a Flora pode mostrar tem endereço na tela, e nenhum leva às telas antigas', () => {
  const atalho = DEFINICOES.find((d) => d.name === 'mostrar_atalho');
  const destinos = atalho.input_schema.properties.destino.enum;
  for (const antigo of ['cortes', 'canais', 'publicacao']) assert.ok(!destinos.includes(antigo), `"${antigo}" ainda é oferecido`);
  const tela = fs.readFileSync(path.join(RAIZ_DA_TELA, 'pages/ClientSupportPage.tsx'), 'utf8');
  for (const d of destinos) {
    if (d === 'tour_guiado') continue;
    assert.match(tela, new RegExp(`\\b${d}: \\{ rotulo: "flora\\.\\w+", url: "/client`), `atalho "${d}" sem endereço na tela`);
  }
  assert.doesNotMatch(tela, /url: "\/client\/(videos-clips|youtube-channels|tiktok-account)"/);
});
