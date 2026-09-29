-- Tipo do momento escolhido pelo juiz das lives (piada, mancada, dinheiro,
-- polemica...). Pedido de 29/09/2026: dinheiro/ostentacao/polemica viralizam
-- pela FRASE e nao podem ser barrados pela exigencia de reacao do publico dos
-- niveis altos - pra isso o tipo precisa ficar GRAVADO (nunca deduzido
-- relendo o texto do "porque"). So acrescenta coluna numa tabela live_*.
ALTER TABLE live_candidates ADD COLUMN moment_type TEXT;
