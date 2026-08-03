// Recuperação de senha (API consumida pelas telas /esqueci-senha e
// /redefinir-senha do painel).
//
// Duas regras guiam este arquivo:
//
// 1. A resposta NUNCA revela se um e-mail existe. Se pedir redefinição pra
//    "fulano@gmail.com" respondesse "essa conta não existe", o formulário
//    viraria um verificador de cadastro: daria pra descobrir quem é cliente.
//    Por isso a resposta é sempre a mesma, exista ou não a conta.
//
// 2. O token do link é de uso único, some em 30 minutos, e o banco guarda só o
//    hash dele (ver passwordResetTokensRepository).
'use strict';

const bcrypt = require('bcryptjs');
const pool = require('../../../db/pool');
const usersRepository = require('../../../repositories/usersRepository');
const tokensRepository = require('../../../repositories/passwordResetTokensRepository');
const emailService = require('../../../services/emailService');
const logger = require('../../../lib/logger');
const { CONTACT } = require('../../../config/constants');

const SALT_ROUNDS = 10;
const MAX_PEDIDOS_POR_HORA = 5;
const SENHA_MINIMA = 8;

// Mensagem única, propositalmente vaga sobre a existência da conta.
const RESPOSTA_PADRAO =
  'Se existir uma conta com esse e-mail, o link de redefinição já está a caminho. Confira também a caixa de spam.';

async function request(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Escreva o e-mail da sua conta.' });

  const user = await usersRepository.findByEmail(email);

  // Conta inexistente ou desativada: responde igual e não faz nada.
  if (user && user.is_active) {
    // Trava contra usar o formulário pra encher a caixa de e-mail de alguém.
    // Também responde igual, pra não revelar que a conta existe.
    const recentes = await tokensRepository.countRecentByUser(user.id);
    if (recentes >= MAX_PEDIDOS_POR_HORA) {
      logger.warn(`Muitos pedidos de redefinição para o usuário ${user.id} - ignorando.`);
    } else {
      const { token, expiraEmMinutos } = await tokensRepository.create(user.id, { requestedIp: req.ip });
      const resetUrl = `${CONTACT.siteUrl}/redefinir-senha?token=${encodeURIComponent(token)}`;
      try {
        await emailService.sendPasswordReset({ to: user.email, resetUrl, expiraEmMinutos });
      } catch (err) {
        // Falha de envio não pode virar pista de que a conta existe, então a
        // resposta continua a mesma. Fica no log pro dono do sistema ver.
        logger.error(`Falha ao enviar e-mail de redefinição para ${user.email}:`, err.message);
      }
    }
  }

  return res.json({ message: RESPOSTA_PADRAO });
}

// A tela chama isto ao abrir, pra já avisar que o link venceu em vez de deixar
// a pessoa digitar a senha nova duas vezes e só então descobrir.
async function check(req, res) {
  const token = String(req.query.token || '');
  const encontrado = token ? await tokensRepository.findValidUser(token) : null;
  return res.json({ valid: Boolean(encontrado) });
}

async function reset(req, res) {
  const token = String(req.body.token || '');
  const senha = String(req.body.password || '');

  if (senha.length < SENHA_MINIMA) {
    return res.status(400).json({ error: `A nova senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.` });
  }

  const encontrado = await tokensRepository.findValidUser(token);
  if (!encontrado) {
    return res.status(400).json({ error: 'Esse link expirou ou já foi usado. Peça um novo.', expired: true });
  }

  // Marca o token ANTES de trocar a senha. Se dois cliques chegarem juntos, só
  // um passa daqui; o outro para com "link já usado" em vez de as duas
  // requisições gravarem senhas diferentes e a pessoa não saber qual valeu.
  const conseguiuMarcar = await tokensRepository.markUsed(encontrado.id);
  if (!conseguiuMarcar) {
    return res.status(400).json({ error: 'Esse link já foi usado. Peça um novo.', expired: true });
  }

  const hash = await bcrypt.hash(senha, SALT_ROUNDS);
  await usersRepository.updatePasswordHash(encontrado.user_id, hash);

  // Derruba as sessões abertas dessa conta. Se alguém entrou com a senha
  // antiga, trocar a senha tem que expulsar essa pessoa - senão a redefinição
  // não resolve justamente o caso em que ela mais importa.
  //
  // O ->> devolve texto tanto se o id foi salvo como número quanto como string
  // (BIGINT vem do Postgres como string), então funciona nos dois casos.
  //
  // Falhar aqui não pode derrubar a requisição: a senha JÁ foi trocada acima, e
  // responder erro deixaria a pessoa achando que não funcionou (e tentando de
  // novo com um token já queimado). Fica no log pra investigar.
  try {
    await pool.query("DELETE FROM session WHERE sess->'user'->>'id' = $1", [String(encontrado.user_id)]);
  } catch (err) {
    logger.error(
      `Senha do usuário ${encontrado.user_id} foi trocada, mas as sessões antigas NÃO foram encerradas:`,
      err.message
    );
  }

  logger.info(`Senha redefinida para o usuário ${encontrado.user_id}.`);
  return res.json({ ok: true });
}

module.exports = { request, check, reset, RESPOSTA_PADRAO, SENHA_MINIMA };
