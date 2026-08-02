#!/usr/bin/env node
// Executor dos testes automatizados.
//
// Os testes que importam neste projeto (creditos, posse multi-tenant,
// recuperacao de video travado) so provam alguma coisa contra um Postgres de
// verdade - mock de banco esconderia justamente os bugs que ja apareceram aqui
// (constraint parcial x ON CONFLICT, BIGINT vindo como string, concorrencia de
// debito). Entao este script:
//
//   1. sobe um Postgres embarcado (embedded-postgres, devDependency - nao vai
//      pra imagem de producao, que instala com --omit=dev),
//   2. aplica todas as migrations nele,
//   3. roda `node --test` com o DATABASE_URL apontando pra ele,
//   4. derruba tudo no final, deixando a maquina limpa.
//
// Nada disso toca o banco de producao nem exige Docker instalado.
//
// Uso: npm test
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.TEST_PG_PORT || 55432);
const DB_NAME = 'postflow_test';
const DATA_DIR = path.join(os.tmpdir(), `postflow-test-pg-${PORT}`);
const DATABASE_URL = `postgres://postgres:postgres@localhost:${PORT}/${DB_NAME}`;

function run(cmd, args, env) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: 'inherit', env: { ...process.env, ...env } });
    child.on('close', (code) => resolve(code));
  });
}

async function main() {
  let EmbeddedPostgres;
  try {
    EmbeddedPostgres = require('embedded-postgres').default;
  } catch {
    console.error(
      '\nFalta a dependencia de teste "embedded-postgres".\nRode: npm install\n' +
        '(se o npm pedir, aprove o script de instalacao dela: npm approve-scripts)\n'
    );
    process.exit(1);
  }

  // Diretorio zerado a cada rodada: teste que depende de sobra da rodada
  // anterior e teste que mente.
  fs.rmSync(DATA_DIR, { recursive: true, force: true });

  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: false,
  });

  console.log(`Subindo Postgres de teste na porta ${PORT}...`);
  await pg.initialise();
  await pg.start();
  await pg.createDatabase(DB_NAME);

  let exitCode = 1;
  try {
    console.log('Aplicando migrations...');
    const migrateCode = await run('node', [path.join(__dirname, 'migrate.js'), 'up'], {
      DATABASE_URL,
      SESSION_SECRET: 'test',
      APP_ENCRYPTION_KEY: 'a'.repeat(64),
    });
    if (migrateCode !== 0) throw new Error('as migrations falharam - abortando os testes.');

    console.log('Rodando testes...\n');
    // --test-concurrency=1: os testes compartilham o mesmo banco, entao rodar
    // arquivos em paralelo criaria interferencia entre eles.
    exitCode = await run(
      'node',
      ['--test', '--test-concurrency=1', 'tests/**/*.test.js'],
      {
        DATABASE_URL,
        SESSION_SECRET: 'test-secret',
        APP_ENCRYPTION_KEY: 'a'.repeat(64),
        NODE_ENV: 'test',
      }
    );
  } finally {
    await pg.stop();
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Falha ao preparar o ambiente de teste:', err);
  process.exit(1);
});
