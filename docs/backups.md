# Backup do banco de dados

O banco Postgres guarda TUDO que não dá pra recriar: contas de cliente, tokens do TikTok e do
Google (criptografados), histórico de vídeos e cortes, saldo de créditos, configurações. Os
arquivos de vídeo em disco são descartáveis (dá pra baixar de novo); o banco não é.

## O que está rodando hoje

Um cron **no host da VPS** (não dentro de container) roda todo dia às **03:15**:

```
15 3 * * * /usr/local/bin/postflow-backup >> /var/log/postflow-backup.log 2>&1
```

O script é o [`scripts/backup-db.sh`](../scripts/backup-db.sh) deste repositório, copiado pra
`/usr/local/bin/postflow-backup`. Ele:

1. Faz `pg_dump -Fc` (formato comprimido/restaurável) por dentro do container `postflow_db`.
2. **Verifica** o arquivo gerado com `pg_restore --list` e confere que tem pelo menos 5 tabelas
   com dados — um arquivo que existe mas não abre não é backup.
3. Guarda em `/var/backups/postflow/daily/`, com cópia em `weekly/` aos domingos e em `monthly/`
   todo dia 1º.
4. Rotaciona: mantém **14 diários, 8 semanais, 12 mensais**.
5. Grava o resultado na tabela `settings` (chave `last_db_backup`), que o painel do admin
   (Métricas → Saúde do servidor) lê pra mostrar "Backup do banco: OK / atrasado / falhou".

O dump inteiro tem ~1,4 MB hoje, então as 34 cópias juntas ocupam menos de 50 MB.

## Como conferir que está funcionando

**Pelo painel**: `/admin/metrics` → card "Saúde do servidor (VPS)" → métrica "Backup do banco".
Se aparecer qualquer coisa diferente de "OK", tem problema (o script não roda há mais de 36h,
ou a última execução falhou).

**Pelo terminal**:

```bash
ssh root@72.61.219.94
tail -20 /var/log/postflow-backup.log
ls -lht /var/backups/postflow/daily/ | head
```

## Como restaurar

Use [`scripts/restore-db.sh`](../scripts/restore-db.sh), instalado como `/usr/local/bin/postflow-restore`.

**Teste (seguro, não toca em produção)** — restaura o backup mais recente num banco separado
chamado `postflow_restore_test` e mostra a contagem de linhas lado a lado com a produção:

```bash
ssh root@72.61.219.94 "/usr/local/bin/postflow-restore"
```

Vale rodar isso de vez em quando (uma vez por mês, por exemplo). Um backup que nunca foi
restaurado não é um backup confirmado. Depois, apague o banco de teste com o comando que o
próprio script imprime no final.

**Restaurar de verdade por cima da produção** (só em emergência):

```bash
ssh root@72.61.219.94
/usr/local/bin/postflow-restore /var/backups/postflow/daily/postflow_XXXX.dump --into-production
```

Ele exige digitar `SIM` e tira um dump de segurança do estado atual antes de sobrescrever, pra
que dê pra voltar atrás se o backup escolhido estiver errado. Depois do restore, reinicie os
serviços:

```bash
docker service update --force postflow_web
docker service update --force postflow_worker
docker service update --force postflow_video-worker
```

## Cópia fora da VPS — LIGADA (Backblaze B2)

As cópias locais em `/var/backups/postflow` protegem contra migration ruim, `DELETE` sem `WHERE`,
exclusão por engano e upgrade de Postgres que deu errado. **Não protegem** contra o disco da VPS
falhar ou o servidor ser perdido — por isso, desde 02/08/2026, cada backup também sobe pro
Backblaze B2.

| | |
|---|---|
| Bucket | `postflow` (privado) |
| Região | `us-east-005` |
| Chave | `postflow-backup`, **limitada a esse bucket** (não é a Master Key) |
| Credenciais | `/etc/postflow-backup.env` na VPS, `chmod 600`, fora do git |

### Por que a API nativa do B2 e não o `aws s3`

A VPS é Ubuntu 24.04 e **o pacote `awscli` não existe mais nos repositórios dela**. As
alternativas seriam instalar o AWS CLI v2 na mão (~50 MB) ou o rclone — nada disso se justifica
pra mandar um arquivo de 1,4 MB por dia. O script usa `curl` + `jq` (que já estavam instalados)
em três chamadas HTTP: autentica, pede a URL de upload, envia.

Bônus: o B2 **exige o SHA1 do conteúdo** e confere do lado dele. Se o arquivo chegar corrompido,
o próprio Backblaze recusa o upload — é uma segunda verificação de integridade, além do
`pg_restore --list` que o script já faz.

### Como conferir que os arquivos estão chegando

```bash
ssh root@72.61.219.94
. /etc/postflow-backup.env
AUTH=$(curl -s -u "$B2_KEY_ID:$B2_APP_KEY" https://api.backblazeb2.com/b2api/v3/b2_authorize_account)
TOKEN=$(echo "$AUTH" | jq -r .authorizationToken)
API=$(echo "$AUTH" | jq -r .apiInfo.storageApi.apiUrl)
BID=$(echo "$AUTH" | jq -r .apiInfo.storageApi.bucketId)
curl -s -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"bucketId\":\"$BID\"}" "$API/b2api/v3/b2_list_file_names" \
  | jq -r '.files[] | "\(.fileName)  \(.contentLength) bytes"'
```

### Restaurar a partir da cópia da nuvem

Testado de verdade em 02/08/2026: o arquivo foi **baixado do B2** e restaurado num banco de
teste, e as 5 tabelas conferidas bateram exatamente com produção.

```bash
# (com TOKEN e DOWN obtidos como acima)
DOWN=$(echo "$AUTH" | jq -r .apiInfo.storageApi.downloadUrl)
curl -s -H "Authorization: $TOKEN" \
  "$DOWN/file/postflow/postflow_AAAA-MM-DD_HHMM.dump" -o /tmp/da-nuvem.dump

# daí em diante é o fluxo normal de restore:
/usr/local/bin/postflow-restore /tmp/da-nuvem.dump              # teste
/usr/local/bin/postflow-restore /tmp/da-nuvem.dump --into-production
```

### Se o envio externo falhar

O backup **local continua sendo feito normalmente** e o script registra `offsite-falhou` — de
propósito: um problema de rede com o Backblaze nunca pode fazer parecer que não houve backup
nenhum. O status (`local-apenas`, `offsite-ok`, `offsite-falhou`) aparece no painel do admin
junto com a data do último backup.

### Reinstalar as credenciais do zero

```bash
cat > /etc/postflow-backup.env <<'FIM'
B2_KEY_ID=<keyID da chave limitada ao bucket>
B2_APP_KEY=<applicationKey - so aparece uma vez, na criacao>
B2_BUCKET=postflow
FIM
chmod 600 /etc/postflow-backup.env
```

> **Nunca use a Master Application Key aqui.** Ela dá controle total da conta Backblaze,
> inclusive apagar buckets. Se a VPS for invadida, quem entrar poderia apagar os backups
> externos junto — o que anula o motivo de eles existirem. A chave tem que ser criada com
> "Allow access to Bucket(s): postflow".

Se o envio externo falhar, o backup local continua sendo feito normalmente e o script registra
um aviso — de propósito: um problema de rede com o Backblaze nunca pode fazer parecer que não
houve backup nenhum. O status (`local-apenas`, `offsite-ok`, `offsite-falhou`) aparece no painel
do admin junto com a data do último backup.

## Se um dia precisar reinstalar do zero

```bash
scp scripts/backup-db.sh root@72.61.219.94:/usr/local/bin/postflow-backup
scp scripts/restore-db.sh root@72.61.219.94:/usr/local/bin/postflow-restore
ssh root@72.61.219.94 "chmod +x /usr/local/bin/postflow-backup /usr/local/bin/postflow-restore"
ssh root@72.61.219.94 "(crontab -l 2>/dev/null | grep -v postflow-backup; \
  echo '15 3 * * * /usr/local/bin/postflow-backup >> /var/log/postflow-backup.log 2>&1') | crontab -"
```
