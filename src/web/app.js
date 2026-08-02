'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);

const config = require('../config');
const pool = require('../db/pool');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const clientRoutes = require('./routes/clientRoutes');
const tiktokRoutes = require('./routes/tiktokRoutes');
const googleRoutes = require('./routes/googleRoutes');
const authApiRoutes = require('./routes/api/authApiRoutes');
const adminApiRoutes = require('./routes/api/adminApiRoutes');
const clientApiRoutes = require('./routes/api/clientApiRoutes');
const youtubeChannelsApiRoutes = require('./routes/api/youtubeChannelsApiRoutes');
const sourceVideosApiRoutes = require('./routes/api/sourceVideosApiRoutes');
const clientDriveApiRoutes = require('./routes/api/clientDriveApiRoutes');
const clientVideoSettingsApiRoutes = require('./routes/api/clientVideoSettingsApiRoutes');
const clientPostingsApiRoutes = require('./routes/api/clientPostingsApiRoutes');
const tiktokAccountsApiRoutes = require('./routes/api/tiktokAccountsApiRoutes');
const tunnelPublicApiRoutes = require('./routes/api/tunnelPublicApiRoutes');
const clientTunnelApiRoutes = require('./routes/api/clientTunnelApiRoutes');
const clientBillingApiRoutes = require('./routes/api/clientBillingApiRoutes');
const adminBillingApiRoutes = require('./routes/api/adminBillingApiRoutes');
const stripeWebhookApiRoutes = require('./routes/api/stripeWebhookApiRoutes');
const errorHandler = require('./middleware/errorHandler');
const csrf = require('./middleware/csrf');
const rateLimits = require('./middleware/rateLimits');

const app = express();

// Necessario em producao: o app roda atras de um proxy reverso (Traefik/nginx)
// que termina o HTTPS e repassa a requisicao em HTTP puro. Sem isso, o Express
// nao confia no cabecalho X-Forwarded-Proto e o cookie de sessao "secure"
// (abaixo) nunca seria enviado corretamente.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// img-src precisa liberar https: (nao so 'self') pra thumbnail do YouTube
// (i.ytimg.com), avatar do canal (yt3.googleusercontent.com) e avatar do
// TikTok (cdn deles) aparecerem - por padrao o Helmet so libera 'self'.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'img-src': ["'self'", 'data:', 'https:'],
      },
    },
  })
);
// Precisa vir ANTES do express.json() global: o webhook da Stripe verifica
// a assinatura contra o corpo BRUTO da requisicao - se o JSON generico
// parseasse primeiro, os bytes originais se perderiam e a verificacao
// falharia sempre.
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(
  '/assets',
  express.static(path.join(__dirname, '../../web-client/dist/assets'), {
    maxAge: '1y',
    immutable: true,
  })
);

app.use(
  session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.isProduction,
      // 'lax' e a defesa principal contra CSRF: o navegador nao manda esse
      // cookie num POST/PUT/DELETE vindo de outro site. NAO pode ser 'strict'
      // porque os retornos de OAuth (TikTok/Google) sao navegacoes vindas de
      // outro dominio - com 'strict' o usuario voltaria "deslogado" do
      // callback e a conexao nunca completaria.
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias
    },
  })
);

// Segunda camada anti-CSRF (token de dupla submissao). Precisa vir depois da
// sessao (guarda o token nela) e antes das rotas. Ver middleware/csrf.js.
app.use(csrf.middleware);

// Deixa req.session.user disponivel em todas as views (nav, saudacao, etc).
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

// Limites de requisicao por categoria (ver middleware/rateLimits.js). A ordem
// importa: o mais especifico primeiro, o teto geral por ultimo. O webhook da
// Stripe fica de fora - quem chama e a Stripe, que pode legitimamente mandar
// varios eventos de uma vez, e a rota ja e autenticada por assinatura.
app.use(['/login', '/register', '/api/auth/login'], rateLimits.auth);
app.use('/api/tunnel', rateLimits.publicApi);
app.use(['/api/client/billing', '/api/admin/billing'], rateLimits.billing);
app.use('/api/client/source-videos/upload', rateLimits.upload);
app.use('/api', (req, res, next) =>
  req.path.startsWith('/stripe/webhook') ? next() : rateLimits.geral(req, res, next)
);

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.redirect(req.session.user.role === 'admin' ? '/admin' : '/client');
});

const LEGAL_UPDATED_AT = '28/07/2026';
app.get('/termos', (req, res) => {
  res.render('legal/terms', { title: 'Termos de Servico', updatedAt: LEGAL_UPDATED_AT });
});
app.get('/privacidade', (req, res) => {
  res.render('legal/privacy', { title: 'Politica de Privacidade', updatedAt: LEGAL_UPDATED_AT });
});

app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/client', clientRoutes);
app.use('/auth/tiktok', tiktokRoutes);
app.use('/auth/google', googleRoutes);
app.use('/api/auth', authApiRoutes);
app.use('/api/admin', adminApiRoutes);
app.use('/api/client', clientApiRoutes);
app.use('/api/client/youtube-channels', youtubeChannelsApiRoutes);
app.use('/api/client/source-videos', sourceVideosApiRoutes);
app.use('/api/client/drive', clientDriveApiRoutes);
app.use('/api/client/video-settings', clientVideoSettingsApiRoutes);
app.use('/api/client/postings', clientPostingsApiRoutes);
app.use('/api/client/tiktok-accounts', tiktokAccountsApiRoutes);
app.use('/api/tunnel', tunnelPublicApiRoutes);
app.use('/api/client/tunnel', clientTunnelApiRoutes);
app.use('/api/client/billing', clientBillingApiRoutes);
app.use('/api/admin/billing', adminBillingApiRoutes);
app.use('/api/stripe/webhook', stripeWebhookApiRoutes);
app.use('/api', (req, res) => res.status(404).json({ error: 'Rota nao encontrada.' }));

app.use((req, res) => {
  res.status(404).render('errors/generic', { title: 'Nao encontrado', message: 'Pagina nao encontrada.' });
});

app.use(errorHandler);

module.exports = app;
