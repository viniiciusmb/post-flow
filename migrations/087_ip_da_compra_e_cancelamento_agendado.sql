-- Duas colunas, as duas só ACRESCENTAM: o código antigo continua funcionando
-- com elas no banco. Por isso esta migration pode (e deve) rodar ANTES do
-- deploy - o código novo grava nas duas, e sem elas o checkout quebraria.

-- IP de quem fez a compra, gravado quando a cobrança nasce.
--
-- A Utmify recusa venda com `customer.ip` nulo ("customer.ip cannot be null"),
-- e só o momento da compra tem o IP: o aviso de "venda aprovada" sai do
-- webhook do Asaas (IP do Asaas, não do cliente) e o PIX é pago horas depois,
-- no app do banco. Sem guardar aqui, em 14-15/09/2026 a venda aprovada do
-- cartão e as duas do PIX foram recusadas pela Utmify e nunca apareceram.
ALTER TABLE asaas_payments ADD COLUMN IF NOT EXISTS customer_ip TEXT;

-- Quando um cancelamento de assinatura passa a valer.
--
-- Os termos de uso prometem que "o acesso continua até o fim do período já
-- pago". Então um cancelamento que chega do Asaas no meio do mês NÃO corta o
-- cliente na hora: grava aqui o fim do período pago, e o status só vira
-- 'cancelado' quando essa data chega (ver cancelamentoDeAssinaturaService).
-- NULL = nenhum cancelamento agendado.
ALTER TABLE client_subscriptions ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMPTZ;
