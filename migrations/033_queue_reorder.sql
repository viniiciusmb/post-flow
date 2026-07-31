-- Permite reordenar a fila de postagem arrastando os cortes na tela. NULL
-- (todo corte que ja existia antes dessa migration, ou que nunca foi
-- arrastado) cai no fallback "ordem de chegada" (ORDER BY COALESCE(queue_order,
-- id)) - so quando o cliente arrasta pela primeira vez e que os itens
-- visiveis naquele momento ganham um numero explicito (0,1,2...), sempre
-- menor que qualquer id futuro, entao um corte novo continua entrando no
-- fim da fila naturalmente. Ver postingsRepository.js.
ALTER TABLE postings
  ADD COLUMN queue_order BIGINT;
