-- Qual modelo respondeu cada mensagem do suporte (06/10/2026). A Flora passou
-- a escolher o modelo pela complexidade da pergunta (ver
-- src/services/suporte/escolhaDoModelo.js); sem isto nao daria pra auditar se
-- a economia esta acontecendo nem quanto cada nivel custa. So acrescenta
-- coluna: inofensivo para o codigo anterior.
ALTER TABLE support_messages ADD COLUMN model TEXT;
