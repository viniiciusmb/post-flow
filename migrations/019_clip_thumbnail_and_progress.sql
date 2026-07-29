-- Capa (frame extraido do proprio corte, pra nao ficar tela em branco antes
-- de dar play) e progresso aproximado de renderizacao de cada corte.
ALTER TABLE clips
  ADD COLUMN thumbnail_path TEXT,
  ADD COLUMN render_progress_percent SMALLINT NOT NULL DEFAULT 0 CHECK (render_progress_percent BETWEEN 0 AND 100),
  ADD COLUMN description TEXT;
