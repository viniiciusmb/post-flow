-- No modo "cortar o video inteiro em partes" havia um jeito so de dividir:
-- dizer a duracao media de cada parte. Funciona quando o que importa e o
-- tamanho do corte, mas nao quando o que importa e o NUMERO de cortes - um
-- video de 24min com partes de 3min da 8 partes, e quem queria exatamente 10
-- nao tinha como pedir (teria que descobrir sozinho que 2,4min daria isso, e
-- a conta muda a cada video).
--
-- Agora sao duas variacoes da mesma opcao:
--   'duration' -> cliente diz os minutos, o sistema decide quantas partes
--   'count'    -> cliente diz quantas partes, o sistema decide os minutos
--
-- 'duration' fica como padrao porque e o comportamento que ja existia: quem
-- ja configurou o modo de partes nao pode ver o resultado mudar sozinho.
ALTER TABLE client_video_settings
  ADD COLUMN full_parts_mode TEXT NOT NULL DEFAULT 'duration'
    CHECK (full_parts_mode IN ('duration', 'count')),
  ADD COLUMN full_parts_count SMALLINT NOT NULL DEFAULT 8
    CHECK (full_parts_count BETWEEN 1 AND 30);
