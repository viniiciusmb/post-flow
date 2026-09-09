-- Programa de afiliados, segunda geração. Três mudanças que andam juntas:
--
--   1. Todo afiliado (não só o admin) pode criar vários links, um por lugar
--      onde ele divulga - bio do TikTok, descrição do YouTube, grupo. Isso já
--      cabia no schema (a UNIQUE parcial só limita o link PADRÃO a um por
--      dono), então aqui só entra o que faltava: um jeito de aposentar um link
--      sem apagá-lo.
--   2. Contagem de cliques por link, que é o que responde "de onde vêm as
--      vendas" mesmo antes de existir venda nenhuma.
--   3. Percentual diferente para a PRIMEIRA venda e para a RECORRÊNCIA, tanto
--      global quanto por afiliado.

-- ---------------------------------------------------------------------------
-- 1. Link arquivável
-- ---------------------------------------------------------------------------
-- Arquivar é ESCONDER DA LISTA, não desligar - e essa diferença é deliberada.
-- Um link que ficou meses na bio do TikTok continua sendo clicado por semanas
-- depois de o afiliado tirá-lo de lá: um link arquivado continua contando
-- clique e continua atribuindo a venda a quem a trouxe. Desligar de verdade
-- transformaria em "origem desconhecida" exatamente as vendas que ele ainda
-- está trazendo, que é dinheiro do afiliado.
--
-- E arquivar em vez de APAGAR porque referrals.affiliate_link_id aponta pra cá
-- com ON DELETE SET NULL: apagar um link apagaria junto a origem de todas as
-- vendas passadas dele.
ALTER TABLE affiliate_links
  ADD COLUMN archived_at TIMESTAMPTZ;

COMMENT ON COLUMN affiliate_links.archived_at IS
  'Quando o afiliado tirou o link da lista principal. Link arquivado CONTINUA funcionando (conta clique e atribui venda) - arquivar e so organizacao de tela. Nunca apague um link: referrals aponta pra ele.';

-- O link PADRÃO nunca é arquivável: é a garantia de que todo afiliado sempre
-- tem pelo menos um link à mão. Travado no banco, não só na tela.
ALTER TABLE affiliate_links
  ADD CONSTRAINT affiliate_links_padrao_nunca_arquivado
  CHECK (is_default = false OR archived_at IS NULL);

-- ---------------------------------------------------------------------------
-- 2. Cliques
-- ---------------------------------------------------------------------------
-- Uma linha por clique, não um contador na linha do link: contador não sabe
-- responder "quantos cliques na semana passada", que é justamente a pergunta
-- que o afiliado faz pra decidir onde continuar divulgando. O volume é baixo
-- (um clique é uma pessoa abrindo a landing) e o índice cobre as duas
-- consultas que existem: por link e por período.
--
-- NÃO guardamos o IP. visitor_hash é um resumo irreversível de IP+navegador,
-- que serve pra separar "10 cliques de 10 pessoas" de "10 cliques da mesma
-- pessoa recarregando" sem guardar dado pessoal nenhum - a política de
-- privacidade teria que declarar o IP, e ele não é necessário pra nada aqui.
CREATE TABLE affiliate_link_clicks (
  id                 BIGSERIAL PRIMARY KEY,
  affiliate_link_id  BIGINT NOT NULL REFERENCES affiliate_links(id) ON DELETE CASCADE,
  visitor_hash       TEXT,
  landing_path       TEXT,
  utm_source         TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_affiliate_link_clicks_link ON affiliate_link_clicks (affiliate_link_id, created_at);

COMMENT ON COLUMN affiliate_link_clicks.visitor_hash IS
  'Resumo irreversivel de IP+user-agent+segredo da app. Serve so pra contar visitante unico; o IP nunca e gravado.';

-- ---------------------------------------------------------------------------
-- 3. Primeira venda x recorrência
-- ---------------------------------------------------------------------------
-- O tipo é decidido no momento em que a comissão nasce e fica congelado, do
-- mesmo jeito que commission_percent já é um snapshot: recalcular depois
-- ("é a mais antiga deste indicado?") daria resposta diferente se um
-- lançamento antigo fosse removido, e comissão já paga não pode mudar de
-- natureza retroativamente.
ALTER TABLE commission_entries
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'recorrencia'
  CHECK (kind IN ('primeira', 'recorrencia'));

-- Backfill: a comissão mais antiga de cada indicado é a primeira venda dele.
-- (Em produção a tabela está vazia - nenhum pagamento real passou ainda - mas
-- a migration precisa estar certa contra qualquer base.)
UPDATE commission_entries ce
SET kind = 'primeira'
WHERE ce.id = (
  SELECT c2.id FROM commission_entries c2
  WHERE c2.referred_user_id = ce.referred_user_id
  ORDER BY c2.created_at, c2.id
  LIMIT 1
);

COMMENT ON COLUMN commission_entries.kind IS
  'primeira = a mensalidade de estreia daquele indicado; recorrencia = as mensalidades seguintes. Decidido na criacao e congelado.';

-- Percentual individual da RECORRÊNCIA. O commission_percent_override que já
-- existia passa a valer só para a primeira venda - é o que ele sempre foi na
-- prática (só havia um pagamento possível por vez), e nenhum afiliado muda de
-- valor por causa desta migration porque o padrão global da recorrência nasce
-- igual ao que já valia (ver o INSERT em settings mais abaixo).
ALTER TABLE affiliates
  ADD COLUMN commission_recurring_percent_override NUMERIC(5,2)
  CHECK (commission_recurring_percent_override IS NULL
         OR (commission_recurring_percent_override >= 0 AND commission_recurring_percent_override <= 100));

COMMENT ON COLUMN affiliates.commission_percent_override IS
  'Percentual individual da PRIMEIRA venda. NULL = usa o padrao global (settings.affiliate_commission_percent_default).';
COMMENT ON COLUMN affiliates.commission_recurring_percent_override IS
  'Percentual individual da RECORRENCIA. NULL = usa o padrao global (settings.affiliate_commission_recurring_percent_default).';

-- O padrão global da recorrência nasce valendo exatamente o que já era pago
-- hoje. Sem isso, ligar esta funcionalidade mudaria em silêncio o quanto os
-- afiliados atuais recebem, que é a última coisa que se pode fazer sem avisar.
INSERT INTO settings (key, value)
SELECT 'affiliate_commission_recurring_percent_default',
       coalesce((SELECT value FROM settings WHERE key = 'affiliate_commission_percent_default'), '10'::jsonb)
ON CONFLICT (key) DO NOTHING;
