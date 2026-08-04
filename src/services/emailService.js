// Envio de e-mail transacional (Resend).
//
// Sem dependência nova: a API da Resend é um POST JSON, e o pacote oficial só
// embrulharia isso. Menos uma biblioteca pra manter atualizada.
//
// IMPORTANTE sobre o remetente: `onboarding@resend.dev` (que aparece nos
// exemplos da Resend) é caixa de teste e SÓ entrega no e-mail do dono da conta.
// Qualquer envio pra cliente real precisa sair de um domínio verificado, que é
// o caso de postflowclips.com. Se um dia o remetente voltar pro exemplo, a
// recuperação de senha para de funcionar em silêncio para todo mundo menos o
// fundador.
'use strict';

const config = require('../config');
const logger = require('../lib/logger');
const { CONTACT } = require('../config/constants');

const API_URL = 'https://api.resend.com/emails';
const REMETENTE = `Post Flow <${CONTACT.supportEmail}>`;

function isConfigured() {
  return Boolean(config.resend.apiKey);
}

async function send({ to, subject, html, text }) {
  if (!isConfigured()) {
    throw new Error('Envio de e-mail não está configurado (falta RESEND_API_KEY).');
  }

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.resend.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: REMETENTE, to: [to], subject, html, text }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Resend recusou o envio: ${data.message || response.statusText}`);
  }
  logger.info(`E-mail "${subject}" enviado para ${to} (id ${data.id}).`);
  return data;
}

// Layout simples de propósito: e-mail transacional que cai no spam não serve
// pra nada, e HTML pesado com imagem externa é um dos gatilhos clássicos.
// Tudo aqui é texto e estilo embutido.
function layout(titulo, corpo, botao) {
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px;background:#f0f1f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#08090a">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <div style="font-size:17px;font-weight:600;letter-spacing:-0.02em;margin-bottom:24px">Post Flow</div>
    <h1 style="font-size:20px;font-weight:600;letter-spacing:-0.02em;margin:0 0 12px">${titulo}</h1>
    <div style="font-size:15px;line-height:1.6;color:#4b5057">${corpo}</div>
    ${
      botao
        ? `<div style="margin:28px 0">
             <a href="${botao.url}" style="display:inline-block;background:#08090a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:15px;font-weight:500">${botao.texto}</a>
           </div>
           <p style="font-size:13px;line-height:1.6;color:#6b7075;margin:0">
             Se o botão não funcionar, copie e cole este endereço no navegador:<br>
             <span style="color:#2f54eb;word-break:break-all">${botao.url}</span>
           </p>`
        : ''
    }
    <hr style="border:0;border-top:1px solid #ececef;margin:28px 0">
    <p style="font-size:12px;line-height:1.6;color:#6b7075;margin:0">
      Você recebeu este e-mail porque existe uma conta no Post Flow com este endereço.
      Dúvidas: <a href="mailto:${CONTACT.supportEmail}" style="color:#2f54eb">${CONTACT.supportEmail}</a>
    </p>
  </div>
</body></html>`;
}

async function sendPasswordReset({ to, resetUrl, expiraEmMinutos }) {
  return send({
    to,
    subject: 'Redefinir sua senha do Post Flow',
    html: layout(
      'Redefinir sua senha',
      `<p style="margin:0 0 12px">Recebemos um pedido para redefinir a senha da sua conta.</p>
       <p style="margin:0">O link abaixo vale por ${expiraEmMinutos} minutos e só pode ser usado uma vez.
       Se não foi você que pediu, pode ignorar este e-mail: sua senha continua a mesma.</p>`,
      { url: resetUrl, texto: 'Criar uma nova senha' }
    ),
    text:
      `Recebemos um pedido para redefinir a senha da sua conta no Post Flow.\n\n` +
      `Abra este endereço para criar uma nova senha (vale por ${expiraEmMinutos} minutos, uma vez só):\n${resetUrl}\n\n` +
      `Se não foi você que pediu, ignore este e-mail: sua senha continua a mesma.`,
  });
}

module.exports = { isConfigured, send, sendPasswordReset };
