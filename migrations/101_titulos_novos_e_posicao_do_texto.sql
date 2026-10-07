-- 12 modelos novos de titulo (06/10/2026): simples sem balao, sombra, brilho,
-- palavra em destaque e faixa larga (ver TITLE_STYLES em videoEditingService).
-- So ACRESCENTA opcoes: ninguem muda de estilo sem escolher. O estilo dos
-- cortes de LIVE mora em live_clip_settings.estilo (JSONB, sem CHECK).
ALTER TABLE client_video_settings
  DROP CONSTRAINT client_video_settings_title_style_check,
  ADD CONSTRAINT client_video_settings_title_style_check
    CHECK (title_style IN (
      'classic', 'bold', 'minimal', 'bubble_dark', 'bubble_purple',
      'neon_verde', 'vermelho_forte', 'amarelo_caixa', 'branco_caixa',
      'contorno_grosso', 'caixa_colorida', 'papel_rasgado', 'cartao',
      'simples', 'sombra_dura', 'amarelo_fino', 'preto_borda_branca', 'espacado',
      'brilho_rosa', 'brilho_azul', 'destaque_amarelo', 'destaque_verde',
      'faixa_preta', 'faixa_branca', 'faixa_colorida'
    ));

-- Custo da IA que decide ONDE vai o titulo e a legenda de cada corte de live
-- (liveTextoService), separado no livro pra medir quanto ela custa.
ALTER TABLE live_costs DROP CONSTRAINT live_costs_kind_check;
ALTER TABLE live_costs ADD CONSTRAINT live_costs_kind_check
  CHECK (kind IN ('transcricao', 'triagem', 'selecao', 'legenda', 'clipar_agora', 'juiz', 'ajuste_fino', 'camera', 'revisao', 'monitor_transcricao', 'posicao_texto'));
