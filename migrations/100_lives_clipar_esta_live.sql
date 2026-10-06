-- Tela "Lives" que vai pros clientes (06/10/2026). Cada canal tem a opcao
-- "clipar sempre que estiver ao vivo" (o automatico, que e paused_at NULL - o
-- mesmo "pausado" de antes, com outro nome na tela). Quem deixou o automatico
-- desligado pode apertar "Clipar" num canal ao vivo pra clipar SO AQUELA live:
-- e isto. Vale ate a live acabar (o status offline apaga a marca), entao nada
-- passa a gravar sozinho na live seguinte. So acrescenta coluna: inofensivo
-- para o codigo anterior.
ALTER TABLE live_channel_follows ADD COLUMN clip_this_live_at TIMESTAMPTZ;
