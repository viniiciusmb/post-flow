// A camada que fala HTTP com o Asaas.
//
// Testado contra um servidor falso levantado aqui mesmo: o que precisa ser
// provado é o que SAI daqui (cabeçalho de autenticação, URL, corpo) e como a
// resposta do Asaas é traduzida — nada disso precisa da API real, e depender
// dela deixaria o teste refém de rede e de chave.
//
// O que estes testes travam:
//   - a chave vai no cabeçalho certo (access_token, não Authorization);
//   - sandbox e produção nunca se misturam, e chave do ambiente errado é
//     recusada ANTES de sair requisição;
//   - erro do Asaas vira mensagem legível com o código preservado, e erro de
//     cliente é distinguido de erro nosso (senão tudo vira "Algo deu errado"
//     na tela de pagamento);
//   - resposta que não é JSON (Asaas fora do ar devolve HTML) não explode;
//   - o token do webhook é conferido de verdade.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const config = require('../../src/config');
const asaas = require('../../src/services/asaasService');

const CHAVE_SANDBOX = '$aact_hmlg_chave-de-teste-123';
const CHAVE_PRODUCAO = '$aact_prod_chave-de-teste-123';

const original = { ...config.asaas };

function restaurar() {
  Object.assign(config.asaas, original);
  config.asaas.baseUrlOverride = '';
}

// Servidor falso no lugar do Asaas. Guarda o que recebeu pra o teste conferir.
async function comAsaasFalso(responder, fn) {
  const recebidas = [];
  const server = http.createServer((req, res) => {
    let corpo = '';
    req.on('data', (c) => { corpo += c; });
    req.on('end', () => {
      recebidas.push({
        metodo: req.method,
        url: req.url,
        headers: req.headers,
        corpo: corpo ? JSON.parse(corpo) : null,
      });
      responder(req, res);
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  // Aponta o serviço pro servidor falso. Só localhost é aceito pelo
  // baseUrl(), o que é justamente o que este teste precisa.
  config.asaas.baseUrlOverride = `http://127.0.0.1:${port}/v3`;

  try {
    return await fn(recebidas);
  } finally {
    config.asaas.baseUrlOverride = '';
    await new Promise((r) => server.close(r));
  }
}

function responderJson(status, corpo) {
  return (_req, res) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(corpo));
  };
}

test.afterEach(restaurar);

test('a chave vai no cabeçalho access_token, e não em Authorization', async () => {
  Object.assign(config.asaas, { apiKey: CHAVE_SANDBOX, environment: 'sandbox' });

  await comAsaasFalso(responderJson(200, { id: 'cus_1', name: 'Fulano' }), async (recebidas) => {
    await asaas.createCustomer({ name: 'Fulano', cpfCnpj: '52998224725', clientUserId: 7 });

    assert.equal(recebidas.length, 1);
    assert.equal(recebidas[0].headers.access_token, CHAVE_SANDBOX);
    assert.equal(recebidas[0].headers.authorization, undefined, 'o Asaas não usa Bearer/Authorization');
    assert.equal(recebidas[0].metodo, 'POST');
    assert.equal(recebidas[0].url, '/v3/customers');
    // externalReference é o que liga o cliente do Asaas ao nosso usuário.
    assert.equal(recebidas[0].corpo.externalReference, '7');
    assert.equal(recebidas[0].corpo.cpfCnpj, '52998224725');
  });
});

test('chave de sandbox declarada como produção é recusada ANTES de sair requisição', async () => {
  Object.assign(config.asaas, { apiKey: CHAVE_SANDBOX, environment: 'production' });

  await comAsaasFalso(responderJson(200, {}), async (recebidas) => {
    await assert.rejects(
      () => asaas.getPayment('pay_1'),
      (err) => {
        assert.match(err.message, /nao combina com ASAAS_ENVIRONMENT/);
        return true;
      }
    );
    assert.equal(recebidas.length, 0, 'não pode nem tentar falar com o Asaas com a chave do ambiente errado');
  });
});

test('produção e sandbox têm URLs diferentes e nunca se misturam', () => {
  Object.assign(config.asaas, { apiKey: CHAVE_PRODUCAO, environment: 'production' });
  assert.equal(asaas.baseUrl(), 'https://api.asaas.com/v3');

  Object.assign(config.asaas, { apiKey: CHAVE_SANDBOX, environment: 'sandbox' });
  assert.equal(asaas.baseUrl(), 'https://api-sandbox.asaas.com/v3');
});

test('erro do Asaas vira mensagem legível com o código preservado', async () => {
  Object.assign(config.asaas, { apiKey: CHAVE_SANDBOX, environment: 'sandbox' });

  const erroDoAsaas = {
    errors: [{ code: 'invalid_cpfCnpj', description: 'O CPF/CNPJ informado é inválido.' }],
  };

  await comAsaasFalso(responderJson(400, erroDoAsaas), async () => {
    await assert.rejects(
      () => asaas.createCustomer({ name: 'X', cpfCnpj: '111', clientUserId: 1 }),
      (err) => {
        assert.equal(err.message, 'O CPF/CNPJ informado é inválido.');
        assert.equal(err.code, 'invalid_cpfCnpj');
        assert.equal(err.status, 400);
        // É erro que o cliente causou e pode corrigir - a tela mostra o texto.
        assert.equal(err.isCulpaDoCliente, true);
        return true;
      }
    );
  });
});

test('chave recusada (401) não é tratada como culpa do cliente', async () => {
  Object.assign(config.asaas, { apiKey: CHAVE_SANDBOX, environment: 'sandbox' });

  await comAsaasFalso(responderJson(401, { errors: [{ code: 'unauthorized', description: 'Chave inválida' }] }), async () => {
    await assert.rejects(
      () => asaas.getPayment('pay_1'),
      (err) => {
        assert.equal(err.status, 401);
        assert.equal(err.isCulpaDoCliente, false, 'chave errada é problema nosso, não do cliente');
        return true;
      }
    );
  });
});

test('resposta que não é JSON (Asaas fora do ar) não explode com erro obscuro', async () => {
  Object.assign(config.asaas, { apiKey: CHAVE_SANDBOX, environment: 'sandbox' });

  const responderHtml = (_req, res) => {
    res.writeHead(503, { 'Content-Type': 'text/html' });
    res.end('<html><body>502 Bad Gateway</body></html>');
  };

  await comAsaasFalso(responderHtml, async () => {
    await assert.rejects(
      () => asaas.getPayment('pay_1'),
      (err) => {
        assert.match(err.message, /Resposta ilegivel do Asaas/);
        assert.equal(err.status, 503);
        return true;
      }
    );
  });
});

test('cliente que não existe mais devolve false em vez de derrubar a tela', async () => {
  Object.assign(config.asaas, { apiKey: CHAVE_SANDBOX, environment: 'sandbox' });

  await comAsaasFalso(responderJson(404, { errors: [{ code: 'not_found', description: 'Não encontrado' }] }), async () => {
    assert.equal(await asaas.customerExists('cus_que_nao_existe'), false);
  });
});

test('cliente apagado no painel do Asaas também conta como inexistente', async () => {
  Object.assign(config.asaas, { apiKey: CHAVE_SANDBOX, environment: 'sandbox' });

  await comAsaasFalso(responderJson(200, { id: 'cus_1', deleted: true }), async () => {
    assert.equal(await asaas.customerExists('cus_1'), false);
  });
});

test('redirecionamento pra host que não é local é ignorado', () => {
  Object.assign(config.asaas, { apiKey: CHAVE_PRODUCAO, environment: 'production' });

  // Se isto fosse obedecido, pagamento de verdade sairia pro servidor de
  // outra pessoa e tudo pareceria estar funcionando.
  config.asaas.baseUrlOverride = 'https://asaas-falso.exemplo.com/v3';
  assert.equal(asaas.baseUrl(), 'https://api.asaas.com/v3');

  config.asaas.baseUrlOverride = 'nao-e-url';
  assert.equal(asaas.baseUrl(), 'https://api.asaas.com/v3');

  config.asaas.baseUrlOverride = 'http://127.0.0.1:9999/v3';
  assert.equal(asaas.baseUrl(), 'http://127.0.0.1:9999/v3');
});

test('webhook sem token configurado é recusado (não liberado por engano)', () => {
  Object.assign(config.asaas, { apiKey: CHAVE_SANDBOX, environment: 'sandbox', webhookToken: '' });
  assert.equal(asaas.webhookTokenValido('qualquer-coisa'), false);
});

test('webhook só passa com o token exato', () => {
  Object.assign(config.asaas, { apiKey: CHAVE_SANDBOX, environment: 'sandbox', webhookToken: 'segredo-do-webhook' });

  assert.equal(asaas.webhookTokenValido('segredo-do-webhook'), true);
  assert.equal(asaas.webhookTokenValido('segredo-do-webhook-errado'), false);
  assert.equal(asaas.webhookTokenValido('segredo-do-webhooX'), false);
  assert.equal(asaas.webhookTokenValido(''), false);
  assert.equal(asaas.webhookTokenValido(null), false);
  assert.equal(asaas.webhookTokenValido(undefined), false);
});
