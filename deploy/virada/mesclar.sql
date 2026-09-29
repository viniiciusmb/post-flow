-- Funde o banco da VPS nova no banco final da virada.
--
-- Contexto (ver docs/CHECKLIST_MIGRACAO_E_LIVES.md): desde 28/09/2026 a conta
-- risestyle43 (id 17) roda de verdade na VPS NOVA, e todo o resto na ANTIGA.
-- Na virada, o banco final nasce do dump da ANTIGA (verdade de todo mundo) e
-- recebe da NOVA:
--   1. tudo da conta 17 (a versao da antiga esta pausada e velha);
--   2. as tabelas live_* inteiras (modulo de lives, so existe na nova);
--   3. chaves de settings que so a nova tem, e as do modulo de lives;
--   4. sessoes de login e cache compartilhado de download que faltarem.
--
-- Pre-requisitos (o virada.sh garante): banco final = dump da antiga + todas as
-- migrations aplicadas; banco da nova renomeado para :'banco_nova' no MESMO
-- Postgres. Roda com: psql --single-transaction -v ON_ERROR_STOP=1
--
-- Os ids da conta 17 sao copiados como estao. Isso e seguro porque:
--   - as linhas anteriores a 28/09 ~21:30 tem o MESMO id nos dois bancos (a
--     nova nasceu de um dump da antiga);
--   - nenhuma linha foi criada na nova entre essa hora e 29/09 ~16h (conferido);
--   - a partir de 29/09 ~16h as sequencias da nova foram puladas +100000, entao
--     o que nascer la ate a virada nao colide com nada da antiga.
-- Mesmo assim, qualquer colisao derruba a transacao inteira (chave primaria) -
-- nunca sobrescreve linha de outro cliente.

\set ON_ERROR_STOP 1

CREATE EXTENSION IF NOT EXISTS postgres_fdw;
CREATE SERVER virada_nova FOREIGN DATA WRAPPER postgres_fdw OPTIONS (dbname :'banco_nova');
CREATE USER MAPPING FOR postgres SERVER virada_nova OPTIONS (user 'postgres');
CREATE SCHEMA nova;
IMPORT FOREIGN SCHEMA public FROM SERVER virada_nova INTO nova;

-- ---------------------------------------------------------------------------
-- Regras: cada tabela da conta 17 e o filtro que diz "isto e da conta 17".
-- %1$s = esquema (public = banco final, nova = banco da VPS nova).
-- Ordem = pais antes de filhos (insercao); a remocao usa a ordem inversa.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE regras (ordem int, tabela text, filtro text);
INSERT INTO regras VALUES
 (1,  'tiktok_accounts',            'client_user_id = 17'),
 (2,  'youtube_channels',           'client_user_id = 17'),
 (3,  'posting_schedule_settings',  'tiktok_account_id IN (SELECT id FROM %1$s.tiktok_accounts WHERE client_user_id = 17)'),
 (4,  'drive_connections',          'owner_user_id = 17'),
 -- Pasta de exportacao e por CANAL e nasce sem client_user_id (o dono vem do
 -- canal/da conexao) - o ensaio de 29/09 pegou isso: sem estas condicoes, a
 -- pasta do canal 20 sumia na fusao.
 (5,  'drive_folders',              'client_user_id = 17 OR youtube_channel_id IN (SELECT id FROM %1$s.youtube_channels WHERE client_user_id = 17) OR connection_id IN (SELECT id FROM %1$s.drive_connections WHERE owner_user_id = 17)'),
 (6,  'drive_folder_tiktok_targets','drive_folder_id IN (SELECT id FROM %1$s.drive_folders WHERE client_user_id = 17 OR youtube_channel_id IN (SELECT id FROM %1$s.youtube_channels WHERE client_user_id = 17) OR connection_id IN (SELECT id FROM %1$s.drive_connections WHERE owner_user_id = 17))'),
 (7,  'client_subscriptions',       'client_user_id = 17'),
 (8,  'client_credits',             'client_user_id = 17'),
 (9,  'download_tunnels',           'client_user_id = 17'),
 (10, 'source_videos',              'owner_client_user_id = 17 OR client_user_id = 17 OR youtube_channel_id IN (SELECT id FROM %1$s.youtube_channels WHERE client_user_id = 17)'),
 (11, 'source_video_tiktok_targets','source_video_id IN (SELECT id FROM %1$s.source_videos WHERE owner_client_user_id = 17 OR client_user_id = 17)'),
 (12, 'clips',                      'source_video_id IN (SELECT id FROM %1$s.source_videos WHERE owner_client_user_id = 17 OR client_user_id = 17)'),
 (13, 'videos',                     'clip_id IN (SELECT c.id FROM %1$s.clips c JOIN %1$s.source_videos s ON s.id = c.source_video_id WHERE s.owner_client_user_id = 17 OR s.client_user_id = 17) OR drive_folder_id IN (SELECT id FROM %1$s.drive_folders WHERE client_user_id = 17 OR youtube_channel_id IN (SELECT id FROM %1$s.youtube_channels WHERE client_user_id = 17))'),
 (14, 'postings',                   'tiktok_account_id IN (SELECT id FROM %1$s.tiktok_accounts WHERE client_user_id = 17)'),
 (15, 'client_video_settings',      'client_user_id = 17'),
 (16, 'credit_purchases',           'client_user_id = 17'),
 (17, 'asaas_pix_authorizations',   'client_user_id = 17'),
 (18, 'asaas_checkouts',            'client_user_id = 17'),
 (19, 'asaas_payments',             'client_user_id = 17'),
 (20, 'credit_transactions',        'client_user_id = 17'),
 (21, 'client_overage_charges',     'client_user_id = 17'),
 (22, 'revenue_entries',            'client_user_id = 17'),
 (23, 'video_costs',                'client_user_id = 17 OR source_video_id IN (SELECT id FROM %1$s.source_videos WHERE owner_client_user_id = 17)'),
 (24, 'system_errors',              'client_user_id = 17');

-- Tabelas do modulo de lives, copiadas inteiras (pais antes de filhos).
CREATE TEMP TABLE lives (ordem int, tabela text);
INSERT INTO lives VALUES
 (1,'live_channels'), (2,'live_channel_follows'), (3,'live_clip_settings'),
 (4,'live_sessions'), (5,'live_segments'), (6,'live_transcripts'),
 (7,'live_candidates'), (8,'live_chat_buckets'), (9,'live_viewer_clips'),
 (10,'live_clips'), (11,'live_costs');

CREATE TEMP TABLE contagem (tabela text PRIMARY KEY, final_antes bigint, rise_final bigint, rise_nova bigint, total_nova bigint);

CREATE FUNCTION pg_temp.contar(sql text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE n bigint; BEGIN EXECUTE sql INTO n; RETURN n; END $$;

CREATE FUNCTION pg_temp.colunas(t text) RETURNS text LANGUAGE sql AS $$
  SELECT string_agg(quote_ident(column_name), ', ' ORDER BY ordinal_position)
  FROM information_schema.columns WHERE table_schema = 'public' AND table_name = t $$;

DO $$
DECLARE r record; faltando text;
BEGIN
  -- Toda tabela live_* da nova tem que estar na lista (uma tabela nova do
  -- modulo esquecida aqui seria perdida em silencio na virada).
  SELECT string_agg(c.relname, ', ') INTO faltando
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'nova' AND c.relname LIKE 'live\_%' AND c.relname NOT IN (SELECT tabela FROM lives);
  IF faltando IS NOT NULL THEN RAISE EXCEPTION 'tabela de lives fora da lista: %', faltando; END IF;

  -- Toda tabela com client_user_id/owner_user_id que NAO esta nas regras e
  -- conscientemente deixada com a versao da antiga (afiliados, cliques,
  -- indicacoes: quem recebe visita publica e a antiga). Lista explicita, pra
  -- uma tabela nova do produto nao passar batida.
  SELECT string_agg(DISTINCT table_name, ', ') INTO faltando
  FROM information_schema.columns
  WHERE table_schema = 'public' AND column_name IN ('client_user_id','owner_user_id','user_id','affiliate_user_id')
    AND table_name NOT IN (SELECT tabela FROM regras) AND table_name NOT LIKE 'live\_%'
    AND table_name NOT IN ('affiliates','affiliate_links','affiliate_withdrawals','commission_entries',
                           'password_reset_tokens','narrated_videos','referrals');
  IF faltando IS NOT NULL THEN RAISE EXCEPTION 'tabela com dono sem regra de virada: %', faltando; END IF;

  FOR r IN SELECT * FROM regras ORDER BY ordem LOOP
    INSERT INTO contagem VALUES (r.tabela,
      pg_temp.contar(format('SELECT count(*) FROM public.%I', r.tabela)),
      pg_temp.contar(format('SELECT count(*) FROM public.%I WHERE ', r.tabela) || format(r.filtro, 'public')),
      pg_temp.contar(format('SELECT count(*) FROM nova.%I WHERE ', r.tabela) || format(r.filtro, 'nova')),
      NULL);
  END LOOP;
  FOR r IN SELECT * FROM lives ORDER BY ordem LOOP
    INSERT INTO contagem VALUES (r.tabela,
      pg_temp.contar(format('SELECT count(*) FROM public.%I', r.tabela)), 0, 0,
      pg_temp.contar(format('SELECT count(*) FROM nova.%I', r.tabela)));
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 1. Conta 17: tira a versao velha (da antiga) e poe a viva (da nova).
-- ---------------------------------------------------------------------------
-- Pastas do Drive da conta 17 na antiga, guardadas antes de apagar: a copia
-- que montou a nova em 28/09 filtrou por client_user_id e perdeu a pasta de
-- exportacao do canal 20 (que nasce sem dono direto). Ela volta no passo 5b.
CREATE TEMP TABLE pastas_antigas_17 AS
SELECT * FROM public.drive_folders
WHERE client_user_id = 17
   OR youtube_channel_id IN (SELECT id FROM public.youtube_channels WHERE client_user_id = 17)
   OR connection_id IN (SELECT id FROM public.drive_connections WHERE owner_user_id = 17);

DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM regras ORDER BY ordem DESC LOOP
    EXECUTE format('DELETE FROM public.%I WHERE ', r.tabela) || format(r.filtro, 'public');
  END LOOP;
  FOR r IN SELECT * FROM regras ORDER BY ordem LOOP
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM nova.%I WHERE ',
                   r.tabela, pg_temp.colunas(r.tabela), pg_temp.colunas(r.tabela), r.tabela)
            || format(r.filtro, 'nova');
  END LOOP;
END $$;

-- A linha do proprio usuario 17 (senha, nome, ultimo acesso): vale a da nova.
DO $$
DECLARE cols text;
BEGIN
  SELECT string_agg(format('%1$I = n.%1$I', column_name), ', ') INTO cols
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'users' AND column_name <> 'id';
  EXECUTE 'UPDATE public.users u SET ' || cols || ' FROM nova.users n WHERE n.id = 17 AND u.id = 17';
END $$;

-- ---------------------------------------------------------------------------
-- 2. Modulo de lives: tabelas inteiras (o banco final acabou de criar vazias).
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT * FROM lives ORDER BY ordem LOOP
    EXECUTE format('INSERT INTO public.%I (%s) SELECT %s FROM nova.%I',
                   r.tabela, pg_temp.colunas(r.tabela), pg_temp.colunas(r.tabela), r.tabela);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3. settings: o que so a nova tem, e o que e do modulo de lives.
-- ---------------------------------------------------------------------------
INSERT INTO public.settings (key, value, updated_at)
SELECT key, value, updated_at FROM nova.settings n
WHERE n.key LIKE 'live%' OR NOT EXISTS (SELECT 1 FROM public.settings p WHERE p.key = n.key)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at;
-- A marca de "VPS nova so com a conta 17" deixa de ser verdade.
DELETE FROM public.settings WHERE key = 'vps_nova_contas';

-- ---------------------------------------------------------------------------
-- 4. Sessoes (ninguem precisa logar de novo) e cache compartilhado de download.
-- ---------------------------------------------------------------------------
INSERT INTO public.session (sid, sess, expire)
SELECT sid, sess, expire FROM nova.session ON CONFLICT DO NOTHING;

-- Download/transcricao que a nova fez e a antiga nao tem (mesmo video e mesmo
-- idioma ja existentes ficam com a versao da antiga, que e de todo mundo).
DO $$
BEGIN
  EXECUTE format(
    'INSERT INTO public.shared_video_assets (%1$s) SELECT %1$s FROM nova.shared_video_assets n
     WHERE NOT EXISTS (SELECT 1 FROM public.shared_video_assets p
                       WHERE p.youtube_video_id = n.youtube_video_id AND p.audio_language = n.audio_language)
       AND NOT EXISTS (SELECT 1 FROM public.shared_video_assets p WHERE p.id = n.id)',
    pg_temp.colunas('shared_video_assets'));
END $$;

-- ---------------------------------------------------------------------------
-- 5. Conferencia. Qualquer diferenca desfaz TUDO (transacao unica).
--    Conta 17: igual a nova.  Resto: igual ao que a antiga tinha.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record; c record; agora_total bigint; agora_rise bigint; erros text := '';
BEGIN
  FOR r IN SELECT * FROM regras ORDER BY ordem LOOP
    SELECT * INTO c FROM contagem WHERE tabela = r.tabela;
    agora_total := pg_temp.contar(format('SELECT count(*) FROM public.%I', r.tabela));
    agora_rise  := pg_temp.contar(format('SELECT count(*) FROM public.%I WHERE ', r.tabela) || format(r.filtro, 'public'));
    IF agora_rise <> c.rise_nova THEN
      erros := erros || format(E'\n  %s: conta 17 tem %s, a nova tinha %s', r.tabela, agora_rise, c.rise_nova);
    END IF;
    IF agora_total - agora_rise <> c.final_antes - c.rise_final THEN
      erros := erros || format(E'\n  %s: outros clientes %s, a antiga tinha %s', r.tabela, agora_total - agora_rise, c.final_antes - c.rise_final);
    END IF;
    RAISE NOTICE '% conta17: antiga=% nova=% | outros=%', rpad(r.tabela, 28), c.rise_final, c.rise_nova, agora_total - agora_rise;
  END LOOP;
  FOR r IN SELECT * FROM lives ORDER BY ordem LOOP
    SELECT * INTO c FROM contagem WHERE tabela = r.tabela;
    agora_total := pg_temp.contar(format('SELECT count(*) FROM public.%I', r.tabela));
    IF agora_total <> c.total_nova + c.final_antes THEN
      erros := erros || format(E'\n  %s: %s linhas, a nova tinha %s', r.tabela, agora_total, c.total_nova);
    END IF;
    RAISE NOTICE '% lives: %', rpad(r.tabela, 28), agora_total;
  END LOOP;
  IF erros <> '' THEN RAISE EXCEPTION 'conferencia da fusao falhou:%', erros; END IF;
END $$;

-- 5b. Devolve as pastas do Drive da conta 17 que so a antiga tinha (ver acima),
-- desde que o canal e a conexao delas existam no banco final.
INSERT INTO public.drive_folders
SELECT p.* FROM pastas_antigas_17 p
WHERE NOT EXISTS (SELECT 1 FROM public.drive_folders d WHERE d.id = p.id)
  AND (p.youtube_channel_id IS NULL OR EXISTS (SELECT 1 FROM public.youtube_channels c WHERE c.id = p.youtube_channel_id))
  AND (p.connection_id IS NULL OR EXISTS (SELECT 1 FROM public.drive_connections c WHERE c.id = p.connection_id));

-- ---------------------------------------------------------------------------
-- 6. Contadores de id: cada um continua depois do maior id que existe agora.
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record; maior bigint;
BEGIN
  FOR r IN
    SELECT s.relname AS seq, t.relname AS tab, a.attname AS col
    FROM pg_class s
    JOIN pg_depend d ON d.objid = s.oid AND d.deptype = 'a'
    JOIN pg_class t ON t.oid = d.refobjid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
    JOIN pg_namespace n ON n.oid = s.relnamespace
    WHERE s.relkind = 'S' AND n.nspname = 'public'
  LOOP
    EXECUTE format('SELECT max(%I) FROM public.%I', r.col, r.tab) INTO maior;
    IF maior IS NULL THEN
      PERFORM setval(format('public.%I', r.seq), 1, false);
    ELSE
      PERFORM setval(format('public.%I', r.seq), greatest(maior, (SELECT last_value FROM pg_sequences WHERE schemaname = 'public' AND sequencename = r.seq)));
    END IF;
  END LOOP;
END $$;

-- Limpeza: o banco final nao fica apontando pro da nova.
SET LOCAL client_min_messages = warning;
DROP SCHEMA nova CASCADE;
DROP USER MAPPING FOR postgres SERVER virada_nova;
DROP SERVER virada_nova;
DROP EXTENSION postgres_fdw;
