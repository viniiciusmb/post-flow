-- Preferencias de edicao de video por cliente. Sem linha = usa os valores
-- padrao (9:16, qualidade alta, etc.) direto no codigo - so cria a linha
-- quando o cliente muda algo.
CREATE TABLE client_video_settings (
  client_user_id  BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  aspect_ratio    TEXT NOT NULL DEFAULT '9:16' CHECK (aspect_ratio IN ('9:16', '1:1', '16:9', '4:5')),
  framing         TEXT NOT NULL DEFAULT 'crop' CHECK (framing IN ('crop', 'blur_pad')),
  quality         TEXT NOT NULL DEFAULT 'high' CHECK (quality IN ('high', 'medium')),
  caption_style   TEXT NOT NULL DEFAULT 'classic' CHECK (caption_style IN ('classic', 'bold', 'minimal', 'none')),
  clip_length     TEXT NOT NULL DEFAULT 'balanced' CHECK (clip_length IN ('short', 'balanced', 'long')),
  max_clips       SMALLINT NOT NULL DEFAULT 4 CHECK (max_clips BETWEEN 1 AND 8),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
