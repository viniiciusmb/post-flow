'use strict';

const bcrypt = require('bcryptjs');
const usersRepository = require('../repositories/usersRepository');
const { ROLES } = require('../config/constants');

const SALT_ROUNDS = 12;

async function registerClient({ email, password, businessName }) {
  const existing = await usersRepository.findByEmail(email);
  if (existing) {
    throw new Error('Ja existe uma conta cadastrada com este e-mail.');
  }

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  return usersRepository.create({ email, passwordHash, role: ROLES.CLIENT, businessName });
}

async function createAdmin({ email, password }) {
  const existing = await usersRepository.findByEmail(email);
  if (existing) {
    throw new Error('Ja existe uma conta cadastrada com este e-mail.');
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
