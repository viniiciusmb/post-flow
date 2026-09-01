// Esconder do cliente tudo que fala da internet dele (01/09/2026).
//
// O fundador decidiu não oferecer, por enquanto, o programa que faz os
// downloads saírem pela internet do próprio cliente. Ele atravessa o produto
// inteiro: o menu "Sua conexão", a cota bônus em "Plano e uso", a linha de
// minutos extras nas caixas de preço (no painel E na página pública), um passo
// do tour guiado, uma pergunta frequente. Cada um desses lugares seria uma
// promessa que o produto não está fazendo.
//
// É SÓ EXIBIÇÃO — e é isso que estes testes travam junto: nada aqui desliga o
// túnel. As rotas continuam no ar e quem já pareou o programa continua baixando
// pela internet dele e ganhando a cota bônus. Esconder a tela e desligar a
// funcionalidade são decisões diferentes, com riscos diferentes.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const pool = require('../../src/db/pool');
const exibicaoDoTunel = require('../../src/lib/exibicaoDoTunel');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;

test.before(async () => {
  url = await startServer();
});

test.after(async () => {
  await exibicaoDoTunel.definirMostrarTunel(exibicaoDoTunel.PADRAO);
  await stopServer();
  await pool.end();
});

async function clienteLogado() {
  const user = await createLoginableClient();
  const agent = createAgent(url);
  await agent.login(user.email, user.password);
  return { user, agent };
}

// --- a chave em si ---

test('o padrão é ESCONDIDO', async () => {
  // Um padrão "visível" faria a tela voltar a oferecer o túnel sozinha em
  // qualquer base nova — o contrário da intenção.
  assert.equal(exibicaoDoTunel.PADRAO, false);
});

test('o painel recebe a chave na mesma requisição que já faz em toda tela', async () => {
  const { agent } = await clienteLogado();

  await exibicaoDoTunel.definirMostrarTunel(false);
  let r = await agent.get('/api/auth/me');
  assert.equal(r.status, 200);
  assert.equal(r.body.ui.mostrarTunel, false);

  await exibicaoDoTunel.definirMostrarTunel(true);
  r = await agent.get('/api/auth/me');
  assert.equal(r.body.ui.mostrarTunel, true, 'ligar de novo tem que fazer tudo reaparecer');
});

// --- a página da conexão ---

test('escondido, a página da conexão não abre nem digitando o endereço', async () => {
  // Sem isto, "tirar do menu" deixaria a tela viva pra quem tivesse o link no
  // histórico — e o pedido foi que não aparecesse absolutamente nada.
  const { agent } = await clienteLogado();
  await exibicaoDoTunel.definirMostrarTunel(false);

  const r = await agent.get('/client/tunnel');
  assert.equal(r.status, 302, 'a página abriu mesmo com o túnel escondido');
  assert.equal(r.headers.get('location'), '/client');
});

test('visível, a página volta a abrir', async () => {
  const { agent } = await clienteLogado();
  await exibicaoDoTunel.definirMostrarTunel(true);

  const r = await agent.get('/client/tunnel');
  assert.equal(r.status, 200);
});

test('a FUNCIONALIDADE continua de pé mesmo escondida', async () => {
  // Este é o teste que separa "escondi" de "desliguei". As rotas do túnel
  // continuam respondendo: quem já tem o programa pareado não pode parar de
  // funcionar porque a tela sumiu.
  const { agent } = await clienteLogado();
  await exibicaoDoTunel.definirMostrarTunel(false);

  const r = await agent.get('/api/client/tunnel');
  assert.notEqual(r.status, 404, 'a rota do túnel sumiu — isso é desligar, não esconder');
  assert.equal(r.status, 200);
});

// --- a página pública ---

test('escondido, a landing não anuncia minutos usando a internet do cliente', async () => {
  await exibicaoDoTunel.definirMostrarTunel(false);
  const anonimo = createAgent(url);
  const r = await anonimo.get('/');

  assert.equal(r.status, 200);
  assert.ok(!/usando sua internet/i.test(r.text), 'a caixa de preço continuou prometendo minutos bônus');
  assert.ok(!/minutos bônus/i.test(r.text), 'o texto dos planos continuou falando de bônus');

  // A linha some SEM deixar buraco: nada de <li> vazio, e os outros itens da
  // caixa continuam lá. Esconder com um item em branco no meio da lista seria
  // pior do que não ter escondido.
  assert.ok(!/<li[^>]*>\s*<\/li>/.test(r.text), 'sobrou um item vazio na caixa de preço');
  assert.ok(!/class="bonus"/.test(r.text), 'o item do bônus continuou no HTML');
  // O texto é quebrado por <strong> no meio ("<strong>90 minutos</strong> de
  // vídeo por semana"), então a busca é pelas duas metades.
  assert.ok(/de v[íi]deo por semana/i.test(r.text), 'a caixa perdeu os minutos do plano junto');
  assert.ok(/canal do YouTube|canais do YouTube/i.test(r.text), 'a caixa perdeu os outros itens');
});

test('visível, a landing anuncia de novo', async () => {
  await exibicaoDoTunel.definirMostrarTunel(true);
  const anonimo = createAgent(url);
  const r = await anonimo.get('/');

  assert.ok(/usando sua internet/i.test(r.text), 'ligar a chave não trouxe a linha de volta');
});

test('a resposta da pergunta frequente combina com a página, nos dois estados', async () => {
  // As perguntas viram FAQPage nos dados estruturados. Resposta diferente da
  // que está na tela é exatamente o que faz o Google desconfiar do dado.
  const anonimo = createAgent(url);

  await exibicaoDoTunel.definirMostrarTunel(false);
  const escondido = await anonimo.get('/');
  assert.ok(
    !/programa opcional que faz os downloads/i.test(escondido.text),
    'a pergunta frequente continuou oferecendo o programa'
  );

  await exibicaoDoTunel.definirMostrarTunel(true);
  const visivel = await anonimo.get('/');
  assert.ok(/programa opcional que faz os downloads/i.test(visivel.text));
});

test('o llms.txt também para de citar a internet do cliente', async () => {
  // É lido por IA e por buscador: descrever um benefício que o produto não está
  // entregando faria uma IA responder pro cliente algo que a landing não diz.
  const anonimo = createAgent(url);

  await exibicaoDoTunel.definirMostrarTunel(false);
  const escondido = await anonimo.get('/llms.txt');
  assert.equal(escondido.status, 200);
  assert.ok(!/internet do próprio/i.test(escondido.text), 'o llms.txt continuou descrevendo os minutos bônus');

  await exibicaoDoTunel.definirMostrarTunel(true);
  const visivel = await anonimo.get('/llms.txt');
  assert.ok(/internet do próprio/i.test(visivel.text));
});

// --- o admin ---

test('o admin liga e desliga pela tela de Banda', async () => {
  const admin = await createLoginableClient({ role: 'admin' });
  const agent = createAgent(url);
  await agent.login(admin.email, admin.password);

  const desligou = await agent.post('/api/admin/bandwidth/mostrar-tunel', { mostrar: false });
  assert.equal(desligou.status, 200);
  assert.equal(desligou.body.mostrarTunelParaClientes, false);
  assert.equal(await exibicaoDoTunel.mostrarTunel(), false);

  const ligou = await agent.post('/api/admin/bandwidth/mostrar-tunel', { mostrar: true });
  assert.equal(ligou.body.mostrarTunelParaClientes, true);
  assert.equal(await exibicaoDoTunel.mostrarTunel(), true);

  const visao = await agent.get('/api/admin/bandwidth');
  assert.equal(visao.body.mostrarTunelParaClientes, true, 'a tela precisa refletir o estado ao recarregar');
});

test('cliente comum não muda essa chave', async () => {
  const { agent } = await clienteLogado();
  await exibicaoDoTunel.definirMostrarTunel(false);

  const r = await agent.post('/api/admin/bandwidth/mostrar-tunel', { mostrar: true });
  assert.ok(r.status === 403 || r.status === 404, `um cliente conseguiu chamar a rota de admin (${r.status})`);
  assert.equal(await exibicaoDoTunel.mostrarTunel(), false);
});

// --- a varredura ---
//
// Este é o teste que protege contra o defeito mais provável desta mudança: um
// lugar que ficou de fora da varredura. Ele não olha a tela — olha o CÓDIGO,
// e cobra que toda menção à internet do cliente esteja atrás da chave.

test('nenhuma tela do painel cita a internet do cliente fora da chave', () => {
  const raiz = path.join(__dirname, '..', '..', 'web-client', 'src');
  // Arquivos que PODEM falar disso sem condição: são a própria página da
  // conexão (que já some inteira), o dicionário, os tipos e o painel do admin.
  const isentos = [
    'pages/ClientTunnelPage.tsx',
    'main-tunnel.tsx',
    'pages/AdminBandwidthPage.tsx',
    'hooks/useAuth.ts',
    'components/app-sidebar.tsx',
    'content/tour.ts',
    'i18n/',
    'types/api.ts',
  ];
  const padroes = [/sua internet/i, /própria internet/i, /\/client\/tunnel/, /weeklyMinutesBonus/, /rateCentsBonus/];

  const suspeitos = [];
  (function varrer(dir) {
    for (const nome of fs.readdirSync(dir)) {
      const caminho = path.join(dir, nome);
      if (fs.statSync(caminho).isDirectory()) {
        varrer(caminho);
        continue;
      }
      if (!/\.tsx?$/.test(caminho)) continue;
      const relativo = path.relative(raiz, caminho);
      if (isentos.some((i) => relativo.startsWith(i))) continue;

      const linhas = fs.readFileSync(caminho, 'utf8').split('\n');
      linhas.forEach((linha, i) => {
        if (!padroes.some((p) => p.test(linha))) return;
        // A menção precisa estar dentro de um bloco condicionado pela chave.
        // Procura pra trás, na mesma vizinhança, o `mostrarTunel` que a guarda.
        const vizinhanca = linhas.slice(Math.max(0, i - 12), i + 1).join('\n');
        if (!/mostrarTunel/.test(vizinhanca)) suspeitos.push(`${relativo}:${i + 1}  ${linha.trim()}`);
      });
    }
  })(raiz);

  assert.deepEqual(
    suspeitos,
    [],
    `estas telas falam da internet do cliente sem estar atrás da chave:\n${suspeitos.join('\n')}`
  );
});
