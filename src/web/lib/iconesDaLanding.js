// Ícones da landing, copiados da biblioteca Tabler Icons (licença MIT,
// Copyright (c) 2020-2026 Paweł Kuna) - a mesma que o painel usa.
//
// Ficam gravados AQUI, e não carregados de fora: as páginas públicas não
// baixam nada de servidor de terceiro (há um teste que falha se isso voltar).
// Gerado a partir de web-client/node_modules/@tabler/icons/icons/outline;
// para acrescentar um ícone, copie o conteúdo do .svg dele (sem a <path> de
// moldura "M0 0h24v24H0z").
'use strict';

const ICONES = {
  "brand-tiktok": "<path d=\"M21 7.917v4.034a9.948 9.948 0 0 1 -5 -1.951v4.5a6.5 6.5 0 1 1 -8 -6.326v4.326a2.5 2.5 0 1 0 4 2v-11.5h4.083a6.005 6.005 0 0 0 4.917 4.917\" />",
  "brand-instagram": "<path d=\"M4 8a4 4 0 0 1 4 -4h8a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-8a4 4 0 0 1 -4 -4l0 -8\" /><path d=\"M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0\" /><path d=\"M16.5 7.5v.01\" />",
  "brand-facebook": "<path d=\"M7 10v4h3v7h4v-7h3l1 -4h-4v-2a1 1 0 0 1 1 -1h3v-4h-3a5 5 0 0 0 -5 5v2h-3\" />",
  "brand-youtube": "<path d=\"M2 8a4 4 0 0 1 4 -4h12a4 4 0 0 1 4 4v8a4 4 0 0 1 -4 4h-12a4 4 0 0 1 -4 -4v-8\" /><path d=\"M10 9l5 3l-5 3l0 -6\" />",
  "brand-threads": "<path d=\"M19 7.5c-1.333 -3 -3.667 -4.5 -7 -4.5c-5 0 -8 2.5 -8 9s3.5 9 8 9s7 -3 7 -5s-1 -5 -7 -5c-2.5 0 -3 1.25 -3 2.5c0 1.5 1 2.5 2.5 2.5c2.5 0 3.5 -1.5 3.5 -5s-2 -4 -3 -4s-1.833 .333 -2.5 1\" />",
  "brand-linkedin": "<path d=\"M8 11v5\" /><path d=\"M8 8v.01\" /><path d=\"M12 16v-5\" /><path d=\"M16 16v-3a2 2 0 1 0 -4 0\" /><path d=\"M3 7a4 4 0 0 1 4 -4h10a4 4 0 0 1 4 4v10a4 4 0 0 1 -4 4h-10a4 4 0 0 1 -4 -4l0 -10\" />",
  "brand-pinterest": "<path d=\"M8 20l4 -9\" /><path d=\"M10.7 14c.437 1.263 1.43 2 2.55 2c2.071 0 3.75 -1.554 3.75 -4a5 5 0 1 0 -9.7 1.7\" /><path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0\" />",
  "brand-bluesky": "<path d=\"M6.335 5.144c-1.654 -1.199 -4.335 -2.127 -4.335 .826c0 .59 .35 4.953 .556 5.661c.713 2.463 3.13 2.75 5.444 2.369c-4.045 .665 -4.889 3.208 -2.667 5.41c1.03 1.018 1.913 1.59 2.667 1.59c2 0 3.134 -2.769 3.5 -3.5c.333 -.667 .5 -1.167 .5 -1.5c0 .333 .167 .833 .5 1.5c.366 .731 1.5 3.5 3.5 3.5c.754 0 1.637 -.571 2.667 -1.59c2.222 -2.203 1.378 -4.746 -2.667 -5.41c2.314 .38 4.73 .094 5.444 -2.369c.206 -.708 .556 -5.072 .556 -5.661c0 -2.953 -2.68 -2.025 -4.335 -.826c-2.293 1.662 -4.76 5.048 -5.665 6.856c-.905 -1.808 -3.372 -5.194 -5.665 -6.856\" />",
  "brand-twitch": "<path d=\"M4 5v11a1 1 0 0 0 1 1h2v4l4 -4h5.584c.266 0 .52 -.105 .707 -.293l2.415 -2.414c.187 -.188 .293 -.442 .293 -.708v-8.585a1 1 0 0 0 -1 -1h-14a1 1 0 0 0 -1 1l.001 0\" /><path d=\"M16 8l0 4\" /><path d=\"M12 8l0 4\" />",
  "brand-kick": "<path d=\"M4 4h5v4h3v-2h2v-2h6v4h-2v2h-2v4h2v2h2v4h-6v-2h-2v-2h-3v4h-5l0 -16\" />",
  "brand-google-drive": "<path d=\"M12 10l-6 10l-3 -5l6 -10l3 5\" /><path d=\"M9 15h12l-3 5h-12\" /><path d=\"M15 15l-6 -10h6l6 10l-6 0\" />",
  "sparkles": "<path d=\"M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6\" />",
  "scissors": "<path d=\"M3 7a3 3 0 1 0 6 0a3 3 0 1 0 -6 0\" /><path d=\"M3 17a3 3 0 1 0 6 0a3 3 0 1 0 -6 0\" /><path d=\"M8.6 8.6l10.4 10.4\" /><path d=\"M8.6 15.4l10.4 -10.4\" />",
  "clock": "<path d=\"M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0\" /><path d=\"M12 7v5l3 3\" />",
  "broadcast": "<path d=\"M18.364 19.364a9 9 0 1 0 -12.728 0\" /><path d=\"M15.536 16.536a5 5 0 1 0 -7.072 0\" /><path d=\"M11 13a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\" />",
  "wand": "<path d=\"M6 21l15 -15l-3 -3l-15 15l3 3\" /><path d=\"M15 6l3 3\" /><path d=\"M9 3a2 2 0 0 0 2 2a2 2 0 0 0 -2 2a2 2 0 0 0 -2 -2a2 2 0 0 0 2 -2\" /><path d=\"M19 13a2 2 0 0 0 2 2a2 2 0 0 0 -2 2a2 2 0 0 0 -2 -2a2 2 0 0 0 2 -2\" />",
  "message-chatbot": "<path d=\"M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12\" /><path d=\"M9.5 9h.01\" /><path d=\"M14.5 9h.01\" /><path d=\"M9.5 13a3.5 3.5 0 0 0 5 0\" />",
  "language": "<path d=\"M9 6.371c0 4.418 -2.239 6.629 -5 6.629\" /><path d=\"M4 6.371h7\" /><path d=\"M5 9c0 2.144 2.252 3.908 6 4\" /><path d=\"M12 20l4 -9l4 9\" /><path d=\"M19.1 18h-6.2\" /><path d=\"M6.694 3l.793 .582\" />",
  "device-mobile": "<path d=\"M6 5a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2v-14\" /><path d=\"M11 4h2\" /><path d=\"M12 17v.01\" />",
  "cloud-upload": "<path d=\"M7 18a4.6 4.4 0 0 1 0 -9a5 4.5 0 0 1 11 2h1a3.5 3.5 0 0 1 0 7h-1\" /><path d=\"M9 15l3 -3l3 3\" /><path d=\"M12 12l0 9\" />",
  "check": "<path d=\"M5 12l5 5l10 -10\" />",
  "x": "<path d=\"M18 6l-12 12\" /><path d=\"M6 6l12 12\" />",
  "arrow-right": "<path d=\"M5 12l14 0\" /><path d=\"M13 18l6 -6\" /><path d=\"M13 6l6 6\" />",
  "bolt": "<path d=\"M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11\" />",
  "shield-check": "<path d=\"M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06\" /><path d=\"M15 19l2 2l4 -4\" />",
  "player-play": "<path d=\"M7 4v16l13 -8l-13 -8\" />",
  "users": "<path d=\"M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0\" /><path d=\"M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2\" /><path d=\"M16 3.13a4 4 0 0 1 0 7.75\" /><path d=\"M21 21v-2a4 4 0 0 0 -3 -3.85\" />",
  "microphone": "<path d=\"M9 5a3 3 0 0 1 3 -3a3 3 0 0 1 3 3v5a3 3 0 0 1 -3 3a3 3 0 0 1 -3 -3l0 -5\" /><path d=\"M5 10a7 7 0 0 0 14 0\" /><path d=\"M8 21l8 0\" /><path d=\"M12 17l0 4\" />",
  "briefcase": "<path d=\"M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -9\" /><path d=\"M8 7v-2a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v2\" /><path d=\"M12 12l0 .01\" /><path d=\"M3 13a20 20 0 0 0 18 0\" />",
  "upload": "<path d=\"M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2\" /><path d=\"M7 9l5 -5l5 5\" /><path d=\"M12 4l0 12\" />",
  "droplet-off": "<path d=\"M18.963 14.938a6.54 6.54 0 0 0 -.899 -4.06l-4.89 -7.26c-.42 -.626 -1.287 -.804 -1.936 -.398a1.376 1.376 0 0 0 -.41 .397l-1.282 1.9m-1.625 2.415l-1.986 2.946c-1.695 2.837 -1.035 6.44 1.567 8.545c2.602 2.105 6.395 2.105 8.996 0a6.83 6.83 0 0 0 1.376 -1.499\" /><path d=\"M3 3l18 18\" />",
  "calendar-time": "<path d=\"M11.795 21h-6.795a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v4\" /><path d=\"M14 18a4 4 0 1 0 8 0a4 4 0 1 0 -8 0\" /><path d=\"M15 3v4\" /><path d=\"M7 3v4\" /><path d=\"M3 11h16\" /><path d=\"M18 16.496v1.504l1 1\" />",
  "chart-bar": "<path d=\"M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -6\" /><path d=\"M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -10\" /><path d=\"M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1l0 -14\" /><path d=\"M4 20h14\" />",
  "cpu": "<path d=\"M5 6a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v12a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1l0 -12\" /><path d=\"M9 9h6v6h-6l0 -6\" /><path d=\"M3 10h2\" /><path d=\"M3 14h2\" /><path d=\"M10 3v2\" /><path d=\"M14 3v2\" /><path d=\"M21 10h-2\" /><path d=\"M21 14h-2\" /><path d=\"M14 21v-2\" /><path d=\"M10 21v-2\" />",
  "crop-portrait": "<path d=\"M6 6a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2l0 -12\" />",
  "lock": "<path d=\"M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6\" /><path d=\"M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0\" /><path d=\"M8 11v-4a4 4 0 1 1 8 0v4\" />",
  "credit-card": "<path d=\"M3 8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3l0 -8\" /><path d=\"M3 10l18 0\" /><path d=\"M7 15l.01 0\" /><path d=\"M11 15l2 0\" />",
  "building-bank": "<path d=\"M3 21l18 0\" /><path d=\"M3 10l18 0\" /><path d=\"M5 6l7 -3l7 3\" /><path d=\"M4 10l0 11\" /><path d=\"M20 10l0 11\" /><path d=\"M8 14l0 3\" /><path d=\"M12 14l0 3\" /><path d=\"M16 14l0 3\" />",
  "brain": "<path d=\"M15.5 13a3.5 3.5 0 0 0 -3.5 3.5v1a3.5 3.5 0 0 0 7 0v-1.8\" /><path d=\"M8.5 13a3.5 3.5 0 0 1 3.5 3.5v1a3.5 3.5 0 0 1 -7 0v-1.8\" /><path d=\"M17.5 16a3.5 3.5 0 0 0 0 -7h-.5\" /><path d=\"M19 9.3v-2.8a3.5 3.5 0 0 0 -7 0\" /><path d=\"M6.5 16a3.5 3.5 0 0 1 0 -7h.5\" /><path d=\"M5 9.3v-2.8a3.5 3.5 0 0 1 7 0v10\" />",
  "stack-2": "<path d=\"M12 4l-8 4l8 4l8 -4l-8 -4\" /><path d=\"M4 12l8 4l8 -4\" /><path d=\"M4 16l8 4l8 -4\" />",
  "palette": "<path d=\"M12 21a9 9 0 0 1 0 -18c4.97 0 9 3.582 9 8c0 1.06 -.474 2.078 -1.318 2.828c-.844 .75 -1.989 1.172 -3.182 1.172h-2.5a2 2 0 0 0 -1 3.75a1.3 1.3 0 0 1 -1 2.25\" /><path d=\"M7.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\" /><path d=\"M11.5 7.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\" /><path d=\"M15.5 10.5a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\" />",
  "subtitles-ai": "<path d=\"M11.5 19h-5.5a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v4\" /><path d=\"M7 15h5\" /><path d=\"M17 12h-3\" /><path d=\"M11 12h-1\" /><path d=\"M19 22.5a4.75 4.75 0 0 1 3.5 -3.5a4.75 4.75 0 0 1 -3.5 -3.5a4.75 4.75 0 0 1 -3.5 3.5a4.75 4.75 0 0 1 3.5 3.5\" />",
  "headphones": "<path d=\"M4 15a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2l0 -3\" /><path d=\"M15 15a2 2 0 0 1 2 -2h1a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-1a2 2 0 0 1 -2 -2l0 -3\" /><path d=\"M4 15v-3a8 8 0 0 1 16 0v3\" />",
  "video": "<path d=\"M15 10l4.553 -2.276a1 1 0 0 1 1.447 .894v6.764a1 1 0 0 1 -1.447 .894l-4.553 -2.276v-4\" /><path d=\"M3 8a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2l0 -8\" />",
  "rocket": "<path d=\"M4 13a8 8 0 0 1 7 7a6 6 0 0 0 3 -5a9 9 0 0 0 6 -8a3 3 0 0 0 -3 -3a9 9 0 0 0 -8 6a6 6 0 0 0 -5 3\" /><path d=\"M7 14a6 6 0 0 0 -3 6a6 6 0 0 0 6 -3\" /><path d=\"M14 9a1 1 0 1 0 2 0a1 1 0 1 0 -2 0\" />",
  "refresh": "<path d=\"M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4\" /><path d=\"M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4\" />",
  "heart": "<path d=\"M19.5 12.572l-7.5 7.428l-7.5 -7.428a5 5 0 1 1 7.5 -6.566a5 5 0 1 1 7.5 6.572\" />",
  "layout-board-split": "<path d=\"M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12\" /><path d=\"M4 12h8\" /><path d=\"M12 15h8\" /><path d=\"M12 9h8\" /><path d=\"M12 4v16\" />"
};

// Devolve o <svg> pronto. Decorativo por padrão (aria-hidden): quem precisar
// de nome acessível põe o texto ao lado, visível ou em .sr-only.
function icone(nome, classe = '') {
  const corpo = ICONES[nome];
  if (!corpo) throw new Error(`Ícone desconhecido na landing: ${nome}`);
  return `<svg class="ico ${classe}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${corpo}</svg>`;
}

module.exports = { icone, ICONES };
