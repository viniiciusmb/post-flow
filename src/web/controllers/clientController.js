'use strict';

const tiktokAccountsRepository = require('../../repositories/tiktokAccountsRepository');
const postingsRepository = require('../../repositories/postingsRepository');

async function dashboard(req, res) {
  const clientUserId = req.session.user.id;

  const [tiktokAccount, postings] = await Promise.all([
    tiktokAccountsRepository.findActiveByClientId(clientUserId),
    postingsRepository.listForClient(clientUserId),
  ]);

  res.render('client/dashboard', {
    title: 'Meu Painel',
    tiktokAccount,
    postings,
    tiktokConnected: req.query.tiktok_connected === '1',
    tiktokError: req.query.tiktok_error || null,
  });
}

module.exports = { dashboard };
