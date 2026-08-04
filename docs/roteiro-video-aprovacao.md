# Roteiro do vídeo para o TikTok

Passo a passo para gravar. O que preencher no formulário está em
[`tiktok-formulario.md`](tiktok-formulario.md).

**Limites:** mp4 ou mov, até 5 arquivos, 50 MB cada. Um vídeo de 3 a 5 minutos resolve.

---

## Suas três dúvidas, respondidas

**Preciso criar uma conta no Post Flow durante o vídeo?**
Não. Entre com uma conta que já existe. O TikTok quer ver a **integração com o TikTok**, não o
cadastro no seu produto. Criar conta no meio só alonga o vídeo.

Mas essa conta precisa estar **preparada**: com um canal do YouTube cadastrado e pelo menos um corte
pronto na fila. Gerar corte na hora leva minutos e não dá pra esperar gravando.

**A conta do TikTok já pode estar logada no navegador?**
**Não. Ela precisa estar DESLOGADA.**

Esse é o ponto mais importante do vídeo inteiro. Se o navegador já estiver logado no TikTok, ele
pula a tela de login — e a tela de autorização (aquela que lista as permissões) é exatamente o que o
revisor mais olha. Sem ela na gravação, a análise é recusada.

Por isso: **grave numa janela anônima**, onde não há sessão nenhuma do TikTok. Você faz o login
durante a gravação, e o revisor vê o fluxo completo.

**Posso entrar no TikTok por QR code?**
Pode, o TikTok aceita. Mas **recomendo entrar com e-mail e senha da conta de teste.**

O QR exige apontar o celular pra tela, e aí ou você filma o celular (fica confuso) ou o revisor vê
um QR aparecer e a tela mudar sozinha (parece corte de edição). Com e-mail e senha, tudo acontece na
tela que está sendo gravada. A senha aparece como pontinhos, então não há risco.

---

## Antes de apertar o gravar

- [ ] **Sandbox com a conta de teste em Target users.** Sem isso ela não consegue autorizar o app e
      o vídeo trava na cena 3. É o erro mais comum.
- [ ] **Sandbox com o Redirect URI do domínio novo**: `https://postflowclips.com/auth/tiktok/callback`
      Teste antes: entre no Post Flow e clique em "Conectar outra conta". Se abrir a tela do TikTok,
      está certo. Se der erro de redirect, corrija no Sandbox antes de gravar.
- [ ] **Conta de teste do Post Flow** com canal cadastrado e **pelo menos um corte pronto na fila**,
      ainda **sem as opções definidas** (o botão do corte tem que estar escrito "Definir opções de
      publicação", não "Opções de publicação definidas" — senão a cena 5 não tem o que mostrar).
- [ ] **NÃO deixe "Direto no perfil" pré-selecionado.** Você escolhe isso durante a gravação, na
      cena 4 — é assim que os dois modos aparecem no vídeo.
- [ ] **Abra `postflowclips.com` numa anônima e recarregue 3 vezes.** Se aparecer a página da
      Hostinger em alguma, o DNS ainda não terminou de propagar aí — espere e teste de novo.
- [ ] Feche abas, notificações e qualquer coisa com nome de pessoa real na tela.
- [ ] Tela em 1920×1080, zoom do navegador em 100%.

**Como gravar:** QuickTime ("Gravação de Tela") ou OBS. Mouse devagar, 2 segundos parado em cada
tela importante, e **sem cortes** nas partes de autorização.

---

## Onde cada escopo aparece no vídeo

O revisor confere um por um: **escopo pedido que não aparece funcionando na gravação é recusado.**
Você pediu quatro, e cada um tem uma cena onde ele fica visível.

| Escopo | Cena | O que aparece na tela |
|---|---|---|
| `user.info.basic` | 3 | O card da conta com **apelido e foto** vindos do TikTok |
| `user.info.stats` | 3 | Os números de **seguidores, curtidas e vídeos no perfil** |
| `video.publish` | 5 e 6 | As opções de publicação e o corte saindo **direto no perfil** |
| `video.upload` | 4 | A opção **"Como rascunho"**, que manda o corte pra caixa do app |

**O que dizer (ou legendar) em cada um.** Não precisa ler igual, mas a ideia tem que ficar clara:

- **`user.info.basic`** — *"Usamos para mostrar em qual perfil o corte vai sair. O criador conecta a
  própria conta e vê o apelido e a foto dela; sem isso ele não teria como saber o destino do vídeo."*
- **`user.info.stats`** — *"Usamos para exibir seguidores, curtidas e vídeos no card da conta
  conectada, para o criador reconhecer o perfil e acompanhar o resultado dos cortes."*
- **`video.publish`** — *"Usamos para publicar o corte direto no perfil, e só depois que o criador
  escolhe manualmente a privacidade, as interações e a divulgação comercial daquele corte
  específico."*
- **`video.upload`** — *"Usamos quando o criador escolhe o modo rascunho: o corte é enviado para a
  caixa de entrada do aplicativo do TikTok e ele finaliza por lá."*

> Os dois modos são do criador, não nossos: o mesmo app usa `video.upload` ou `video.publish`
> conforme o que ele escolher na cena 4. Por isso **as duas opções precisam aparecer** na gravação.

---

## Cena 1 — O site (00:00 – 00:25)

1. Abra uma **janela anônima** e vá em `https://postflowclips.com`
2. Role a página inteira devagar, até o rodapé
3. Pare no rodapé mostrando **Termos de Uso** e **Política de Privacidade**
4. Clique em **Política de Privacidade**, role até a parte que fala do TikTok
5. Volte

> O endereço que aparece aqui tem que ser o mesmo que você cadastrou no formulário.

## Cena 2 — Entrar (00:25 – 00:45)

1. Clique em **Entrar**
2. Digite e-mail e senha da conta de teste
3. Deixe o painel carregar

## Cena 3 — Conectar o TikTok (00:45 – 01:45) — **a mais importante**

1. No menu, clique em **Publicação**
2. Clique em **Conectar outra conta**
3. **A tela do TikTok abre. NÃO CORTE NADA daqui até o fim da cena.**
4. Faça login com **e-mail e senha da conta de teste do TikTok**
5. Aparece a tela de autorização. **Pare 3 segundos.**
6. **Role a lista de permissões devagar**, de cima até embaixo, mostrando cada uma
7. Clique em **Autorizar**
8. De volta no Post Flow, **pare 3 segundos** no card da conta mostrando o apelido, a foto e os
   números de **seguidores, curtidas e vídeos no perfil**

> **Escopos desta cena: `user.info.basic` e `user.info.stats`.**
>
> O apelido e a foto no passo 8 são o `user.info.basic`; os números de seguidores, curtidas e
> vídeos são o `user.info.stats`. É a única cena em que esses dois aparecem — se ela ficar
> mal enquadrada, os dois escopos ficam sem prova no vídeo.

## Cena 4 — Escolher o modo (01:45 – 02:00)

1. Clique em **Configurar postagens dessa conta**
2. Mostre o bloco **"Como o corte chega no TikTok"**, com as duas opções
3. **Pare 2 segundos em "Como rascunho"** e leia o texto embaixo dela
4. Clique em **Direto no perfil**

> **Escopo desta cena: `video.upload`.**
>
> Ele é a opção "Como rascunho" — o corte vai pra caixa de entrada do aplicativo do TikTok e o
> criador finaliza por lá. É o único momento do vídeo em que esse escopo aparece, e por isso o
> passo 3 não pode ser pulado: você pede `video.upload` no formulário, então ele precisa estar
> visível em algum lugar da gravação.

## Cena 5 — As opções de publicação (02:00 – 03:30) — **a que a auditoria mais examina**

Você já está dentro de **Configurar postagens dessa conta** (cena 4). Desça até a aba **Fila**,
clique em **Definir opções de publicação** no primeiro corte, e mostre **um por um, pausando em
cada**:

1. **Apelido e foto** da conta de destino, no topo do bloco
2. **A prévia do vídeo** — dê play em alguns segundos e diga (ou legende):
   *"no watermark, no logo added by the app"*
3. **"Quem pode ver este vídeo"** — abra a lista e **mostre que nada vem escolhido por padrão**.
   Escolha uma opção
4. **"O que as pessoas podem fazer"** — comentar, dueto e junção, **todos desmarcados**. Marque um
5. **Divulgação comercial** — marque a caixa:
   - Marque **Sua marca** → aponte a frase *"Seu vídeo será marcado como Conteúdo promocional"*
   - Desmarque, marque **Conteúdo de parceria** → aponte *"Parceria paga"*
   - **Com a parceria marcada, abra a lista de privacidade** e mostre que **"Só você" está
     desabilitado**, com o motivo escrito
   - Desligue a divulgação
6. **A frase acima do botão**: *"Ao publicar, você concorda com a Confirmação de Uso de Música do
   TikTok"*. Passe o mouse por cima pra mostrar que é um link
7. **O aviso** de que o TikTok pode levar alguns minutos pra processar
8. Clique em **Confirmar e liberar publicação**

> **Escopo desta cena: `video.publish`.**
>
> Esta é a cena que prova a regra mais importante da Content Posting API: nada é publicado com
> valor padrão. Enquanto a privacidade não for escolhida, o botão **Confirmar e liberar publicação**
> fica desabilitado, e **Postar agora** também. É esse bloqueio que o revisor procura.

## Cena 6 — Publicar (03:30 – 04:30)

1. Clique em **Postar agora** naquele corte
2. Mostre o status mudando para enviando / processando
3. **Abra o TikTok** na conta de teste e **mostre o vídeo publicado**
4. Volte ao Post Flow e mostre o corte na aba **Postados**

> **Escopo desta cena: `video.publish` (o resultado).** A cena 5 mostrou o criador decidindo; esta
> mostra o vídeo já no perfil dele. As duas juntas fecham a demonstração do escopo.

> Se demorar, corte e escreva na legenda "3 minutes later". Terminar mostrando o vídeo dentro do
> TikTok é o que fecha a demonstração.

---

## O que reprova na hora

- Tela de autorização do TikTok não aparecer (navegador já logado)
- Escopo ou produto pedido que não aparece funcionando no vídeo
- Domínio do vídeo diferente do cadastrado no formulário
- Marca d'água ou logo do Post Flow no vídeo — não existe, e não pode passar a existir
- Termos ou Privacidade que não abrem
