-- Resultado da última checagem de cada canal do YouTube.
--
-- Até agora, quando a checagem de um canal falhava, o erro só ia pro log do
-- servidor. Aconteceu de verdade: dois canais ficaram 3 dias sem serem
-- checados e a tela só mostrava "última checagem: 31/07" - que parecia um
-- agendamento parado, quando na verdade a checagem rodava a cada 20 minutos e
-- falhava toda vez. Ninguém tinha como saber sem abrir o log do servidor.
--
-- Com estas colunas, a tela consegue dizer "a última checagem falhou e por
-- quê", e a hora da última TENTATIVA passa a ser gravada mesmo quando dá erro
-- (antes só era gravada quando dava certo, que é o que congelava a data).

ALTER TABLE youtube_channels
  -- Quando rodou a última TENTATIVA (deu certo ou não). O last_polled_at
  -- continua significando "última vez que conseguimos ler o canal" - os dois
  -- juntos é que contam a história.
  ADD COLUMN IF NOT EXISTS last_check_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_check_ok    BOOLEAN,
  -- Mensagem do erro, já resumida. NULL quando a última checagem deu certo.
  ADD COLUMN IF NOT EXISTS last_check_error TEXT,
  -- Quantas falhas seguidas. Zera a cada sucesso. Serve pra tela diferenciar
  -- "falhou uma vez agora" (normal, o YouTube oscila) de "está falhando há
  -- horas" (precisa de atenção).
  ADD COLUMN IF NOT EXISTS check_fail_count INTEGER NOT NULL DEFAULT 0;

-- Os canais que já existem nunca foram checados com este código: começar com
-- last_check_at = last_polled_at evita mostrar "nunca checado" pra canal que
-- na verdade vinha funcionando.
UPDATE youtube_channels
   SET last_check_at = last_polled_at
 WHERE last_check_at IS NULL AND last_polled_at IS NOT NULL;
