'use strict';

const usersRepository = require('../../repositories/usersRepository');
const postingsRepository = require('../../repositories/postingsRepository');
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
  res.render('admin/clients', { title: 'Clientes', clients });
}

async function listPostings(req, res) {
  const postings = await postingsRepository.listAllWithDetails();
  res.render('admin/postings', { title: 'Postagens', postings });
}

module.exports = { dashboard, listClients, listPostings };
