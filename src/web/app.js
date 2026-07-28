'use strict';

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const rateLimit = require('express-rate-limit');

const config = require('../config');
const pool = require('../db/pool');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const clientRoutes = require('./routes/clientRoutes');
const tiktokRoutes = require('./routes/tiktokRoutes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Necessario em producao: o app roda atras de um proxy reverso (Traefik/nginx)
// que termina o HTTPS e repassa a requisicao em HTTP puro. Sem isso, o Express
// nao confia no cabecalho X-Forwarded-Proto e o cookie de sessao "secure"
// (abaixo) nunca seria enviado corretamente.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new pgSession({ pool, tableName: 'session', createTableIfMissing: true }),
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: config.isProduction,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 dias
    },
  })
);

// Deixa req.session.user disponivel em todas as views (nav, saudacao, etc).
app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  next();
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use(['/login', '/register'], loginLimiter);

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.redirect(req.session.user.role === 'admin' ? '/admin' : '/client');
});

app.use('/', authRoutes);
app.use('/admin', adminRoutes);
app.use('/client', clientRoutes);
app.use('/auth/tiktok', tiktokRoutes);

app.use((req, res) => {
  res.status(404).render('errors/generic', { title: 'Nao encontrado', message: 'Pagina nao encontrada.' });
});

app.use(errorHandler);

module.exports = app;
