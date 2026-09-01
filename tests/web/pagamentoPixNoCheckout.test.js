// O PIX Automático saiu da tela de planos e virou alternativa no checkout
// (01/09/2026).
//
// Antes cada cartão de plano tinha DOIS botões: "Assinar / trocar de plano" e
// "Pagar com PIX Automático". Isso pedia a decisão do MEIO DE PAGAMENTO antes
// da decisão que aquela tela existe para tomar, que é qual plano. Agora existe
// um botão só, e o meio de pagamento é escolhido no checkout — com cartão
// primeiro e PIX Automático como alternativa.
//
// Estes testes olham o CÓDIGO das telas, e não o navegador: o que pode
// regredir aqui é um botão voltar para o lugar errado, e nenhum teste de API
// pegaria isso.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..', '..', 'web-client', 'src');
const ler = (p) => fs.readFileSync(path.join(raiz, p), 'utf8');

test('a tela de planos não oferece mais o PIX direto no cartão do plano', () => {
  const tela = ler('pages/ClientBillingPage.tsx');
  assert.ok(
    !/abrirPix|assinarPix/.test(tela),
    'o botão de PIX voltou para o cartão do plano — a escolha de meio de pagamento é do checkout'
  );
  // E o caminho principal continua lá: sem ele, ninguém assina.
  assert.ok(/plano\.assinarTrocar/.test(tela), 'o botão de assinar sumiu junto');
});

test('o checkout oferece PIX Automático para mensalidade', () => {
  const tela = ler('pages/CheckoutPage.tsx');
  assert.ok(
    /pixDisponivel=\{item\.tipo === "creditos" \|\| item\.tipo === "plano"\}/.test(tela),
    'o checkout precisa aceitar PIX também para plano, senão a alternativa não existe em lugar nenhum'
  );
  assert.ok(
    /subscribe-pix/.test(tela),
    'mensalidade por PIX é uma AUTORIZAÇÃO recorrente e tem endpoint próprio'
  );
});

test('o cartão vem SEMPRE primeiro na escolha', () => {
  // Foi o que o fundador pediu: priorizar o cartão. Ele renova sozinho, sem o
  // cliente precisar autorizar nada no banco.
  const tela = ler('pages/CheckoutPage.tsx');
  const seletor = tela.slice(tela.indexOf('function MetodoSeletor'));
  const posCartao = seletor.indexOf('id: "cartao"');
  const posPix = seletor.indexOf('id: "pix"');
  assert.ok(posCartao > -1 && posPix > -1, 'as duas opções têm que existir');
  assert.ok(posCartao < posPix, 'o cartão precisa vir antes do PIX na lista de opções');
});

test('o PIX de mensalidade é chamado de "PIX Automático", não de "PIX"', () => {
  // Um PIX avulso e um débito recorrente autorizado são coisas diferentes.
  // Chamar os dois de "PIX" faria o cliente achar que teria de pagar na mão
  // todo mês — ou pior, que não teria.
  const tela = ler('pages/CheckoutPage.tsx');
  assert.ok(/PIX Automático/.test(tela), 'a mensalidade por PIX precisa ser nomeada pelo que ela é');
});

test('a bandeira do cartão salvo aparece como SELO, não como nome escrito', () => {
  // Pedido do fundador: "troque o nome visa pela bandeira do cartão".
  for (const arquivo of ['pages/ClientBillingPage.tsx', 'pages/CheckoutPage.tsx']) {
    const tela = ler(arquivo);
    assert.ok(
      /bandeiraDoAsaas/.test(tela) && /<Bandeira /.test(tela),
      `${arquivo} precisa desenhar a bandeira em vez de escrever o nome dela`
    );
  }

  // Olhar o arquivo inteiro não bastava: o componente do selo podia continuar
  // existindo (usado no extrato) enquanto a linha do cartão salvo voltava a
  // escrever o nome. Confirmado por mutação - o teste passava com o defeito.
  // Por isso a checagem é DENTRO do componente que desenha a linha.
  const billing = ler('pages/ClientBillingPage.tsx');
  const i = billing.indexOf('function CartaoLinha');
  const corpo = billing.slice(i, billing.indexOf('\n}', i));
  assert.ok(i > -1, 'CartaoLinha é quem desenha o cartão salvo');
  assert.ok(/<SeloDoCartao/.test(corpo), 'a linha do cartão salvo tem que desenhar a bandeira');

  // O nome não pode simplesmente sumir: ele continua no title, para quem usa
  // leitor de tela ou passa o mouse.
  assert.ok(/title=\{nomeDaBandeira\(card\.brand\)\}/.test(corpo), 'o nome da bandeira precisa sobreviver no title');

  // ...mas não pode ser DESENHADO na tela. O title tem o mesmo texto, então
  // ele é tirado antes da checagem - sem isso a asserção se contradizia e
  // falhava no código certo.
  const semTitle = corpo.replace(/title=\{nomeDaBandeira\([^)]*\)\}/g, '');
  assert.ok(
    !/nomeDaBandeira\(/.test(semTitle),
    'o nome da bandeira voltou a ser escrito na tela em vez do selo'
  );
});
