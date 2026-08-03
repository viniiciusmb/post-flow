-- "Só baixar quando o meu computador estiver ligado".
--
-- O túnel só funciona enquanto o computador do cliente está ligado, conectado à
-- internet e com o programa aberto. Quando ele está desligado ou dormindo, o
-- download sai pela nossa banda — e o cliente descobre isso só na fatura, como
-- excedente da tarifa mais cara.
--
-- Agora ele escolhe: esperar o próprio computador, ou deixar sair pela nossa.

ALTER TABLE download_tunnels
  -- false (padrão) = se o computador estiver desligado, baixa pela nossa banda
  --                  mesmo assim, pra não segurar a fila.
  -- true            = só baixa quando o túnel dele estiver conectado.
  --
  -- O padrão é false de propósito: é o comportamento que já existia hoje, e
  -- mudar o padrão faria a fila de quem já usa o sistema parar sem aviso.
  ADD COLUMN IF NOT EXISTS require_client_tunnel BOOLEAN NOT NULL DEFAULT false;

-- Status novo: vídeo parado esperando o computador do cliente voltar. Não é
-- erro nem pausa - é uma escolha dele, e o vídeo volta pra fila sozinho assim
-- que o túnel reconectar (ver tunnelTestJob).
ALTER TABLE source_videos
  DROP CONSTRAINT source_videos_status_check,
  ADD CONSTRAINT source_videos_status_check CHECK (status IN (
    'detected', 'downloading', 'transcribing',
    'selecting_clips', 'cutting', 'ready', 'error', 'cancelled', 'paused',
    'aguardando_creditos', 'aguardando_conexao'
  ));
