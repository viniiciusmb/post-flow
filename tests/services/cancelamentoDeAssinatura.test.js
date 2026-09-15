// Assinatura cancelada precisa ser percebida - e o acesso segue até o fim do
// período pago, como prometem os termos de uso.
//
// Até 15/09/2026 uma assinatura cancelada no Asaas passava em silêncio: o
// cliente continuava 'ativo' para sempre, com a cota semanal renovando.
//
// O que estes testes travam:
//   - cancelar no meio do mês AGENDA o fim para a última mensalidade + 1 mês,
//     e o aviso repetido não empurra a data;
//   - quando a data chega, vira 'cancelado': a cota da semana acaba, o crédito
//     avulso (comprado à parte) fica, e o excedente automático é desligado;
//   - quem já estava inadimplente, ou cujo mês pago já acabou, cancela na hora;
//   - TROCA de plano (que cancela a assinatura antiga no Asaas) não cancela o
//     cliente;
//   - voltar a assinar desfaz o cancelamento agendado;
//   - a conferência de hora em hora acha o cancelamento cujo aviso se perdeu,
//     e um 404 do Asaas NÃO cancela ninguém (é sintoma de chave trocada);
//   - assinatura cancelada nunca cobra excedente, mesmo com cartão autorizado.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pool = require('../../src/db/pool');
const cancelamentoDeAssinaturaService = require('../../src/services/cancelamentoDeAssinaturaService');
const clientSubscriptionsRepository = require('../../src/repositories/clientSubscriptionsRepository');
const subscriptionPlansRepository = require('../../src/repositories/subscriptionPlansRepository');
const creditsService = require('../../src/services/creditsService');
const { comAsaasFalso, respostasPadrao } = require('../helpers/asaasFalso');
const { createClient, createSourceVideo, giveCredits, readCredits } = require('../helpers/db');

test.after(async () => {
  await pool.end();
});

let n = 0;
function idUnico(prefixo) {
  n += 1;
  return `${prefixo}_${process.pid}_${Date.now()}_${n}`;
}

async function assinante({ pagoHaDias = 5 } = {}) {
  const cliente = await createClient();
  const [plano] = await subscriptionPlansRepository.listActive();
  await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
  const subId = idUnico('sub_canc');
  await clientSubscriptionsRepository.setAsaasSubscription(cliente.id, { customerId: 'cus_canc', subscriptionId: subId });
  if (pagoHaDias !== null) {
    await pool.query(
      `INSERT INTO revenue_entries (client_user_id, kind, provider, external_id, plan_id, amount_cents, paid_at)
       VALUES ($1, 'primeira_mensalidade', 'asaas', $2, $3, 9990, now() - make_interval(days => $4))`,
      [cliente.id, idUnico('pay_canc'), plano.id, pagoHaDias]
    );
  }
  return { cliente, subId, plano };
}

async function assinatura(clientUserId) {
  return clientSubscriptionsRepository.getOrCreate(clientUserId);
}

test('cancelar no meio do mês agenda o fim para o fim do período pago, e o cliente continua ativo', async () => {
  const { cliente, subId } = await assinante({ pagoHaDias: 5 });

  const r = await cancelamentoDeAssinaturaService.registrarEncerramento(subId, { origem: 'teste' });
  assert.equal(r.efeito, 'agendado');

  const depois = await assinatura(cliente.id);
  assert.equal(depois.status, 'ativo', 'o mês já pago continua valendo');
  const {
    rows: [{ esperado }],
  } = await pool.query(
    `SELECT max(paid_at) + interval '1 month' AS esperado FROM revenue_entries WHERE client_user_id = $1`,
    [cliente.id]
  );
  assert.equal(new Date(depois.cancel_at).getTime(), new Date(esperado).getTime());

  // Aviso repetido (o Asaas entrega "pelo menos uma vez") não mexe na data.
  await cancelamentoDeAssinaturaService.registrarEncerramento(subId, { origem: 'teste repetido' });
  const deNovo = await assinatura(cliente.id);
  assert.equal(new Date(deNovo.cancel_at).getTime(), new Date(depois.cancel_at).getTime());
});

test('quando a data chega: cancelado, sem cota da semana, com avulso preservado e sem excedente automático', async () => {
  const { cliente, subId } = await assinante({ pagoHaDias: 5 });
  await giveCredits(cliente.id, { quotaNormal: 180, extraNormal: 100 });
  await clientSubscriptionsRepository.setOverageCard(cliente.id, { enabled: true });

  await cancelamentoDeAssinaturaService.registrarEncerramento(subId, { origem: 'teste' });
  await pool.query(`UPDATE client_subscriptions SET cancel_at = now() - interval '1 minute' WHERE client_user_id = $1`, [
    cliente.id,
  ]);

  const aplicados = await cancelamentoDeAssinaturaService.finalizarVencidos();
  assert.ok(aplicados >= 1);

  const depois = await assinatura(cliente.id);
  assert.equal(depois.status, 'cancelado');
  assert.ok(depois.canceled_at, 'o painel de Receita conta cancelamentos por esta data');
  assert.equal(depois.cancel_at, null);
  assert.equal(depois.overage_card_enabled, false, 'quem cancelou não autorizou mais cobrança');

  const credito = await readCredits(cliente.id);
  assert.ok(credito.used_normal >= credito.quota_normal, 'a cota do plano acabou junto com o plano');
  assert.equal(credito.extra_normal, 100, 'crédito avulso foi comprado à parte e não some');
});

test('quem já estava inadimplente é cancelado na hora', async () => {
  const { cliente, subId } = await assinante({ pagoHaDias: 5 });
  await clientSubscriptionsRepository.setStatus(cliente.id, 'inadimplente');

  const r = await cancelamentoDeAssinaturaService.registrarEncerramento(subId, { origem: 'teste' });
  assert.equal(r.efeito, 'cancelado');
  assert.equal((await assinatura(cliente.id)).status, 'cancelado');
});

test('mês pago já acabou: cancela na hora em vez de agendar pro passado', async () => {
  const { cliente, subId } = await assinante({ pagoHaDias: 40 });
  const r = await cancelamentoDeAssinaturaService.registrarEncerramento(subId, { origem: 'teste' });
  assert.equal(r.efeito, 'cancelado');
  assert.equal((await assinatura(cliente.id)).status, 'cancelado');
});

test('plano dado pelo admin (nenhuma mensalidade paga) cancela na hora', async () => {
  const { cliente, subId } = await assinante({ pagoHaDias: null });
  const r = await cancelamentoDeAssinaturaService.registrarEncerramento(subId, { origem: 'teste' });
  assert.equal(r.efeito, 'cancelado');
  assert.equal((await assinatura(cliente.id)).status, 'cancelado');
});

test('troca de plano: o aviso da assinatura ANTIGA não cancela o cliente', async () => {
  const { cliente, subId } = await assinante({ pagoHaDias: 5 });

  // O que checkoutService.cancelarAssinaturaAnterior faz antes de pedir o
  // cancelamento ao Asaas.
  await clientSubscriptionsRepository.soltarAssinaturaAsaas(cliente.id, subId);
  const r = await cancelamentoDeAssinaturaService.registrarEncerramento(subId, { origem: 'teste' });

  assert.equal(r.efeito, 'desconhecida');
  const depois = await assinatura(cliente.id);
  assert.equal(depois.status, 'ativo');
  assert.equal(depois.cancel_at, null);
});

test('aviso da assinatura antiga chegando depois de a nova já existir não cancela', async () => {
  const { cliente, subId } = await assinante({ pagoHaDias: 5 });
  await clientSubscriptionsRepository.setAsaasSubscription(cliente.id, {
    customerId: 'cus_canc',
    subscriptionId: idUnico('sub_nova'),
  });

  await cancelamentoDeAssinaturaService.registrarEncerramento(subId, { origem: 'teste' });
  const depois = await assinatura(cliente.id);
  assert.equal(depois.status, 'ativo');
  assert.equal(depois.cancel_at, null);
});

test('voltar a assinar desfaz o cancelamento agendado', async () => {
  const { cliente, subId, plano } = await assinante({ pagoHaDias: 5 });
  await cancelamentoDeAssinaturaService.registrarEncerramento(subId, { origem: 'teste' });
  assert.ok((await assinatura(cliente.id)).cancel_at);

  await clientSubscriptionsRepository.setPlan(cliente.id, plano.id);
  assert.equal((await assinatura(cliente.id)).cancel_at, null, 'quem voltou a pagar não pode ser cortado na data antiga');
});

test('conferência de hora em hora acha o cancelamento sem aviso, e 404 não cancela ninguém', async () => {
  const cancelada = await assinante({ pagoHaDias: 5 });
  const sumida = await assinante({ pagoHaDias: 5 });

  const rotas = {
    ...respostasPadrao(),
    // O banco é compartilhado com outros arquivos de teste rodando ao mesmo
    // tempo: qualquer assinatura que não seja uma das duas daqui responde
    // ativa, e nada muda para elas.
    'GET /subscriptions/:id': (_corpo, chamadas) => {
      const caminho = chamadas[chamadas.length - 1].caminho;
      if (caminho.endsWith(cancelada.subId)) return { body: { id: cancelada.subId, status: 'INACTIVE', deleted: true } };
      if (caminho.endsWith(sumida.subId)) return { status: 404, body: { errors: [{ code: 'not_found' }] } };
      return { body: { status: 'ACTIVE', deleted: false } };
    },
  };

  await comAsaasFalso(rotas, async () => {
    const r = await cancelamentoDeAssinaturaService.conferirNoAsaas();
    assert.ok(r.encerradas >= 1);
    assert.ok(r.falhas >= 1);
  });

  assert.ok((await assinatura(cancelada.cliente.id)).cancel_at, 'o cancelamento sem aviso tem que ser percebido');

  const depoisDoSumido = await assinatura(sumida.cliente.id);
  assert.equal(depoisDoSumido.status, 'ativo', '404 é chave/conta trocada, não cancelamento');
  assert.equal(depoisDoSumido.cancel_at, null);
});

test('assinatura cancelada nunca cobra excedente, mesmo com o cartão autorizado', async () => {
  const { cliente, subId } = await assinante({ pagoHaDias: null });
  await giveCredits(cliente.id, { quotaNormal: 0 });
  await cancelamentoDeAssinaturaService.registrarEncerramento(subId, { origem: 'teste' });
  // Religa a autorização por fora (o botão "ativar cobrança" continua existindo
  // na tela): a trava tem que valer mesmo assim.
  await clientSubscriptionsRepository.setOverageCard(cliente.id, { enabled: true });

  const video = await createSourceVideo(cliente.id, { durationSeconds: 600 });
  const r = await creditsService.reserveBeforeDownload(video, cliente.id);
  assert.equal(r.outcome, 'blocked', 'sem plano e sem cota, o vídeo espera - nunca vira cobrança no cartão');
});
