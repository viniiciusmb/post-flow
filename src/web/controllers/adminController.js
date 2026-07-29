'use strict';

const usersRepository = require('../../repositories/usersRepository');
const postingsRepository = require('../../repositories/postingsRepository');
const pool = require('../../db/pool');
const { ROLES } = require('../../config/constants');

async function dashboard(req, res) {
  const [clients, postings] = await Promise.all([
    usersRepository.listByRole(ROLES.CLIENT),
    postingsRepository.listAllWithDetails(),
  ]);

  res.render('admin/dashboard', {
    title: 'Painel do Admin',
    clients,
    postings,
  });
}

async function listClients(req, res) {
  const clients = await usersRepository.listByRole(ROLES.CLIENT);
  const { rows: counts } = await pool.query(
    'SELECT client_user_id, count(*)::int AS count FROM youtube_channels GROUP BY client_user_id'
  );
  const countByClient = Object.fromEntries(counts.map((c) => [c.client_user_id, c.count]));
  const clientsWithChannelCount = clients.map((c) => ({ ...c, channel_count: countByClient[c.id] || 0 }));

  res.render('admin/clients', { title: 'Clientes', clients: clientsWithChannelCount });
}

async function listPostings(req, res) {
  const postings = await postingsRepository.listAllWithDetails();
  res.render('admin/postings', { title: 'Postagens', postings });
}

module.exports = { dashboard, listClients, listPostings };
