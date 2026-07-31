-- Controles de emergencia pra fila de postagem, pedidos depois de um susto
-- com a fila postando errado: (1) pausa manual por conta, checada pelo job
-- antes de publicar qualquer coisa; (2) horario "vai postar" agora fica
-- gravado na propria postagem em vez de recalculado toda hora - antes, ao
-- clicar "Nao postar" num corte, a tela recalculava as posicoes de TODOS os
-- outros da fila (que so existia em memoria, olhando a posicao de cada um
-- na lista), fazendo o proximo "pular" pra frente e assumir o horario "agora"
-- que sobrou. Ver src/lib/postingSchedule.js e postingsRepository.js.
ALTER TABLE posting_schedule_settings
  ADD COLUMN paused BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE postings
  ADD COLUMN scheduled_for TIMESTAMPTZ;
