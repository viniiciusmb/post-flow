'use strict';

const tiktokAccountsRepository = require('../../../repositories/tiktokAccountsRepository');
const postingsRepository = require('../../../repositories/postingsRepository');

async function dashboard(req, res) {
  const clientUserId = req.session.user.id;

  const [tiktokAccount, postings] = await Promise.all([
    tiktokAccountsRepository.findActiveByClientId(clientUserId),
    postingsRepository.listForClient(clientUserId),
  ]);

  res.json({
    tiktokAccount: tiktokAccount
      ? { connected: true, displayName: tiktokAccount.display_name || tiktokAccount.tiktok_open_id }
      : { connected: false },
    postings: postings.map((p) => ({
      id: p.id,
      filename: p.filename,
      status: p.status,
      updatedAt: p.updated_at,
    })),
  });
}

module.exports = { dashboard };
