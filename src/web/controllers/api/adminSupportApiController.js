// Suporte com IA - visao do admin: conversas, o que a IA respondeu, e o que
// ela devolveu de minutos. Inclui as mensagens internas de ferramenta pra
// auditar POR QUE ela fez o que fez.
'use strict';

const supportRepository = require('../../../repositories/supportRepository');

const STATUS = ['aberta', 'encaminhada', 'resolvida'];

async function list(req, res) {
  const status = STATUS.includes(req.query.status) ? req.query.status : null;
  const conversas = await supportRepository.listConversationsForAdmin({ status });
  res.json({
    conversations: conversas.map((c) => ({
      id: Number(c.id),
      clientUserId: Number(c.client_user_id),
      email: c.email,
      businessName: c.business_name,
      status: c.status,
      escalationSummary: c.escalation_summary,
      messages: c.mensagens,
      costUsd: Number(c.custo_usd),
      minutesRefunded: c.minutos_devolvidos,
      firstMessage: c.primeira_mensagem,
      updatedAt: c.updated_at,
    })),
  });
}

function resumoDoBloco(b) {
  if (b.type === 'text') return { tipo: 'texto', texto: b.text };
  if (b.type === 'tool_use') return { tipo: 'ferramenta', nome: b.name, entrada: b.input };
  if (b.type === 'tool_result') return { tipo: 'resultado', conteudo: String(b.content || '').slice(0, 4000) };
  return null;
}

async function detail(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Conversa inválida.' });
  const conversa = await supportRepository.findConversationForAdmin(id);
  if (!conversa) return res.status(404).json({ error: 'Conversa não encontrada.' });
  const mensagens = await supportRepository.listMessages(id);
  const devolucoes = await supportRepository.listRefundsForConversation(id);
  res.json({
    conversation: { id: Number(conversa.id), email: conversa.email, status: conversa.status, escalationSummary: conversa.escalation_summary },
    messages: mensagens.map((m) => ({
      id: Number(m.id),
      role: m.role,
      createdAt: m.created_at,
      blocks: (m.content || []).map(resumoDoBloco).filter(Boolean),
    })),
    refunds: devolucoes.map((r) => ({ videoId: r.source_video_id ? Number(r.source_video_id) : null, title: r.video_title, minutes: r.minutes, reason: r.reason_code, createdAt: r.created_at })),
  });
}

async function setStatus(req, res) {
  const id = Number(req.params.id);
  const status = req.body && req.body.status;
  if (!Number.isInteger(id) || id <= 0 || !STATUS.includes(status)) return res.status(400).json({ error: 'Pedido inválido.' });
  const r = await supportRepository.setConversationStatus(id, status);
  if (!r) return res.status(404).json({ error: 'Conversa não encontrada.' });
  res.json({ ok: true });
}

module.exports = { list, detail, setStatus };
