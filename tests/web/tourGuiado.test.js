// O tour guiado roda inteiro no navegador, mas depende de UMA coisa que o
// servidor entrega: os elementos que ele acende existem nas telas montadas.
//
// Um passo cujo `data-tour` não existe mais não quebra nada visivelmente — a
// caixa só aparece centralizada, sem apontar pra lugar nenhum. É a falha que
// mais passa despercebida num tour, e é o que este teste pega: se alguém
// renomear ou remover um marcador, o teste cai antes de ir pro ar.
'use strict';

const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const RAIZ = path.join(__dirname, '../../web-client/src');

function lerTudo(dir) {
  const saida = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const caminho = path.join(dir, item.name);
    if (item.isDirectory()) saida.push(...lerTudo(caminho));
    else if (/\.(tsx|ts)$/.test(item.name)) saida.push({ caminho, texto: fs.readFileSync(caminho, 'utf8') });
  }
  return saida;
}

const ARQUIVOS = lerTudo(RAIZ);
const TODO_O_CODIGO = ARQUIVOS.map((a) => a.texto).join('\n');

// Os alvos declarados no roteiro do tour.
//
// Lê só os campos `alvo:` e `abrir:`, não o arquivo inteiro: o comentário do
// topo cita `data-tour="..."` como exemplo, e varrer tudo capturava o "..."
// como se fosse um alvo de verdade.
const roteiro = fs.readFileSync(path.join(RAIZ, 'content/tour.ts'), 'utf8');
const ALVOS = [...roteiro.matchAll(/(?:alvo|abrir): '\[data-tour="([^"]+)"\]'/g)].map((m) => m[1]);

test('o roteiro do tour tem passos', () => {
  assert.ok(ALVOS.length >= 5, `só ${ALVOS.length} alvos declarados`);
});

test('todo controle que o tour acende existe mesmo nas telas', () => {
  for (const alvo of ALVOS) {
    const marcador = `data-tour="${alvo}"`;
    // Aparece no roteiro E em pelo menos um componente de tela.
    const emTelas = ARQUIVOS.filter(
      (a) => !a.caminho.includes('content/tour.ts') && a.texto.includes(marcador)
    );
    assert.ok(
      emTelas.length > 0,
      `o tour aponta pra "${alvo}", mas nenhum componente tem esse marcador - a caixa apareceria sem apontar pra nada`
    );
  }
});

test('as telas do roteiro são rotas que existem', () => {
  const rotas = fs.readFileSync(path.join(__dirname, '../../src/web/routes/clientRoutes.js'), 'utf8');
  const paginas = [...roteiro.matchAll(/pagina: "([^"]+)"/g)].map((m) => m[1]);
  assert.ok(paginas.length > 0);
  for (const pagina of new Set(paginas)) {
    const caminho = pagina.replace('/client', '') || '/';
    assert.match(
      rotas,
      new RegExp(`router\\.get\\('${caminho.replace(/\//g, '\\/')}'`),
      `o tour manda pra ${pagina}, que não é uma rota do painel`
    );
  }
});

test('todo passo tem título e texto nos três idiomas', () => {
  // Um passo sem tradução cairia no português no meio de um painel em inglês.
  const blocos = roteiro.split(/\n  \{\n/).slice(1);
  assert.ok(blocos.length >= 5, 'não consegui separar os passos do roteiro');
  for (const [i, bloco] of blocos.entries()) {
    for (const campo of ['titulo', 'texto']) {
      const trecho = bloco.split(`${campo}: {`)[1];
      assert.ok(trecho, `passo ${i + 1} sem ${campo}`);
      const cabeca = trecho.slice(0, 900);
      for (const idioma of ['pt:', 'en:', 'es:']) {
        assert.ok(cabeca.includes(idioma), `passo ${i + 1}: ${campo} sem ${idioma}`);
      }
    }
  }
});

test('o tour é montado no layout, e não em uma tela só', () => {
  // Ele atravessa páginas: se estivesse só na tela inicial, sumiria no
  // primeiro "Próximo" que muda de tela e nunca retomaria.
  const layout = fs.readFileSync(path.join(RAIZ, 'components/dashboard/DashboardLayout.tsx'), 'utf8');
  assert.match(layout, /<GuidedTour/, 'o tour não está no DashboardLayout');
});

test('dá pra recomeçar o tour depois de fechá-lo', () => {
  // Sem um caminho de volta, quem fecha sem querer no primeiro passo perde o
  // tour pra sempre - ele só abre sozinho uma vez.
  assert.match(TODO_O_CODIGO, /iniciarTour\(true\)/, 'nenhum botão recomeça o tour');
  const tutorial = fs.readFileSync(path.join(RAIZ, 'pages/TutorialPage.tsx'), 'utf8');
  assert.match(tutorial, /iniciarTour/, 'a página Tutorial não oferece refazer o tour');
});
