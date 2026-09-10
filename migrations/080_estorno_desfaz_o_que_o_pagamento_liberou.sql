-- Estorno e contestação de cartão: desfazer o que o pagamento tinha liberado.
--
-- Até aqui nenhum evento de estorno era tratado - eles caíam no `default:` do
-- webhook e passavam em silêncio. O resultado era prejuízo em dobro no mesmo
-- evento: o dinheiro voltava para o cliente E a comissão do afiliado
-- continuava creditada e sacável. Além disso o plano seguia ativo, o crédito
-- avulso seguia no saldo e as conexões extras seguiam liberadas.

-- ---------------------------------------------------------------------------
-- Comissão estornada
-- ---------------------------------------------------------------------------
-- A entrada NÃO é apagada, é marcada. Apagar deixaria o extrato do afiliado
-- com um buraco inexplicável ("recebi R$20 mês passado e agora sumiu"), e
-- ainda faria o sistema achar que a próxima mensalidade daquele indicado é a
-- PRIMEIRA venda de novo - pagando o percentual de entrada duas vezes pelo
-- mesmo cliente.
ALTER TABLE commission_entries
  ADD COLUMN reversed_at     TIMESTAMPTZ,
  ADD COLUMN reversal_reason TEXT;

COMMENT ON COLUMN commission_entries.reversed_at IS
  'Quando o pagamento que gerou esta comissao foi estornado/contestado. Entrada marcada sai de todas as somas, mas continua contando para decidir primeira venda x recorrencia e para o teto de meses.';

-- Achar rápido a entrada de um pagamento que acabou de ser estornado. O
-- webhook chega com o id do pagamento e nada mais.
CREATE INDEX idx_commission_entries_external_payment
  ON commission_entries (external_payment_id);

-- ---------------------------------------------------------------------------
-- O pagamento em si
-- ---------------------------------------------------------------------------
-- 'estornado' é um estado final diferente de 'falhou': falhou é o pagamento
-- que nunca aconteceu (PIX não pago, cartão recusado), estornado é o que
-- aconteceu e foi desfeito. Um extrato que chama os dois de "falhou" não
-- responde a pergunta que se faz olhando para ele - "esse dinheiro entrou?".
ALTER TABLE asaas_payments
  DROP CONSTRAINT IF EXISTS asaas_payments_status_check;
ALTER TABLE asaas_payments
  ADD CONSTRAINT asaas_payments_status_check
  CHECK (status IN ('pendente', 'pago', 'falhou', 'cancelado', 'estornado'));

ALTER TABLE credit_purchases
  DROP CONSTRAINT IF EXISTS credit_purchases_status_check;
ALTER TABLE credit_purchases
  ADD CONSTRAINT credit_purchases_status_check
  CHECK (status IN ('pendente', 'pago', 'falhou', 'estornado'));
