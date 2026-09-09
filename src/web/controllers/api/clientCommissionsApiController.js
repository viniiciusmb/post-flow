'use strict';

// Painel "Comissões" do cliente: os links dele (um por lugar onde divulga),
// cliques, indicações, assinaturas ativas/canceladas, MRR previsto, vendas e
// recorrência do período, extrato e saque via Pix.
const affiliateLinksRepository = require('../../../repositories/affiliateLinksRepository');
const affiliatesRepository = require('../../../repositories/affiliatesRepository');
const affiliateWithdrawalsRepository = require('../../../repositories/affiliateWithdrawalsRepository');
const settingsRepository = require('../../../repositories/settingsRepository');
const affiliateService = require('../../../services/affiliateService');
const afiliadoDashboardService = require('../../../services/afiliadoDashboardService');
const demonstracao = require('../../../lib/demonstracaoDeAfiliado');
// Mesmo filtro de periodo (hoje/ontem/7 dias/mes atual/mes passado) ja usado
// nos outros dashboards - ver DateRangeFilter.tsx no frontend.
const { resolveRange } = require('../../../lib/dateRanges');

const PIX_KEY_TYPES = ['cpf', 'cnpj', 'email', 'telefone', 'aleatoria'];

// Teto de links por afiliado. Não é medo de tabela grande: é que uma lista de
// cem links não responde mais "de onde vêm minhas vendas", que é a pergunta
// que a tela existe para responder.
const MAX_LINKS = 20;

async function overview(req, res) {
  const userId = req.session.user.id;
  const { range, since, until } = resolveRange(req.query.range, { since: req.query.since, until: req.query.until });

  const painel = await afiliadoDashboardService.montar({ userId, since, until, rangeKey: range });

  if (await demonstracao.ehDemo(settingsRepository, userId)) {
    const { maxMonths } = await affiliateService.getSettings();
    return res.json(demonstracao.aplicar(painel, { userId, since, until, maxMonths }));
  }

  res.json(painel);
}

function limparRotulo(label) {
  if (typeof label !== 'string') return null;
  const limpo = label.trim().slice(0, 60);
  return limpo.length ? limpo : null;
}

// O afiliado escolhe o RÓTULO; o código do link é sempre gerado por nós (ver
// affiliateLinksRepository.createForOwner).
async function createLink(req, res) {
  const userId = req.session.user.id;
  const label = limparRotulo(req.body.label);
  if (!label) return res.status(400).json({ error: res.locals.t('erros.rotuloDoLinkObrigatorio') });

  const total = await affiliateLinksRepository.countByOwner(userId);
  if (total >= MAX_LINKS) {
    return res.status(400).json({ error: res.locals.t('erros.limiteDeLinks', { max: MAX_LINKS }) });
  }

  const link = await affiliateLinksRepository.createForOwner(userId, { label });
  res.json({
    link: {
      id: Number(link.id),
      code: link.code,
      url: afiliadoDashboardService.urlDoLink(link.code),
      label: link.label,
      isDefault: false,
      archivedAt: null,
      clicksTotal: 0,
      clicksPeriod: 0,
      visitorsPeriod: 0,
      referralCount: 0,
      activeCount: 0,
      commissionCents: 0,
      createdAt: link.created_at,
    },
  });
}

async function renameLink(req, res) {
  const userId = req.session.user.id;
  const id = Number(req.params.id);
  const label = limparRotulo(req.body.label);
  if (!label) return res.status(400).json({ error: res.locals.t('erros.rotuloDoLinkObrigatorio') });

  // O rótulo do link padrão também pode ser trocado: ele nasce sem rótulo
  // nenhum, e "Geral" ou "Meu link principal" é escolha de quem usa.
  const link = await affiliateLinksRepository.setLabel(id, userId, label);
  if (!link) return res.status(404).json({ error: res.locals.t('erros.linkNaoEncontrado') });
  res.json({ link: { id: Number(link.id), label: link.label } });
}

// Arquivar é só tirar da lista principal - o link continua contando clique e
// continua atribuindo venda (ver migration 079). Por isso não há confirmação
// dramática: nada se perde.
async function archiveLink(req, res) {
  const userId = req.session.user.id;
  const id = Number(req.params.id);
  const arquivar = req.body.archived !== false;

  const link = await affiliateLinksRepository.setArchived(id, userId, arquivar);
  if (!link) return res.status(400).json({ error: res.locals.t('erros.linkNaoPodeSerArquivado') });
  res.json({ link: { id: Number(link.id), archivedAt: link.archived_at } });
}

async function updatePixKey(req, res) {
  const userId = req.session.user.id;
  const { pixKey, pixKeyType } = req.body;

  if (!pixKey || typeof pixKey !== 'string' || pixKey.trim().length < 3) {
    return res.status(400).json({ error: res.locals.t('erros.chavePixInvalida') });
  }
  if (!PIX_KEY_TYPES.includes(pixKeyType)) {
    return res.status(400).json({ error: res.locals.t('erros.tipoChavePixInvalido') });
  }

  const affiliate = await affiliatesRepository.setPixKey(userId, { pixKey: pixKey.trim(), pixKeyType });
  res.json({ pix: { key: affiliate.pix_key, type: affiliate.pix_key_type } });
}

// Saca o saldo disponivel inteiro de uma vez (nao pede valor - o cliente so
// decide QUANDO sacar, o quanto ja esta certo no saldo). O valor nunca vem
// do corpo da requisicao, sempre lido do banco na hora.
async function requestWithdrawal(req, res) {
  const userId = req.session.user.id;

  // Numa conta em demonstração o saldo da tela não existe no banco. Gravar um
  // pedido de saque a partir dele mandaria o admin transferir dinheiro por uma
  // comissão que ninguém gerou - então aqui a ação responde e não grava nada.
  if (await demonstracao.ehDemo(settingsRepository, userId)) {
    return res.json({ withdrawal: { id: -1, amountCents: 0, status: 'pendente' } });
  }

  const affiliate = await affiliatesRepository.getOrCreate(userId);

  if (!affiliate.pix_key || !affiliate.pix_key_type) {
    return res.status(400).json({ error: res.locals.t('erros.cadastrePixAntes') });
  }

  const settings = await affiliateService.getSettings();
  if (affiliate.balance_available_cents < settings.minWithdrawCents) {
    return res.status(400).json({ error: res.locals.t('erros.saldoAbaixoDoMinimo') });
  }

  const amountCents = affiliate.balance_available_cents;
  const reserved = await affiliatesRepository.reserveForWithdrawal(userId, amountCents);
  if (!reserved) {
    return res.status(400).json({ error: res.locals.t('erros.saldoInsuficiente') });
  }

  const withdrawal = await affiliateWithdrawalsRepository.create({
    affiliateUserId: userId,
    amountCents,
    pixKey: affiliate.pix_key,
    pixKeyType: affiliate.pix_key_type,
  });

  res.json({ withdrawal: { id: Number(withdrawal.id), amountCents: withdrawal.amount_cents, status: withdrawal.status } });
}

module.exports = { overview, createLink, renameLink, archiveLink, updatePixKey, requestWithdrawal, MAX_LINKS };
