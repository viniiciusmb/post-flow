-- Conta extra nas redes sociais (12/10/2026, decisão do fundador): R$ 9,90 por
-- mês por conta, o cliente escolhe a rede na compra (+1 Instagram, +2 Facebook),
-- e vale pra TODOS os planos - quem está no Starter e só quer um 2º Instagram
-- não precisa subir de plano. (Canal do YouTube e conta do TikTok extras
-- continuam só no plano maior.)
--
-- Mesmo mecanismo dos extras que já existiam: uma cobrança avulsa libera na
-- hora e a mensalidade cai junto com a do plano a partir do ciclo seguinte (a
-- MESMA assinatura de extras do Asaas, com o valor total).

ALTER TABLE subscription_plans ADD COLUMN extra_rede_price_cents INTEGER;
UPDATE subscription_plans SET extra_rede_price_cents = 990 WHERE key IN ('starter', 'pro', 'max');

-- Quantas contas a mais em cada rede: {"instagram": 1, "facebook": 2}. Somado
-- ao max_contas_por_rede do plano, rede por rede.
ALTER TABLE client_subscriptions ADD COLUMN extra_redes JSONB NOT NULL DEFAULT '{}'::jsonb;

-- O que foi comprado numa cobrança (pra liberar, estornar e mostrar no extrato).
ALTER TABLE asaas_payments ADD COLUMN extra_redes JSONB;
