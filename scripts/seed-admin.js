#!/usr/bin/env node
// Cria o primeiro usuario admin. Uso: node scripts/seed-admin.js
// Pede e-mail e senha interativamente no terminal.
'use strict';

const readline = require('readline');
const authService = require('../src/services/authService');
const pool = require('../src/db/pool');

async function main() {
  console.log('=== Criar usuario admin do Post Flow ===');
  console.log('(a senha digitada abaixo fica visivel no terminal - rode isso num terminal privado)');

  // Usa o iterador assincrono do readline (em vez de varias chamadas a
  // rl.question) porque, com entrada via pipe/redirecionamento, chamadas
  // sequenciais de rl.question podem perder a segunda linha digitada.
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answers = [];
  process.stdout.write('E-mail: ');
  for await (const line of rl) {
    answers.push(line.trim());
    if (answers.length === 1) process.stdout.write('Senha (minimo 8 caracteres): ');
    if (answers.length === 2) break;
  }
  rl.close();

  const [email, password] = answers;

  if (!email || password.length < 8) {
    console.error('E-mail invalido ou senha muito curta (minimo 8 caracteres).');
    process.exit(1);
  }

  const admin = await authService.createAdmin({ email, password });
  console.log(`Admin criado com sucesso: ${admin.email} (id ${admin.id})`);
}

main()
  .catch((err) => {
    console.error('Erro ao criar admin:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
