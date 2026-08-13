'use strict';

// Captura ?ref=codigo e as UTMs de qualquer pagina publica e guarda na sessao
// ate o cadastro acontecer (registro normal ou primeira vez pelo Google).
// Precisa vir DEPOIS da sessao/CSRF (usa req.session) e ANTES das rotas
// publicas - qualquer uma delas pode receber o parametro, nao so a landing
// (alguem pode compartilhar um link direto pra /termos, por exemplo).
const REF_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;

function affiliateAttribution(req, res, next) {
  const ref = req.query.ref;
  if (typeof ref === 'string' && REF_PATTERN.test(ref)) {
    req.session.affiliateAttribution = req.session.affiliateAttribution || {};
    req.session.affiliateAttribution.refCode = ref;
  }

  const utmFields = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  const hasUtm = utmFields.some((f) => typeof req.query[f] === 'string' && req.query[f].length > 0);
  if (hasUtm) {
    req.session.affiliateAttribution = req.session.affiliateAttribution || {};
    req.session.affiliateAttribution.utm = {
      source: typeof req.query.utm_source === 'string' ? req.query.utm_source.slice(0, 200) : null,
      medium: typeof req.query.utm_medium === 'string' ? req.query.utm_medium.slice(0, 200) : null,
      campaign: typeof req.query.utm_campaign === 'string' ? req.query.utm_campaign.slice(0, 200) : null,
      content: typeof req.query.utm_content === 'string' ? req.query.utm_content.slice(0, 200) : null,
      term: typeof req.query.utm_term === 'string' ? req.query.utm_term.slice(0, 200) : null,
    };
  }

  if ((ref && REF_PATTERN.test(ref)) || hasUtm) {
    req.session.affiliateAttribution.landingPath = req.path;
  }

  next();
}

module.exports = affiliateAttribution;
