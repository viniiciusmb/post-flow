#!/usr/bin/env bash
# Leva da VPS antiga pra nova SO os arquivos que ainda vao ser usados.
# Roda NESTE Mac (passa por ele: as VPS nao tem acesso uma a outra).
#
# Decisao do Vinicius (29/09/2026): os cortes JA POSTADOS ficam na antiga.
# Eles nao servem pra mais nada - o banco da nova apaga o registro deles 3 dias
# depois da postagem (postingCleanupJob) e os arquivos somem quando o Post Flow
# for removido da antiga. Levar tudo seriam 17 GB pela internet de casa.
#
# O que vai (e so da conta de outros clientes - a 17 ja vive na nova):
#   - corte + capa de todo corte que ainda NAO foi postado (na fila, pronto sem
#     fila, com erro) - senao a postagem falha quando chegar a hora;
#   - o arquivo original de upload de video que ainda nao terminou (video do
#     YouTube e baixado de novo sozinho; upload nao tem de onde baixar).
#
# Idempotente: so manda o que falta na nova (ou tem tamanho diferente).
# Pode rodar antes da virada (adianta) e de novo na hora (so a diferenca).
set -euo pipefail

ANTIGA="${ANTIGA:-root@72.61.219.94}"
NOVA="${NOVA:-root@177.7.61.54}"
PASTA=/var/lib/postflow-clips
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 1. Lista "tamanho caminho" dos arquivos necessarios que existem na antiga.
ssh "$ANTIGA" 'bash -s' > "$TMP/antiga.txt" <<'REMOTO'
set -euo pipefail
D=$(docker ps -qf name=postflow_db | head -1)
docker exec -i "$D" psql -U postgres -d postflow -At <<'SQL' | sed '/^$/d' | sort -u > /tmp/virada-necessarios.txt
SELECT unnest(ARRAY[c.local_clip_path, c.thumbnail_path])
FROM clips c JOIN source_videos s ON s.id = c.source_video_id
WHERE s.owner_client_user_id <> 17
  AND NOT EXISTS (SELECT 1 FROM videos v JOIN postings p ON p.video_id = v.id
                  WHERE v.clip_id = c.id AND p.status = 'posted')
UNION
SELECT local_video_path FROM source_videos
WHERE owner_client_user_id <> 17 AND input_type = 'upload'
  AND status NOT IN ('ready', 'error', 'cancelled');
SQL
cd /var/lib/postflow-clips
sed -n 's#^/tmp/post-flow-video/##p' /tmp/virada-necessarios.txt | while IFS= read -r f; do
  [ -f "$f" ] && stat -c '%s %n' "$f"
done
rm -f /tmp/virada-necessarios.txt
REMOTO

# 2. O que a nova ja tem desses mesmos arquivos.
cut -d' ' -f2- "$TMP/antiga.txt" | ssh "$NOVA" "cd $PASTA && while IFS= read -r f; do [ -f \"\$f\" ] && stat -c '%s %n' \"\$f\"; done; true" > "$TMP/nova.txt"

# 3. Falta = esta na antiga e nao esta igual na nova.
sort "$TMP/antiga.txt" > "$TMP/a"; sort "$TMP/nova.txt" > "$TMP/n"
comm -23 "$TMP/a" "$TMP/n" > "$TMP/faltam.txt"
TOTAL=$(wc -l < "$TMP/antiga.txt" | tr -d ' ')
N=$(wc -l < "$TMP/faltam.txt" | tr -d ' ')
MB=$(awk '{s+=$1} END {printf "%.0f", s/1048576}' "$TMP/faltam.txt")
echo "Arquivos necessarios: $TOTAL. Faltando na nova: $N ($MB MB)."
[ "$N" = 0 ] && exit 0

# 4. Manda so os que faltam (tar pelo Mac, sem gravar nada no disco daqui).
cut -d' ' -f2- "$TMP/faltam.txt" > "$TMP/lista.txt"
scp -q "$TMP/lista.txt" "$ANTIGA:/tmp/virada-lista.txt"
ssh "$ANTIGA" "tar -C $PASTA -cf - -T /tmp/virada-lista.txt && rm -f /tmp/virada-lista.txt" \
  | ssh "$NOVA" "tar -C $PASTA -xf -"

# 5. Confere.
cut -d' ' -f2- "$TMP/faltam.txt" | ssh "$NOVA" "cd $PASTA && while IFS= read -r f; do [ -f \"\$f\" ] && stat -c '%s %n' \"\$f\"; done; true" | sort > "$TMP/depois.txt"
AINDA=$(comm -23 <(sort "$TMP/faltam.txt") "$TMP/depois.txt" | wc -l | tr -d ' ')
if [ "$AINDA" != 0 ]; then echo "ERRO: $AINDA arquivo(s) nao chegaram inteiros na nova." >&2; exit 1; fi
echo "Copiados $N arquivo(s), $MB MB, conferidos pelo tamanho."
