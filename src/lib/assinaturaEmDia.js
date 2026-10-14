// Quem tem direito a serviço agora (14/10/2026, decisão do fundador): cliente
// que não pagou fica sem nenhuma funcionalidade - nada de processar vídeo,
// clipar live nem publicar nos perfis. O primeiro caso foi o Eduardo (#203):
// a renovação foi recusada no cartão e os 14 cortes dele continuavam saindo.
//
// Fica sem serviço quem tem a assinatura 'inadimplente' (cobrança recusada) ou
// 'cancelado' (cancelou e o período pago já acabou). Admin nunca. Conta sem
// plano não entra aqui: ela já não consegue usar nada pelos limites do plano
// (0 contas, 0 canais), e travar por aqui quebraria quem está só olhando o
// painel para escolher um plano. Um texto SQL só, usado por todo job que
// decide trabalhar para alguém; se cada um tivesse a própria regra, um deles
// ia esquecer o inadimplente.
'use strict';

const SITUACOES_SEM_SERVICO = ['inadimplente', 'cancelado'];

function sqlEmDia(colunaDoUsuario) {
  return `(EXISTS (SELECT 1 FROM users ux WHERE ux.id = ${colunaDoUsuario} AND ux.role = 'admin')
       OR NOT EXISTS (SELECT 1 FROM client_subscriptions csx
                       WHERE csx.client_user_id = ${colunaDoUsuario} AND csx.status IN ('inadimplente', 'cancelado')))`;
}

module.exports = { sqlEmDia, SITUACOES_SEM_SERVICO };
