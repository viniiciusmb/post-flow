-- Vídeo narrado a partir de um roteiro (modo de teste, só admin).
--
-- Segundo produto dentro do Post Flow: o admin cola um roteiro, o sistema gera
-- a narração, busca/gera as imagens que ilustram cada trecho, monta o
-- slideshow com legenda e devolve um vídeo pronto.
--
-- Viabilidade medida na VPS antes desta migration: TTS da OpenAI em PT-BR
-- funciona (372 caracteres viraram 31s de áudio), o acervo do Wikimedia entrega
-- gravuras originais em alta resolução para tema histórico, e o render sai a
-- 1,67x o tempo real com o desfoque feito pequeno e ampliado.

CREATE TABLE narrated_videos (
  id                BIGSERIAL PRIMARY KEY,
  -- Dono. Hoje sempre o admin (o recurso está em modo de teste), mas a coluna
  -- já é o caminho para abrir a clientes sem migration nova.
  admin_user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  script            TEXT NOT NULL,
  aspect            TEXT NOT NULL DEFAULT '16:9' CHECK (aspect IN ('16:9', '9:16')),

  -- O botão que o fundador pediu para poder comparar os dois modos gerando o
  -- MESMO roteiro duas vezes:
  --   economico = acervo primeiro, IA só quando a busca não acha nada;
  --   qualidade = a IA decide cena a cena se o acervo serve ou se vale desenhar.
  -- O custo entre um e outro dobra, e ninguém sabe de antemão se a diferença
  -- visual justifica - por isso é escolha por vídeo, não configuração global.
  image_policy      TEXT NOT NULL DEFAULT 'economico'
                    CHECK (image_policy IN ('economico', 'qualidade')),

  voice_provider    TEXT NOT NULL DEFAULT 'openai'
                    CHECK (voice_provider IN ('openai', 'elevenlabs')),
  voice_id          TEXT NOT NULL DEFAULT 'onyx',
  burn_captions     BOOLEAN NOT NULL DEFAULT true,
  -- NULL = sem música de fundo.
  music_mood        TEXT,

  status            TEXT NOT NULL DEFAULT 'na_fila' CHECK (status IN (
                      'na_fila', 'roteirizando', 'narrando', 'ilustrando',
                      'montando', 'pronto', 'erro', 'cancelado')),
  progress_percent  INTEGER NOT NULL DEFAULT 0,
  duration_seconds  NUMERIC(10,2),
  video_path        TEXT,
  audio_path        TEXT,

  error_message     TEXT,
  -- Classificado NO MOMENTO da falha, com o objeto de erro em mãos - nunca
  -- reconstituído lendo texto de volta do banco. É a terceira vez que esta
  -- lição aparece no projeto (ver src/lib/erroDeProcessamento.js, que nasceu
  -- justamente porque o retry automático lia uma coluna sempre NULL).
  error_transient   BOOLEAN,
  attempts          INTEGER NOT NULL DEFAULT 0,

  -- Mesma rede de segurança de source_videos: um deploy no meio da geração
  -- não pode deixar o vídeo preso para sempre num status "em andamento".
  processing_heartbeat_at TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_narrated_videos_dono ON narrated_videos (admin_user_id, created_at DESC);
CREATE INDEX idx_narrated_videos_status ON narrated_videos (status);

COMMENT ON COLUMN narrated_videos.image_policy IS
  'economico = acervo primeiro, IA so no vazio. qualidade = a IA decide cena a cena. Escolha por video, para comparar custo e resultado.';


-- Uma cena = um trecho do roteiro + o áudio dele + a imagem que o ilustra.
--
-- O áudio é gravado POR CENA, e não um arquivo só do roteiro inteiro. Essa é a
-- decisão que mais simplifica o pipeline: com um áudio único seria preciso
-- descobrir em que segundo cada cena começa alinhando o texto original com o
-- que o Whisper ouviu - e os dois SEMPRE divergem (número vira por extenso,
-- pontuação some). Por cena, a duração é simplesmente o tamanho do arquivo:
-- zero alinhamento, zero heurística. De quebra resolve o limite de 4096
-- caracteres por requisição do TTS, que um roteiro de 10 min estouraria.
CREATE TABLE narrated_video_scenes (
  id                BIGSERIAL PRIMARY KEY,
  narrated_video_id BIGINT NOT NULL REFERENCES narrated_videos(id) ON DELETE CASCADE,
  idx               INTEGER NOT NULL,
  text              TEXT NOT NULL,

  audio_path        TEXT,
  duration_seconds  NUMERIC(10,2),

  -- Termo de busca é gerado em INGLÊS mesmo com roteiro em português: medido
  -- contra a API real, 'Black Death plague 1348' devolve as gravuras originais
  -- e o equivalente em português devolve muito menos. A narração continua em
  -- português - só a busca muda de idioma.
  image_query       TEXT,
  image_prompt      TEXT,
  image_source      TEXT CHECK (image_source IS NULL OR image_source IN ('acervo', 'ia')),
  image_path        TEXT,
  image_url         TEXT,

  -- Licença GRAVADA no momento em que a imagem entra, nunca deduzida depois.
  -- É o que protege o vídeo publicado: só entram domínio público, CC0, CC BY,
  -- bancos livres e IA. CC BY-SA e NC ficam de fora (o share-alike é
  -- discutível para vídeo comercial). Mesmo princípio de auto_skipped_reason:
  -- reconstituir a decisão depois responderia errado assim que a regra mudasse.
  image_license     TEXT,
  image_credit      TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (narrated_video_id, idx)
);

CREATE INDEX idx_narrated_scenes_video ON narrated_video_scenes (narrated_video_id, idx);


-- O custo do vídeo narrado entra no MESMO livro contábil dos cortes, para a
-- operação ter uma contabilidade só - mas marcado com origem própria.
--
-- ATENÇÃO, e este é o ponto perigoso desta migration: resumo() e porDia() em
-- videoCostsRepository somam video_seconds SEM filtrar origem. Se o vídeo
-- narrado entrasse sem separação, ele inflaria o denominador e o "custo por
-- minuto" do pipeline de cortes passaria a mentir - exatamente o erro que já
-- foi corrigido uma vez em stageTimingsSince (que passou a excluir os
-- reaproveitados). As consultas são ajustadas junto com esta migration.
ALTER TABLE video_costs
  ADD COLUMN narrated_video_id BIGINT REFERENCES narrated_videos(id) ON DELETE SET NULL,
  -- Componentes que só existem neste produto. Ficam em colunas próprias porque
  -- somá-los em ia_usd esconderia justamente o que se quer comparar entre os
  -- dois modos de imagem.
  ADD COLUMN tts_usd    NUMERIC(12,6) NOT NULL DEFAULT 0,
  ADD COLUMN imagem_usd NUMERIC(12,6) NOT NULL DEFAULT 0;

ALTER TABLE video_costs DROP CONSTRAINT video_costs_origem_check;
ALTER TABLE video_costs ADD CONSTRAINT video_costs_origem_check
  CHECK (origem IN ('pipeline', 'historico', 'narrado'));

-- Um lançamento por vídeo narrado, acumulando etapa por etapa. Parcial pelo
-- mesmo motivo do índice de source_video_id: a coluna vira NULL quando o vídeo
-- é apagado, e vários lançamentos órfãos precisam conviver.
--
-- Todo ON CONFLICT que dependa deste índice tem que repetir o predicado
-- `WHERE narrated_video_id IS NOT NULL`, senão o Postgres não o reconhece.
CREATE UNIQUE INDEX ux_video_costs_narrated
  ON video_costs (narrated_video_id) WHERE narrated_video_id IS NOT NULL;

COMMENT ON COLUMN video_costs.tts_usd IS
  'Custo da narracao gerada (TTS). So existe em origem=narrado.';
COMMENT ON COLUMN video_costs.imagem_usd IS
  'Custo das imagens geradas por IA. So existe em origem=narrado; imagem de acervo custa zero.';
