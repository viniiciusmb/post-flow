// Configuracao do PM2 - o gerenciador de processos que mantem "web" e
// "worker" rodando 24h na VPS e reinicia sozinho se algum deles cair.
// Uso na VPS: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'post-flow-web',
      script: 'src/web/server.js',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'post-flow-worker',
      script: 'src/worker/index.js',
      env: { NODE_ENV: 'production' },
    },
  ],
};
