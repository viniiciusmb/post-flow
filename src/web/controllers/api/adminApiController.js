'use strict';

const usersRepository = require('../../../repositories/usersRepository');
const postingsRepository = require('../../../repositories/postingsRepository');
const { ROLES } = require('../../../config/constants');

async function dashboard(req, res) {
  const [clients, postings] = await Promise.all([
    usersRepository.listByRole(ROLES.CLIENT),
    postingsRepository.listAllWithDetails(),
  ]);

  res.json({
    counts: { clients: clients.length, postings: postings.length },
    postings: postings.map((p) => ({
      id: p.id,
      clientName: p.client_business_name || p.client_email,
      filename: p.filename,
      status: p.status,
      createdAt: p.created_at,
    })),
  });
}

module.exports = { dashboard };
