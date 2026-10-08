-- Quando a live atual comecou NA PLATAFORMA (08/10/2026).
--
-- A Twitch (started_at) e a Kick (start_time) informam, e o sistema jogava
-- fora. Sem isso a tela so sabe ha quanto tempo NOS estamos gravando, e o
-- cliente pensa no relogio da live ("aconteceu aos 2h10"): o aviso do "Clipar
-- este momento" mostra a janela que vai virar corte nesse relogio.
-- Apagado quando o canal sai do ar.
ALTER TABLE live_channels ADD COLUMN live_started_at TIMESTAMPTZ;
