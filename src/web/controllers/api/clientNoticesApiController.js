// Avisos em pop-up para um cliente especifico (ver migration 095).
'use strict';

const clientNoticesRepository = require('../../../repositories/clientNoticesRepository');

async function list(req, res) {
  const avisos = await clientNoticesRepository.listOpen(req.session.user.id);
  res.json({
    notices: avisos.map((a) => ({ id: Number(a.id), title: a.title, body: a.body, createdAt: a.created_at })),
  });
}

async function dismiss(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Aviso inválido.' });
  const fechado = await clientNoticesRepository.dismiss(id, req.session.user.id);
  if (!fechado) return res.status(404).json({ error: 'Aviso não encontrado.' });
  res.json({ ok: true });
}

module.exports = { list, dismiss };
