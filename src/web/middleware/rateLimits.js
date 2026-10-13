// Limites de requisicao por categoria de rota.
//
// Antes so o login era limitado - as outras ~34 rotas de API aceitavam
// requisicao a vontade. Os limites abaixo sao generosos pro uso normal do
// painel (ninguem clica 60 vezes por minuto) e servem pra conter abuso,
// script perdido em loop e forca bruta.
//
// Chave do limite: o ID do usuario logado quando existe (assim um cliente nao
// derruba o limite de outro que esteja atras do mesmo IP/rede corporativa) e
// o IP quando nao ha sessao.
'use strict';

const rateLimit = require('express-rate-limit');

function keyByUserOrIp(req) {
  return req.session?.user?.id ? `u:${req.session.user.id}` : `ip:${req.ip}`;
}

function build({ windowMs, max, message, skip }) {
  return rateLimit({
    windowMs,
    max,
    skip,
    keyGenerator: keyByUserOrIp,
    standardHeaders: true,
    legacyHeaders: false,
    // Responde em JSON porque quase tudo aqui e chamado pela SPA via fetch -
    // uma pagina HTML de erro quebraria o tratamento de erro do frontend.
    handler: (req, res) => res.status(429).json({ error: message }),
  });
}

// Login/cadastro: forca bruta de senha. Por IP mesmo (nao ha sessao ainda).
const auth = build({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
});

// Rotas publicas SEM sessao nenhuma - a mais exposta e a de registro do
// programa de bandeja (/api/tunnel/register-pending), que qualquer um na
// internet pode chamar. Limite por IP.
const publicApi = build({
  windowMs: 10 * 60 * 1000,
  max: 30,
  message: 'Muitas requisicoes. Aguarde alguns minutos.',
});

// Billing/pagamento: mexe com dinheiro (assinar plano, comprar avulso,
// cadastrar cartao). Limite baixo de proposito - ninguem precisa fazer isso
// dezenas de vezes por minuto, e um loop acidental aqui cobraria de verdade.
//
// So conta ENVIO (POST/PUT/DELETE): leitura nao move dinheiro, e contar leitura
// travava a tela do QR do PIX, que pergunta "ja pagou?" a cada 4s - depois de
// ~80s ela levava 429 calada e quem pagou no app do banco nunca via a
// confirmacao. Leitura fica no limite `geral`, como o resto da API.
const billing = build({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: 'Muitas operacoes de cobranca em pouco tempo. Aguarde alguns minutos.',
  skip: (req) => req.method === 'GET' || req.method === 'HEAD',
});

// Upload de video: cada arquivo pode ter ate 2GB e ocupa disco na VPS.
const upload = build({
  windowMs: 60 * 60 * 1000,
  max: 30,
  message: 'Voce enviou muitos videos em pouco tempo. Aguarde um pouco.',
});

// Todo o resto da API autenticada. Teto alto o suficiente pra nunca atrapalhar
// o uso normal (as telas fazem polling de 8 em 8 segundos), mas ainda assim um
// teto.
const geral = build({
  windowMs: 60 * 1000,
  max: 300,
  message: 'Muitas requisicoes em pouco tempo. Aguarde um instante.',
});

// Suporte com IA: cada mensagem custa uma chamada ao Claude. O teto diario de
// mensagens fica no servico; este segura rajada (script, clique repetido).
const suporte = build({
  windowMs: 10 * 60 * 1000,
  max: 15,
  message: 'Muitas mensagens em pouco tempo. Aguarde alguns minutos.',
});

module.exports = { auth, publicApi, billing, upload, geral, suporte };
