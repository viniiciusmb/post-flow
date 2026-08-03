# Aprovação do app no Google e no TikTok

Pesquisado em 02/08/2026 na documentação oficial das duas plataformas. **As regras mudam com
frequência**: antes de submeter, confira de novo nos links do fim desta página.

---

## Resumo: onde o Post Flow está hoje

> **Atualizado em 03/08/2026.** O roteiro de gravação dos vídeos ficou numa página própria:
> [`docs/roteiro-video-aprovacao.md`](roteiro-video-aprovacao.md).

| Item | Situação |
|---|---|
| Site público, termos, privacidade, contato | ✅ Prontos |
| Identificação da empresa (Kleos Digital, CNPJ) | ✅ Nas 3 páginas |
| Justificativa de cada escopo | ✅ Escrita na Política de Privacidade |
| Escopo `drive.readonly` | ✅ **Removido.** Sobraram só escopos não sensíveis |
| Publicação direta no TikTok | ✅ Tela de opções construída e conferida item por item |
| Escolha rascunho x publicação direta | ✅ Do cliente, na tela de Publicação |
| E-mail de suporte que recebe mensagem | ✅ `contato@postflowtiktok.com` |
| Vídeo de demonstração do TikTok | ❌ Pendente (roteiro pronto) |
| Vídeo de demonstração do Google | ⚪ Provavelmente desnecessário — ver o roteiro |

---

## 1. Google: o escopo `drive.readonly` é caro

Esta é a descoberta mais importante desta pesquisa.

O Google classifica os escopos em três níveis. O que muda entre eles não é a dificuldade da
análise, é **quanto custa**:

| Escopo que usamos | Classificação | O que exige |
|---|---|---|
| `drive.file` | **Não sensível** | Praticamente nada. Verificação básica |
| `drive.readonly` | **Restrito** | Verificação + **avaliação de segurança CASA, refeita todo ano** |
| `userinfo.email` | Sensível | Verificação comum |

A avaliação CASA é feita por um laboratório terceirizado credenciado pelo Google, é **paga pelo
desenvolvedor** e precisa ser **repetida a cada 12 meses**. Ela é obrigatória porque o Post Flow
guarda e transmite dados de escopo restrito nos próprios servidores.

### Para que o `drive.readonly` serve no Post Flow

Só para uma coisa: a **pasta de origem**, o recurso em que o cliente aponta uma pasta do Drive dele
e o sistema fica olhando se apareceu vídeo novo lá dentro.

O `drive.file`, que é gratuito de verificar, **continua cobrindo a exportação** dos cortes prontos
para a pasta de destino, porque ele dá acesso aos arquivos que o próprio app cria.

### Por que não dá para simplesmente trocar

O `drive.file` só alcança arquivo que o app criou ou que o usuário escolheu explicitamente numa
janela do Google. Ele **não permite vigiar uma pasta** esperando arquivo novo aparecer. Então o
recurso de pasta de origem, do jeito que existe hoje, depende mesmo do escopo restrito.

### A decisão, com o dado da produção

Consultado no banco de produção em 02/08/2026:

```
pastas de ORIGEM configuradas:  0
pastas de DESTINO configuradas: 3
```

**Nenhum cliente usa a pasta de origem.** O escopo `drive.readonly` está sendo pedido, e vai custar
uma auditoria de segurança paga por ano, por um recurso que ninguém ligou. As 3 pastas em uso são
de **destino**, e essas o `drive.file` cobre sozinho.

**Recomendação: remover o `drive.readonly` antes de submeter.** Efeitos:

- A verificação do Google deixa de exigir avaliação CASA (sem custo anual, sem laboratório
  terceirizado, análise bem mais rápida);
- A exportação dos cortes para o Drive continua funcionando igual;
- O recurso de pasta de origem sai do ar. Como está em zero, não afeta ninguém hoje.

Se um dia a pasta de origem virar pedido real de cliente, a alternativa sem escopo restrito é o
seletor de arquivos do próprio Google (Google Picker): o cliente escolhe os vídeos na janela do
Google e o `drive.file` passa a alcançar aqueles arquivos. Perde-se o "vigiar pasta sozinho", mas
não exige auditoria.

Consulta para reconferir antes de decidir:

```sql
SELECT count(*) FILTER (WHERE youtube_channel_id IS NULL)     AS pastas_de_origem,
       count(*) FILTER (WHERE youtube_channel_id IS NOT NULL) AS pastas_de_destino
FROM drive_folders;
```

---

## 2. TikTok: publicação direta exige uma tela que ainda não temos

O TikTok tem **dois caminhos** de publicação, com exigências muito diferentes:

### Caminho A: caixa de entrada (o que o Post Flow usa hoje)

Endpoint `/v2/post/publish/inbox/video/init/`. O corte chega como **rascunho** no aplicativo do
TikTok e o criador finaliza por lá. Como quem escolhe privacidade, comentários e duetos é o próprio
TikTok, **o nosso app não precisa oferecer essas opções**. É o caminho mais simples de aprovar.

### Caminho B: publicação direta (o que a landing promete)

Endpoint `/v2/post/publish/video/init/`. O corte vai direto para o perfil, sem o criador tocar em
nada. Para isso o TikTok exige que a **nossa tela** mostre, antes de cada publicação:

1. **Apelido e foto da conta** de destino, buscados na hora (endpoint `creator_info/query`);
2. **Seletor de privacidade** (público / amigos / só eu), com as opções vindas do `creator_info` e
   **nenhuma marcada por padrão**;
3. **Comentários, duetos e junções** em caixas de seleção, **todas desmarcadas por padrão**, e
   desabilitadas quando a conta do criador não permite;
4. **Divulgação comercial**: um botão que indica se o vídeo promove marca própria ou de terceiro,
   com os avisos "Conteúdo promocional" / "Parceria paga". Conteúdo de marca não pode ser privado;
5. **Prévia do vídeo** e a frase obrigatória "Ao publicar, você concorda com a Confirmação de Uso
   de Música do TikTok";
6. Duração máxima do vídeo respeitando `max_video_post_duration_sec` da conta.

**Onde isso encaixa no Post Flow**: essas escolhas não precisam acontecer no segundo exato do
envio. Elas precisam ser feitas manualmente pelo criador, no nosso app, antes do corte sair. O
lugar natural é a **fila de publicação**, onde o cliente já edita a legenda de cada corte.

### Enquanto a auditoria não passa

O app fica em modo de desenvolvimento: **toda publicação sai como "só eu"** e no máximo **5 contas**
podem autorizar o app a cada 24 horas. A auditoria leva de 2 a 4 semanas e costuma ter mais de uma
rodada de correções.

### Regra que já cumprimos, e que reprova na hora quem não cumpre

O TikTok **proíbe** o app de adicionar marca d'água, logo ou texto promocional ao vídeo. O Post Flow
queima legenda e, opcionalmente, o título **do próprio cliente**. Nunca a nossa marca. Isso está
correto e precisa continuar assim.

---

## 3. Como as plataformas testam o app

As duas revisam com **pessoas de verdade**, e as duas pedem essencialmente a mesma coisa:

**Vídeo de demonstração (gravação de tela), obrigatório nos dois.** Precisa mostrar, sem cortes:

- o site, com a política de privacidade acessível;
- alguém entrando na conta;
- a tela onde a conexão é iniciada;
- **a tela de consentimento da plataforma**, com os escopos aparecendo (esta parte é a que o
  revisor mais olha);
- o recurso funcionando depois de autorizado.

**Conta de teste.** O Google costuma se virar com o vídeo. O TikTok **precisa** de uma conta:

- Crie uma conta de cliente no Post Flow só para isso, com um canal de exemplo já configurado;
- No TikTok Developer Console, adicione a conta TikTok de teste na lista de contas autorizadas
  (lembre do limite de 5 autorizações por 24h enquanto está em desenvolvimento);
- Informe usuário e senha no formulário de submissão.

> Não use a sua conta pessoal, e não deixe a conta de teste com dados de cliente real.

---

## 4. Stripe não precisa estar pronta

**Não.** Nem o Google nem o TikTok analisam cobrança. O que eles verificam é acesso a dados do
usuário e uso da API.

O que importa é **coerência**: se a landing anuncia preço, a página de planos precisa existir e
funcionar. Ela existe, e o admin ativa o plano manualmente. Se o revisor clicar em "Assinar" e vir
"pagamento por cartão ainda não está disponível, fale com o suporte", isso é uma mensagem honesta
de produto em lançamento, não um erro.

**Recomendação**: submeta as aprovações agora e conecte a Stripe em paralelo. As aprovações levam
semanas; a Stripe leva um dia.

---

## 5. Publicar também no YouTube Shorts

**Tecnicamente é simples. O problema é a cota e o momento.**

O upload usa `videos.insert` da YouTube Data API. Um Short é um vídeo comum, vertical e de até 3
minutos: mesma chamada, sem endpoint especial. O nosso pipeline já produz exatamente esse arquivo.

Três coisas atrapalham:

1. **A cota.** Cada upload custa **1.600 unidades** e o projeto começa com **10.000 por dia**. Ou
   seja: **6 publicações por dia no total**, somando todos os clientes. Para aumentar é preciso um
   pedido de auditoria à parte, com formulário, vídeo e semanas de espera.
2. **Escopo novo na hora errada.** `youtube.upload` entraria na mesma verificação do Google que
   você está prestes a submeter, com o Drive. Mais escopo é mais superfície de análise, e o pedido
   inteiro anda na velocidade do item mais lento.
3. **Reconexão de todo mundo.** Escopo novo não é concedido a token antigo. Todos os clientes
   precisariam reconectar o Google.

**Minha recomendação: não agora.** Aprove primeiro o que já existe. Depois de aprovado, o Shorts
vira um projeto próprio, com o pedido de cota começando cedo, porque é ele que demora.

Quando chegar a hora, o que precisa ser feito:

- Escopo `youtube.upload` no `googleService`, e um `youtubeUploadService` novo (upload retomável,
  mesmo padrão do TikTok);
- As contas do YouTube de **destino** são outra coisa dos canais **monitorados** de hoje: precisa de
  tabela própria, no mesmo espírito de `tiktok_accounts`;
- `postings` deixa de ser só do TikTok: precisa de um campo de destino, e o `tiktokPostingJob` vira
  um despachante por destino;
- Fila de publicação e agendamento passam a existir por destino;
- Controle de cota próprio, senão o sétimo vídeo do dia falha sem explicação.

Estimativa honesta: **3 a 5 dias de trabalho** depois que a cota estiver aprovada. A espera pela
cota é o que manda no prazo, não o código.

---

## Links oficiais

- [Escopos do Drive e classificação](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Verificação de escopo restrito (Google)](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [Verificação de escopo sensível (Google)](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Cotas e auditoria da YouTube Data API](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)
- [Diretrizes de compartilhamento de conteúdo (TikTok)](https://developers.tiktok.com/doc/content-sharing-guidelines)
- [Content Posting API, publicação direta (TikTok)](https://developers.tiktok.com/doc/content-posting-api-reference-direct-post)
- [Query Creator Info (TikTok)](https://developers.tiktok.com/doc/content-posting-api-reference-query-creator-info)
