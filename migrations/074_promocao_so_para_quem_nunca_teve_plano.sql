-- A promoção de primeiro mês passa a valer só para quem NUNCA teve plano.
--
-- Como estava: a única trava era `first_month_used_at` (marcado quando o
-- primeiro mês é PAGO). Isso deixava passar um caso inteiro — cliente que já
-- tem plano ATIVO, mas que nunca pagou por ele pela tela: plano atribuído na
-- mão pelo admin (é assim que todo cliente é ativado hoje), plano herdado de
-- migração, conta de teste. Todos viam "R$59,90 no 1º mês" na tela de Plano e
-- uso, o que é exatamente o relato do fundador: a conta de teste dele estava
-- com plano ativo e ganhava o desconto mesmo assim.
--
-- A regra que o fundador definiu: o desconto é de ESTREIA. Vale para usuário
-- novo, que nunca assinou nem teve plano nenhum, e só no primeiro mês.
--
-- Por que uma coluna nova em vez de olhar `plan_id IS NULL`: o estado atual
-- não conta a história. Um cliente que teve plano e foi rebaixado para
-- 'sem_plano' voltaria a ser "novo" e ganharia o desconto de novo — que é a
-- mesma porta dos fundos que `first_month_used_at` já existia para fechar.
-- Um carimbo que só é escrito UMA vez não se desfaz.
ALTER TABLE client_subscriptions
  ADD COLUMN first_plan_at TIMESTAMPTZ;

COMMENT ON COLUMN client_subscriptions.first_plan_at IS
  'Quando este cliente teve um plano pela PRIMEIRA vez, por qualquer caminho (admin, checkout, webhook). Escrito uma vez só; nunca volta a NULL. Existir aqui = não é mais usuário novo = sem promoção de primeiro mês.';

-- Backfill: todo mundo que hoje tem plano, ou que já saiu de 'sem_plano',
-- já teve um plano — inclusive as contas de teste. Sem isto, a correção não
-- alcançaria justamente as contas que motivaram este trabalho.
--
-- `updated_at` é a melhor data disponível (a atribuição do plano passa por
-- setPlan, que a toca); `created_at` cobre a linha que nunca foi atualizada.
UPDATE client_subscriptions
   SET first_plan_at = COALESCE(updated_at, created_at)
 WHERE first_plan_at IS NULL
   AND (plan_id IS NOT NULL OR status <> 'sem_plano');
