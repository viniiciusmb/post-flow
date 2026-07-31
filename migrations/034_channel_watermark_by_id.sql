-- Troca a deteccao de "video novo" de comparar published_at pra comparar
-- ID/posicao na lista. published_at nunca funcionou de verdade: a listagem
-- rapida do canal (--flat-playlist no yt-dlp, usada por ser leve) nao traz
-- data de upload nenhuma (sempre null) - ou seja, a comparacao por data
-- OU nunca detectava nada de novo (canal com marco d'agua presente: filtro
-- sempre falso), OU, quando o marco d'agua estava vazio, tratava TUDO como
-- novo de uma vez (o canal "Renato Cariani" que inundou a fila). A pagina
-- /videos do YouTube sempre vem do mais novo pro mais velho, entao um
-- marco d'agua de ID funciona sem precisar de data nenhuma - ver
-- channelCheckJob.js.
ALTER TABLE youtube_channels
  DROP COLUMN last_video_published_at,
  ADD COLUMN last_video_id TEXT;
