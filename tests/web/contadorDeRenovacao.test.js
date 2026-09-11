// Quanto falta pra cota semanal renovar.
//
// Pedido do fundador (11/09/2026): a tela "Plano e uso" mostrava quantos
// minutos sobraram, mas não quando eles voltam. Sem isso, "5 min disponíveis"
// tanto pode significar "aguento até amanhã" quanto "acabou a semana".
//
// O risco desse contador não é errar a subtração — é PROMETER uma renovação
// que o job não vai fazer. Quem reseta de verdade é o creditWeeklyResetJob
// (clientCreditsRepository.resetDueCycles), e ele exige assinatura ATIVA além
// do prazo de 7 dias. Por isso o teste mais importante daqui é o último: o que
// a tela mostra e o que o job faz têm que ser a mesma regra.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const cicloDeCredito = require('../../src/lib/cicloDeCredito');
const clientCreditsRepository = require('../../src/repositories/clientCreditsRepository');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const { startServer, stopServer, createLoginableClient, createAgent } = require('../helpers/http');

let url;

test.before(async () => {
  url = await startServer();
});
test.after(async () => {
  await stopServer();
  await pool.end();
});

const DIA = 24 * 60 * 60;

async function clienteComPlano({ diasDeCiclo = 0, status = 'ativo' } = {}) {
  const user = await createLoginableClient();
  const planos = await subscriptionPlansRepository.listActive();
  await clientSubscriptionsRepository.setPlan(user.id, planos[0].id);
  if (status !== 'ativo') await clientSubscriptionsRepository.setStatus(user.id, status);
  await clientCreditsRepository.getOrCreate(user.id);
  await pool.query(
    `UPDATE client_credits SET cycle_start_at = now() - ($2 || ' days')::interval WHERE client_user_id = $1`,
    [user.id, diasDeCiclo]
  );
  const agent = createAgent(url);
  await agent.login(user.email, user.password);
  return { user, agent };
}

test('a tela recebe quanto falta, contado no relogio do servidor', async () => {
  const { agent } = await clienteComPlano({ diasDeCiclo: 2 });

  const r = await agent.get('/api/client/billing/overview');

  assert.equal(r.status, 200, r.text);
  const faltam = r.body.credits.secondsToNextReset;
  // 7 dias de ciclo, 2 já gastos: faltam ~5. A folga de um minuto é o tempo
  // entre o UPDATE e a resposta.
  assert.ok(Math.abs(faltam - 5 * DIA) < 60, `esperava ~5 dias em segundos, veio ${faltam}`);
  // A data absoluta vai junto pra tela poder escrever "quinta, 18/09" ao lado
  // da contagem — um contador sozinho não diz em que dia cai.
  assert.ok(r.body.credits.nextResetAt, 'a data do reset precisa vir junto');
});

test('sem assinatura ativa NAO ha renovacao prevista', async () => {
  // O job só mexe em quem está 'ativo': o inadimplente fica com a cota parada
  // até voltar a pagar. Mostrar um contador aqui seria prometer minutos numa
  // data em que eles não vêm.
  const { agent } = await clienteComPlano({ diasDeCiclo: 2, status: 'inadimplente' });

  const r = await agent.get('/api/client/billing/overview');

  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.credits.secondsToNextReset, null);
  assert.equal(r.body.credits.nextResetAt, null);
});

test('prazo vencido nao vira contagem negativa', async () => {
  // O job roda de hora em hora, então existe uma janela em que o prazo já
  // passou e a renovação ainda não aconteceu. Nela a tela diz "a qualquer
  // momento" — nunca "-2 horas".
  const { agent } = await clienteComPlano({ diasDeCiclo: 9 });

  const r = await agent.get('/api/client/billing/overview');

  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.credits.secondsToNextReset, 0);
});

test('o contador e o job de reset seguem a MESMA regra', async () => {
  // Este é o teste que amarra os dois lados. Se um dia o job passar a resetar
  // com outro prazo (ou a exigir outra coisa), o contador mente sem quebrar
  // nada visível.
  const vencido = await clienteComPlano({ diasDeCiclo: 7 });
  const nnoPrazo = await clienteComPlano({ diasDeCiclo: 3 });
  const inadimplente = await clienteComPlano({ diasDeCiclo: 9, status: 'inadimplente' });

  for (const { user, esperado } of [
    { user: vencido.user, esperado: 0 },
    { user: nnoPrazo.user, esperado: null },
    { user: inadimplente.user, esperado: null },
  ]) {
    const credits = await clientCreditsRepository.getOrCreate(user.id);
    const subscription = await clientSubscriptionsRepository.getOrCreate(user.id);
    const faltam = cicloDeCredito.segundosAteReset(credits, subscription);
    if (esperado === 0) assert.equal(faltam, 0, 'quem o job vai resetar tem que aparecer como vencido');
    else assert.ok(faltam === null || faltam > 0, 'quem o job NAO vai resetar nao pode aparecer como vencido');
  }

  const resetados = (await clientCreditsRepository.resetDueCycles()).map(Number);

  assert.ok(resetados.includes(Number(vencido.user.id)), 'o job resetou quem a tela dizia estar vencido');
  assert.ok(!resetados.includes(Number(nnoPrazo.user.id)), 'quem ainda tem prazo nao pode ser resetado');
  assert.ok(!resetados.includes(Number(inadimplente.user.id)), 'inadimplente nao renova - e a tela nao promete');
});

test('renovar reinicia o contador em 7 dias', async () => {
  const { user, agent } = await clienteComPlano({ diasDeCiclo: 8 });

  await clientCreditsRepository.resetDueCycles();
  const r = await agent.get('/api/client/billing/overview');

  assert.equal(r.status, 200, r.text);
  const faltam = r.body.credits.secondsToNextReset;
  assert.ok(Math.abs(faltam - 7 * DIA) < 60, `depois do reset o ciclo recomeca inteiro, veio ${faltam}`);
  const credits = await clientCreditsRepository.getOrCreate(user.id);
  assert.equal(Number(credits.used_normal), 0, 'renovou de verdade, nao so o contador');
});
