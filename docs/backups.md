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

## Cópia fora da VPS (pendente de ligar)

As cópias em `/var/backups/postflow` protegem contra:

- migration ruim / `DELETE` sem `WHERE` / bug que corrompeu dados,
- cliente ou admin apagando algo por engano,
- upgrade de versão do Postgres que deu errado.

**Não protegem** contra o disco da VPS falhar ou a VPS inteira ser perdida — estão no mesmo
disco. O script **já está preparado** para enviar uma cópia pra fora; falta só a conta e as
credenciais. Como o dump tem ~1,4 MB, qualquer plano gratuito cobre com folga.

### Como ligar (Backblaze B2 — escolhido pelo fundador)

Bucket já criado em 02/08/2026:

| | |
|---|---|
| Nome | `postflow` |
| Tipo | Private |
| Endpoint | `s3.us-east-005.backblazeb2.com` |
| ID do bucket | `5fc9a2ad4208c73e90f20b12` |

Falta a chave de acesso. No painel do Backblaze, **Application Keys → Add a New Application
Key**, com acesso limitado ao bucket `postflow` (não "All") e tipo **Read and Write**. O
`applicationKey` aparece **uma única vez** — se fechar a página, tem que gerar outra.

Depois, na VPS:

```bash
ssh root@72.61.219.94
apt-get update && apt-get install -y awscli

cat > /etc/postflow-backup.env <<'FIM'
OFFSITE_BUCKET=s3://postflow/postflow
AWS_ACCESS_KEY_ID=SEU_KEY_ID
AWS_SECRET_ACCESS_KEY=SUA_APPLICATION_KEY
AWS_ENDPOINT_URL=https://s3.us-east-005.backblazeb2.com
FIM
chmod 600 /etc/postflow-backup.env

/usr/local/bin/postflow-backup    # deve terminar com "(offsite-ok)"
```

> O arquivo `/etc/postflow-backup.env` fica **fora do repositório** de propósito (a chave é uma
> senha). Nunca commite esses valores.

Pra conferir depois que os arquivos estão chegando mesmo:

```bash
. /etc/postflow-backup.env
aws --endpoint-url "$AWS_ENDPOINT_URL" s3 ls s3://postflow/postflow/
```

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
