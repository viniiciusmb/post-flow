'use strict';

const bcrypt = require('bcryptjs');
const usersRepository = require('../repositories/usersRepository');
const { ROLES } = require('../config/constants');

const SALT_ROUNDS = 12;

// termsVersion vem do controller (a data da ultima revisao dos Termos). Sem
// ela, o cadastro nao acontece - o aceite e obrigatorio e tem que ficar
// registrado, nao so marcado na tela.
async function registerClient({ email, password, businessName, termsVersion }) {
  const existing = await usersRepository.findByEmail(email);
  if (existing) {
    throw new Error('Já existe uma conta cadastrada com este e-mail.');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  return usersRepository.create({ email, passwordHash, role: ROLES.CLIENT, businessName, termsVersion });
}

async function createAdmin({ email, password }) {
  const existing = await usersRepository.findByEmail(email);
  if (existing) {
    throw new Error('Já existe uma conta cadastrada com este e-mail.');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  return usersRepository.create({ email, passwordHash, role: ROLES.ADMIN });
}

async function verifyLogin(email, password) {
  const user = await usersRepository.findByEmail(email);
  if (!user || !user.password_hash || !user.is_active) {
    return null;
  }

  const matches = await bcrypt.compare(password, user.password_hash);
  return matches ? user : null;
}

module.exports = { registerClient, createAdmin, verifyLogin };
