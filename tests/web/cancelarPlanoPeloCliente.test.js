// O link discreto "Cancelar plano" em Plano e uso.
//
// O que estes testes travam:
//   - cancela a recorrência NO ASAAS (sem isso a pessoa seria cobrada no mês
//     seguinte por um plano que cancelou) e agenda o fim do acesso para o fim
//     do período pago - o cliente continua ativo até lá;
//   - clicar de novo não cancela duas vezes;
//   - se o Asaas falhar, nada muda do nosso lado e a tela recebe o erro;
//   - plano dado pelo admin (sem cobrança recorrente) não oferece nem aceita
//     cancelar;
//   - conexões extras têm a recorrência cancelada junto, mas continuam valendo
//     até o fim do período pago, e só então saem com o plano.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const cancelamentoDeAssinaturaService = require('../../src/services/cancelamentoDeAssinaturaService');
const { comAsaasFalso, respostasPadrao } = require('../helpers/asaasFalso');

let baseUrl;

test.before(async () => {
  baseUrl = await startServer();
});

test.after(async () => {
  await stopServer();
  await pool.end();
});

let n = 0;
function idUnico(prefixo) {
  n += 1;
  return `${prefixo}_${process.pid}_${Date.now()}_${n}`;
}

async function assinanteLogado({ comAssinatura = true, extras = false } = {}) {
  const cliente = await createLoginableClient();
  const [plano] = await subscriptionPlansRepository.listActive();
  await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);

  const subId = idUnico('sub_cliente');
  const extrasId = idUnico('sub_extras');
  if (comAssinatura) {
    await clientSubscriptionsRepository.setAsaasSubscription(cliente.id, { customerId: 'cus_cli', subscriptionId: subId });
    await pool.query(
      `INSERT INTO revenue_entries (client_user_id, kind, provider, external_id, plan_id, amount_cents, paid_at)
       VALUES ($1, 'primeira_mensalidade', 'asaas', $2, $3, 9990, now() - interval '4 days')`,
      [cliente.id, idUnico('pay_cli'), plano.id]
    );
  }
  if (extras) {
    await clientSubscriptionsRepository.setExtras(cliente.id, { canais: 1, contas: 1, asaasSubscriptionId: extrasId });
  }

  const agent = createAgent(baseUrl);
  await agent.login(cliente.email, cliente.password);
  return { cliente, agent, subId, extrasId };
}

function cancelamentos(chamadas) {
  return chamadas.filter((c) => c.metodo === 'DELETE').map((c) => c.caminho.split('/').pop());
}

test('cancelar para a recorrência no Asaas e mantém o acesso até o fim do período pago', async () => {
  const { cliente, agent, subId } = await assinanteLogado();

  const antes = await agent.get('/api/client/billing/overview');
  assert.equal(antes.body.subscription.podeCancelar, true, 'o link aparece para quem tem cobrança recorrente');

  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const r = await agent.post('/api/client/billing/cancel');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.status, 'ativo');
    assert.ok(r.body.cancelaEm, 'a tela precisa da data até quando o acesso vale');
    assert.deepEqual(cancelamentos(chamadas), [subId]);

    // Segundo clique (ou tela desatualizada): não cancela de novo.
    const deNovo = await agent.post('/api/client/billing/cancel');
    assert.equal(deNovo.status, 200);
    assert.equal(cancelamentos(chamadas).length, 1);
  });

  const depois = await agent.get('/api/client/billing/overview');
  assert.equal(depois.body.subscription.status, 'ativo');
  assert.ok(depois.body.subscription.cancelaEm);
  assert.equal(depois.body.subscription.podeCancelar, false, 'depois de cancelado o link some');

  const linha = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.ok(linha.cancel_at);
});

test('se o Asaas falhar, nada muda e o cliente recebe o erro', async () => {
  const { cliente, agent } = await assinanteLogado();

  const rotas = {
    ...respostasPadrao(),
    'DELETE /subscriptions/:id': () => ({ status: 500, body: { errors: [{ code: 'erro', description: 'fora do ar' }] } }),
  };
  await comAsaasFalso(rotas, async () => {
    const r = await agent.post('/api/client/billing/cancel');
    assert.equal(r.status, 502);
    assert.ok(r.body.error);
  });

  const linha = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.equal(linha.status, 'ativo');
  assert.equal(linha.cancel_at, null, 'marcar cancelado com a recorrência de pé cobraria quem cancelou');
});

test('plano dado pelo admin, sem cobrança recorrente: não oferece nem aceita cancelar', async () => {
  const { agent } = await assinanteLogado({ comAssinatura: false });

  const overview = await agent.get('/api/client/billing/overview');
  assert.equal(overview.body.subscription.podeCancelar, false);

  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const r = await agent.post('/api/client/billing/cancel');
    assert.equal(r.status, 400);
    assert.deepEqual(cancelamentos(chamadas), []);
  });
});

test('conexões extras: recorrência cancelada junto, mas valem até o fim do período pago', async () => {
  const { cliente, agent, subId, extrasId } = await assinanteLogado({ extras: true });

  await comAsaasFalso(respostasPadrao(), async (chamadas) => {
    const r = await agent.post('/api/client/billing/cancel');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(cancelamentos(chamadas).sort(), [subId, extrasId].sort());
  });

  const durante = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.equal(durante.extra_channels, 1, 'as conexões extras foram pagas até o fim do período');
  assert.equal(durante.extra_tiktok_accounts, 1);
  assert.equal(
    durante.asaas_extra_slots_subscription_id,
    null,
    'sem soltar o id, a conferência de hora em hora removeria as conexões na hora'
  );

  // O período pago acabou.
  await pool.query(`UPDATE client_subscriptions SET cancel_at = now() - interval '1 minute' WHERE client_user_id = $1`, [
    cliente.id,
  ]);
  await cancelamentoDeAssinaturaService.finalizarVencidos();

  const fim = await clientSubscriptionsRepository.getOrCreate(cliente.id);
  assert.equal(fim.status, 'cancelado');
  assert.equal(fim.extra_channels, 0, 'sem plano, conexão extra não existe');
  assert.equal(fim.extra_tiktok_accounts, 0);
});
