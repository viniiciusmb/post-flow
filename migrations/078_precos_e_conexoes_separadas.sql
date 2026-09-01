-- Três mudanças de cobrança pedidas pelo fundador em 01/09/2026.

-- ---------------------------------------------------------------------------
-- 1. Preço cheio do Pro e do Max
-- ---------------------------------------------------------------------------
--
-- Só a MENSALIDADE muda; a promoção de estreia (first_month_price_cents)
-- continua 99,90 e 139,90. Confirmado com o fundador antes de aplicar, porque
-- "troque o preço do Pro para 159,90" podia querer dizer o preço de estreia, e
-- as duas leituras cobram valores bem diferentes do cliente.
UPDATE subscription_plans SET price_cents = 15990 WHERE key = 'pro';
UPDATE subscription_plans SET price_cents = 22990 WHERE key = 'max';

-- ---------------------------------------------------------------------------
-- 2. Conexão extra deixa de ser um pacote fechado
-- ---------------------------------------------------------------------------
--
-- Até aqui, "conexão extra" era um slot indivisível que valia 1 canal do
-- YouTube E 1 conta do TikTok, por um preço só. Quem queria só mais um canal
-- pagava pelos dois.
--
-- Agora são dois produtos independentes, com desconto para quem leva o par:
--   canal do YouTube ....... R$ 14,90
--   conta do TikTok ........ R$ 29,90
--   os dois juntos ......... R$ 39,90  (economia de R$ 4,90 no par)
--
-- Os preços ficam nas três linhas de plano (e não numa configuração global)
-- para manter a regra que já existia: só vende conexão extra o plano que
-- tiver preço definido. Hoje é só o Max — quem está no Starter ou no Pro sobe
-- de plano, que continua sendo o caminho mais barato para ele.
ALTER TABLE subscription_plans
  ADD COLUMN extra_channel_price_cents INTEGER,
  ADD COLUMN extra_tiktok_price_cents  INTEGER,
  ADD COLUMN extra_both_price_cents    INTEGER;

UPDATE subscription_plans
   SET extra_channel_price_cents = 1490,
       extra_tiktok_price_cents  = 2990,
       extra_both_price_cents    = 3990
 WHERE extra_slot_price_cents IS NOT NULL;

-- Os dois contadores separados. Um slot antigo valia os dois, então ele vira
-- 1 canal + 1 conta — ninguém perde o que já pagou.
ALTER TABLE client_subscriptions
  ADD COLUMN extra_channels        INTEGER NOT NULL DEFAULT 0 CHECK (extra_channels >= 0),
  ADD COLUMN extra_tiktok_accounts INTEGER NOT NULL DEFAULT 0 CHECK (extra_tiktok_accounts >= 0);

UPDATE client_subscriptions
   SET extra_channels = extra_slots, extra_tiktok_accounts = extra_slots, updated_at = now()
 WHERE extra_slots > 0;

-- `extra_slots` e `extra_slot_price_cents` ficam por enquanto, sem uso pelo
-- código novo. Apagar coluna no mesmo deploy que troca o código é o jeito
-- rápido de descobrir, em produção, que algum lugar ainda lia ela — e aqui a
-- coluna guarda a única prova do que o cliente comprou antes.
COMMENT ON COLUMN client_subscriptions.extra_slots IS
  'OBSOLETA desde 01/09/2026 - substituída por extra_channels + extra_tiktok_accounts. Mantida como histórico do que foi comprado no modelo de pacote fechado.';

-- ---------------------------------------------------------------------------
-- 3. O extrato de faturas guarda o cartão usado NA ÉPOCA
-- ---------------------------------------------------------------------------
--
-- A tela de "Plano e uso" passa a listar tudo que o cliente pagou: dia, hora,
-- valor, produto e cartão. O cartão precisa ficar gravado NA FATURA, e não ser
-- lido de client_subscriptions na hora de exibir: o cliente troca de cartão, e
-- aí o extrato inteiro passaria a dizer que tudo foi pago no cartão novo —
-- reescrevendo o passado numa tela que existe justamente para provar o que
-- aconteceu.
ALTER TABLE asaas_payments
  ADD COLUMN card_brand TEXT,
  ADD COLUMN card_last4 TEXT,

  -- Quantos de CADA tipo esta compra levou. A coluna `slots` guardava um
  -- número só, que deixou de dizer o que foi comprado — e é justamente a
  -- pergunta de quem olha a fatura um mês depois. O aviso do Asaas chega
  -- depois (às vezes minutos), então a informação precisa estar gravada aqui:
  -- reconstruí-la do texto da descrição seria adivinhar.
  ADD COLUMN extra_channels        INTEGER,
  ADD COLUMN extra_tiktok_accounts INTEGER;
