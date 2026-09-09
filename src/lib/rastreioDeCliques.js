'use strict';

// Decide se uma visita com ?ref= vale como CLIQUE de verdade.
//
// Duas coisas inflam essa contagem se ninguém filtrar, e as duas fazem o
// afiliado tomar decisão errada sobre onde divulgar:
//
//   1. Prévia de link. Colar o link num grupo de WhatsApp faz o servidor do
//      WhatsApp abrir a página pra montar o cartãozinho - e o mesmo vale pro
//      Facebook, Telegram, Slack, Discord e pro robô de busca do Google.
//      Sem filtro, um link colado num grupo já nasce com cliques que nenhuma
//      pessoa deu.
//   2. Recarregar a página. A mesma pessoa apertando F5 três vezes não é
//      três pessoas interessadas.
const SINAIS_DE_ROBO = [
  'bot', 'crawl', 'spider', 'slurp', 'preview', 'fetcher', 'monitor',
  'facebookexternalhit', 'whatsapp', 'telegram', 'slack', 'discord',
  'twitter', 'linkedin', 'pinterest', 'embedly', 'skype', 'curl', 'wget',
  'python-requests', 'axios', 'headless', 'lighthouse', 'pingdom',
];

// Janela de silêncio por link: dentro dela, o mesmo navegador não conta de
// novo. 30 minutos cobre o recarregar e o "voltar" do navegador sem deixar de
// contar quem realmente voltou depois pra decidir assinar.
const JANELA_DE_SILENCIO_MS = 30 * 60 * 1000;

function pareceRobo(userAgent) {
  // Sem user-agent nenhum é quase sempre script - navegador de verdade sempre
  // manda um.
  if (!userAgent) return true;
  const ua = String(userAgent).toLowerCase();
  return SINAIS_DE_ROBO.some((sinal) => ua.includes(sinal));
}

// Guardado na sessão, que é o único lugar que sabe de verdade se é o MESMO
// navegador (mais confiável que IP, que muda de rede em rede e é compartilhado
// por todo mundo atrás do mesmo Wi-Fi). Devolve true quando o clique deve ser
// contado, e já marca o horário.
function contaAgora(sessao, code, agora = Date.now()) {
  if (!sessao) return false;
  const vistos = sessao.cliquesDeAfiliado || {};
  const ultimo = vistos[code];
  if (typeof ultimo === 'number' && agora - ultimo < JANELA_DE_SILENCIO_MS) return false;

  // Só guarda os últimos códigos: a sessão vira cookie/linha de banco, e um
  // visitante que passasse por dezenas de links faria ela crescer sem limite.
  const entradas = Object.entries(vistos)
    .filter(([chave]) => chave !== code)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 19);
  sessao.cliquesDeAfiliado = Object.fromEntries([...entradas, [code, agora]]);
  return true;
}

module.exports = { pareceRobo, contaAgora, SINAIS_DE_ROBO, JANELA_DE_SILENCIO_MS };
