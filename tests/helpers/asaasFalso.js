// Um Asaas de mentira, levantado na própria máquina.
//
// O que precisa ser provado nos fluxos de pagamento é o que SAI daqui (ordem
// das chamadas, corpo de cada uma, o que acontece quando uma delas falha) e o
// que o sistema faz com a resposta. Nada disso precisa da API real, e depender
// dela deixaria o teste refém de rede, de chave e de saldo em conta.
//
// O `rotas` é um mapa "MÉTODO /caminho" -> função(corpo) que devolve
// { status, body }. Caminho com `:algo` casa qualquer pedaço.
'use strict';

const http = require('node:http');
const config = require('../../src/config');

function casa(padrao, caminho) {
  const a = padrao.split('/');
  const b = caminho.split('/');
  if (a.length !== b.length) return false;
  return a.every((parte, i) => parte.startsWith(':') || parte === b[i]);
}

async function comAsaasFalso(rotas, fn) {
  const chamadas = [];

  const server = http.createServer((req, res) => {
    let bruto = '';
    req.on('data', (c) => {
      bruto += c;
    });
    req.on('end', () => {
      // O prefixo /v3 é do baseUrl; as rotas são declaradas sem ele.
      const caminho = req.url.replace(/^\/v3/, '').split('?')[0];
      const corpo = bruto ? JSON.parse(bruto) : null;
      chamadas.push({ metodo: req.method, caminho, corpo });

      const chave = Object.keys(rotas).find((k) => {
        const [metodo, padrao] = k.split(' ');
        return metodo === req.method && casa(padrao, caminho);
      });

      if (!chave) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ errors: [{ code: 'not_found', description: `sem rota falsa para ${req.method} ${caminho}` }] }));
        return;
      }

      const resposta = rotas[chave](corpo, chamadas);
      res.writeHead(resposta.status || 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(resposta.body || {}));
    });
  });

  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();

  const anterior = { ...config.asaas };
  config.asaas.apiKey = '$aact_hmlg_teste';
  config.asaas.environment = 'sandbox';
  config.asaas.baseUrlOverride = `http://127.0.0.1:${port}/v3`;

  try {
    return await fn(chamadas);
  } finally {
    Object.assign(config.asaas, anterior);
    await new Promise((r) => server.close(r));
  }
}

// Os ids falsos caem numa tabela com UNIQUE, num banco COMPARTILHADO por todos
// os arquivos de teste (que o node roda em processos separados, ao mesmo
// tempo). Duas armadilhas, as duas ja pegas na pratica:
//
//   - reiniciar o contador a cada respostasPadrao() fazia o segundo teste do
//     mesmo arquivo bater em chave duplicada;
//   - contar 1, 2, 3 em cada processo fazia arquivos DIFERENTES gerarem
//     "pay_falso_1" ao mesmo tempo - e ai o teste so falhava na suite
//     completa, passando sozinho, que e o pior tipo de falha de teste.
//
// Por isso o prefixo carrega o pid e o instante de inicio do processo.
const PREFIXO = `${process.pid}_${Date.now()}`;
let sequencia = 0;

// As respostas de sucesso mais comuns, para o teste só declarar o que muda.
function respostasPadrao({ paymentStatus = 'CONFIRMED' } = {}) {
  let ultimoPagamento = null;
  return {
    'POST /customers': () => ({ body: { id: `cus_${PREFIXO}`, name: 'Cliente' } }),
    'GET /customers/:id': () => ({ body: { id: 'cus_falso', deleted: false } }),
    'POST /customers/:id': () => ({ body: { id: 'cus_falso' } }),
    'POST /creditCard/tokenizeCreditCard': () => ({
      body: { creditCardNumber: '8829', creditCardBrand: 'MASTERCARD', creditCardToken: 'tok_falso' },
    }),
    'POST /payments': (corpo) => {
      sequencia += 1;
      ultimoPagamento = `pay_${PREFIXO}_${sequencia}`;
      return { body: { id: ultimoPagamento, status: paymentStatus, value: corpo.value } };
    },
    'GET /payments/:id': () => ({ body: { id: ultimoPagamento, status: paymentStatus } }),
    'GET /payments/:id/pixQrCode': () => ({ body: { payload: '000201-pix-copia-e-cola', encodedImage: 'QkFTRTY0' } }),
    'POST /subscriptions': () => {
      sequencia += 1;
      return { body: { id: `sub_${PREFIXO}_${sequencia}`, status: 'ACTIVE' } };
    },
    'GET /subscriptions/:id': () => ({ body: { id: 'sub_falso', status: 'ACTIVE' } }),
    'POST /subscriptions/:id': () => ({ body: { id: 'sub_falso' } }),
    'DELETE /subscriptions/:id': () => ({ body: { deleted: true, id: 'sub_falso' } }),
    'GET /pix/addressKeys': () => ({ body: { data: [{ key: 'chave-pix-falsa', status: 'ACTIVE' }] } }),
    'POST /pix/automatic/authorizations': () => {
      sequencia += 1;
      return {
        body: {
          id: `auth_${PREFIXO}_${sequencia}`,
          status: 'AWAITING_CUSTOMER_CONFIRMATION',
          payload: '000201-pix-automatico',
          encodedImage: 'QkFTRTY0',
        },
      };
    },
  };
}

module.exports = { comAsaasFalso, respostasPadrao };
