// Configuracao do PM2 - o gerenciador de processos que mantem os processos do
// Post Flow rodando 24h numa VPS SEM EasyPanel (ver docs/deployment-vps.md).
// Em producao hoje NAO usamos PM2: o EasyPanel/Docker Swarm ja faz esse papel
// (ver docs/deployment-easypanel.md). Este arquivo existe pra que de pra
// recriar o ambiente do zero num servidor simples.
//
// ATENCAO: sao TRES processos, nao dois. Rodando so o "web", o site abre e
// nada funciona por baixo (nenhum video processa, nada e postado no TikTok,
// nada e exportado pro Drive).
//
// Uso na VPS: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      // Servidor Express + a SPA React (web-client/).
      name: 'post-flow-web',
      script: 'src/web/server.js',
      env: { NODE_ENV: 'production' },
    },
    {
      // Tarefas leves de fundo: checagem do Drive de origem, metricas, saude
      // da VPS. Nao mexe em arquivo de corte.
      name: 'post-flow-worker',
      script: 'src/worker/index.js',
      env: { NODE_ENV: 'production' },
    },
    {
      // Pipeline pesado de video (yt-dlp, Whisper, Claude, ffmpeg) e tudo que
      // precisa LER arquivo de corte em disco: publicacao no TikTok,
      // exportacao pro Drive, limpeza de retencao, recuperacao de video
      // travado. Precisa enxergar o mesmo VIDEO_WORK_DIR que o "web".
      name: 'post-flow-video-worker',
      script: 'src/worker/videoIndex.js',
      env: { NODE_ENV: 'production' },
    },
  ],
};
