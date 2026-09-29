# Próximos passos depois da troca de VPS

A produção do Post Flow roda na **VPS nova (`177.7.61.54`)** desde **29/09/2026 às 18:16**
(Brasília). A VPS antiga (`72.61.219.94`) ficou só como **ponte**: repassa pra nova quem
ainda chega pelo endereço antigo, e o banco dela está parado mas intacto (é o caminho de
volta). Histórico completo em `docs/CHECKLIST_MIGRACAO_E_LIVES.md`, Fase 3.

Marque cada item com `[x]` quando fizer, e anote a data.

---

## 1. Antes de qualquer publicação nova — IMPORTANTE (Claude)

- [ ] **Juntar a branch `feature/lives` na `main` e enviar pro GitHub.**
  O que roda hoje na produção é a `feature/lives` (39 commits à frente da `main`,
  incluindo o módulo de lives e toda a configuração da VPS nova). Nada disso está na
  `main` nem no GitHub.
  **Perigo:** `deploy/deploy.sh` sem `--local` publica a `origin/main`. Rodar ele antes
  dessa junção colocaria no ar o código ANTIGO, sem o módulo de lives, sem a entrada da
  ponte (porta 8443) e sem a configuração nova do Caddy.

## 2. Nos próximos 1–2 dias

- [ ] **(Vinicius) Reiniciar o programa do túnel no seu PC** (fechar e abrir de novo).
  Hoje ele ainda se liga no IP antigo e chega na nova pelo redirecionamento da ponte.
  Reiniciado, ele pega o endereço novo e se liga direto na `177.7.61.54`.
- [ ] **(Claude) Conferir que ninguém mais depende da ponte:**
  - quase nenhuma visita chegando pela antiga: `ssh root@72.61.219.94 "docker service logs --since 6h postflow_web 2>&1 | wc -l"`;
  - o túnel do fundador conectado direto na nova (nos logs do relé da nova, a origem
    da conexão não é mais `72.61.219.94`): `ssh root@177.7.61.54 "docker logs --since 1h postflow_ssh-relay 2>&1 | grep Accepted"`.
- [ ] **(Claude) Desmontar a ponte** quando os dois itens acima estiverem ok:
  - túnel: `ssh root@72.61.219.94 "/root/postflow-ponte/tunel.sh desligar 2222"`;
  - site: `ssh root@72.61.219.94 "docker service scale postflow_web=0"`.
  - **Efeito esperado:** o `postflowtiktok.com` para de abrir. Foi decisão do Vinicius
    (29/09): o domínio fica esquecido, e o sistema não usa mais ele. E-mail e site
    oficial são `postflowclips.com`, e os registros de e-mail (MX) não são afetados.
  - Com a ponte desmontada, `deploy/virada/virada.sh voltar` deixa de ser um caminho
    simples de volta.

## 3. Depois de 7 dias (a partir de 06/10/2026), com a confirmação do Vinicius

- [ ] **Remover o Post Flow da VPS antiga**, e só ele. Não mexer em Evolution, n8n,
  Interactive Lives, minerador nem tiktok-platform:
  - projeto `postflow` no EasyPanel (serviços `db`, `web`, `worker`, `video-worker`,
    `potprovider`, `ssh-relay`);
  - `/var/lib/postflow-clips`: ~15 GB de cortes já postados, que ficaram lá por
    decisão do Vinicius;
  - `/root/postflow-ponte` e o cron de backup (já desligado na virada).
  - O último banco da antiga está guardado na nova em
    `/var/backups/postflow/virada/antiga-20260929_2111.dump`, e também nos backups do B2
    anteriores à troca.
- [ ] **Limpar na VPS nova o que foi guardado só pra desfazer a troca:**
  - banco `postflow_nova_20260929_2111`: a versão da nova de antes da troca (conta
    risestyle43 + lives);
  - `/var/backups/postflow/virada/`, depois de conferir que o backup diário da nova está
    indo pro B2 (painel do admin → "Backup do banco").
- [ ] Apagar `/var/lib/postflow-relay/hostkeys.proprias` na nova (a identidade antiga do
  relé, trocada pela da VPS antiga na preparação).

## 4. Pendências que continuam valendo

- [ ] **Alerta ativo** de disco, memória ou processo caído na VPS nova. Hoje só existe o
  painel do admin; ninguém é avisado sozinho.
- [ ] Quem se conectava direto no relé antigo (clientes com o programa de túnel) chega
  pela ponte até ela ser desmontada. Depois disso, precisa reiniciar o programa.
  Hoje só o túnel do fundador está conectado.
- [ ] Módulo de lives: continuam as pendências da Fase 4 do checklist (novo teste ao
  vivo, postar corte de live no TikTok etc.).

## Referência rápida

| O quê | Onde |
|---|---|
| Entrar na VPS nova | `ssh root@177.7.61.54` (pasta `/opt/postflow`) |
| Publicar código | `deploy/deploy.sh` (roda as migrations sozinho) — **só depois do item 1** |
| Logs | `docker logs --since 5m postflow_web` (ou `postflow_worker`, `postflow_video-worker`, `postflow_live-worker`) |
| Backup manual | `/usr/local/bin/postflow-backup` (diário às 03:15 UTC, com cópia no B2) |
| Desfazer a troca (só enquanto a ponte existir) | `deploy/virada/virada.sh voltar`, que perde o que foi gravado na nova depois de 29/09 18:16 |
