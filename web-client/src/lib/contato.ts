/**
 * Dados de contato mostrados no painel.
 *
 * Isto é uma CÓPIA de `src/config/constants.js` (o servidor). O painel é um
 * pacote estático servido pronto, então não tem como ler a constante do
 * servidor em tempo de execução sem injetar no HTML — e injetar um HTML por
 * página só por causa de um e-mail não se paga.
 *
 * O que impede as duas de divergirem é um teste (`tests/web/contato.test.js`),
 * que falha se este valor sair do valor do servidor.
 */
export const EMAIL_SUPORTE = "contato@postflowclips.com"
