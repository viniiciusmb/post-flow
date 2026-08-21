#!/usr/bin/env node
// Prepara a conta do Asaas para receber pagamento: confere a chave, garante
// que existe chave Pix e cadastra (ou corrige) o webhook.
//
// Feito para rodar DENTRO do container, onde as variáveis de ambiente já
// estão: assim a chave de produção nunca precisa ser copiada para lugar
// nenhum nem passar por conversa. Rodar de novo é seguro — o script confere o
// que já existe antes de criar qualquer coisa.
//
//   docker exec <container> node scripts/asaas-setup.js
'use strict';

const config = require('../src/config');
const asaasService = require('../src/services/asaasService');
const { CONTACT } = require('../src/config/constants');

const EVENTOS = [
  'CHECKOUT_PAID',
  'CHECKOUT_EXPIRED',
  'CHECKOUT_CANCELED',
  'PAYMENT_CONFIRMED',
  'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE',
  'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED',
  'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED',
  'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED',
  'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED',
];

const URL_WEBHOOK = `${CONTACT.siteUrl}/api/asaas/webhook`;

function linha(rotulo, valor) {
  console.log(`  ${String(rotulo).padEnd(22)} ${valor}`);
}

async function main() {
  console.log('\n=== Asaas: preparação da conta ===\n');

  if (!asaasService.isConfigured()) {
    console.error('ASAAS_API_KEY não está configurada. Nada a fazer.');
    process.exit(1);
  }
  const check = config.validateAsaasConfig();
  if (!check.ok) {
    console.error(`Configuração inválida: ${check.motivo}`);
    process.exit(1);
  }

  linha('ambiente', config.asaas.environment);
  linha('URL da API', asaasService.baseUrl());
  linha('webhook', URL_WEBHOOK);

  if (!config.asaas.webhookToken || config.asaas.webhookToken.length < 32) {
    // O Asaas exige 32+ caracteres, e é este token que separa um aviso de
    // pagamento verdadeiro de qualquer um que descubra o endereço.
    console.error('\nASAAS_WEBHOOK_TOKEN ausente ou com menos de 32 caracteres. Abortando.');
    process.exit(1);
  }

  // ---- chave Pix ----
  // Sem pelo menos uma chave ativa, o Asaas recusa QUALQUER cobrança por Pix
  // com "é necessário criar uma chave Pix" - e o erro só apareceria no clique
  // do cliente em "Pagar".
  console.log('\n1) Chave Pix');
  const chaves = await asaasService.listPixKeys();
  const ativa = chaves.find((k) => k.status === 'ACTIVE');
  if (ativa) {
    linha('já existe', `${ativa.type} (${ativa.key})`);
  } else {
    // EVP (aleatória) de propósito: não expõe CNPJ, telefone nem e-mail da
    // empresa no código Pix que o cliente enxerga.
    const nova = await asaasService.criarChavePixAleatoria();
    linha('criada', `${nova.type} (${nova.key})`);
  }

  // ---- webhook ----
  console.log('\n2) Webhook');
  const existentes = await asaasService.listWebhooks();
  const nosso = existentes.find((w) => w.url === URL_WEBHOOK);

  if (nosso) {
    linha('já cadastrado', nosso.id);
    linha('ativo', nosso.enabled);
    linha('fila interrompida', nosso.interrupted ? 'SIM - precisa ser religada' : 'não');
    const faltando = EVENTOS.filter((e) => !(nosso.events || []).includes(e));
    if (faltando.length > 0) {
      linha('eventos faltando', faltando.join(', '));
      await asaasService.updateWebhook(nosso.id, { events: EVENTOS, enabled: true, interrupted: false });
      linha('corrigido', 'eventos atualizados e fila religada');
    } else {
      linha('eventos', 'todos presentes');
    }
  } else {
    const criado = await asaasService.createWebhook({
      name: 'Post Flow',
      url: URL_WEBHOOK,
      email: CONTACT.supportEmail,
      authToken: config.asaas.webhookToken,
      events: EVENTOS,
    });
    linha('criado', criado.id);
    linha('eventos', (criado.events || []).length);
  }

  console.log('\nConta pronta.\n');
}

main().catch((err) => {
  console.error('\nFalhou:', err.message);
  process.exit(1);
});
