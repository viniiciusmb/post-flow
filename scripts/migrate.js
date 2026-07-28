#!/usr/bin/env node
// Executor de migrations simples: aplica os arquivos .sql da pasta migrations/
// em ordem, uma unica vez cada, registrando o que ja rodou na tabela
// "schema_migrations". Uso: node scripts/migrate.js up | down
'use strict';

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query('SELECT name FROM schema_migrations ORDER BY name');
  return new Set(rows.map((row) => row.name));
}

function listMigrationFiles() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

async function up(client) {
  await ensureMigrationsTable(client);
  const applied = await getAppliedMigrations(client);
  const files = listMigrationFiles();

  let ranAny = false;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    console.log(`Aplicando ${file}...`);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      ranAny = true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`Falha ao aplicar ${file}: ${err.message}`);
    }
  }

  console.log(ranAny ? 'Migrations aplicadas com sucesso.' : 'Nada para aplicar (banco ja esta atualizado).');
}

async function down(client) {
  // Reset simples para desenvolvimento local: apaga o schema public inteiro e recria.
  // Nao usar em producao com dados reais.
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('Schema "public" resetado. Rode "npm run migrate" para recriar as tabelas.');
}

async function main() {
  const command = process.argv[2];
  if (!['up', 'down'].includes(command)) {
    console.error('Uso: node scripts/migrate.js up|down');
    process.exit(1);
  }

  if (!process.env.DATABASE_URL) {
    console.error('Variavel DATABASE_URL nao definida. Copie .env.example para .env e preencha.');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (command === 'up') await up(client);
    else await down(client);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
