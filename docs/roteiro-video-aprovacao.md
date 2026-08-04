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
- [ ] **Conta de teste do Post Flow** com canal cadastrado e **um corte pronto na fila**.
- [ ] **Modo de publicação: "Direto no perfil"** já escolhido na conta que você vai usar.
- [ ] **Abra `postflowclips.com` numa anônima e recarregue 3 vezes.** Se aparecer a página da
      Hostinger em alguma, o DNS ainda não terminou de propagar aí — espere e teste de novo.
- [ ] Feche abas, notificações e qualquer coisa com nome de pessoa real na tela.
- [ ] Tela em 1920×1080, zoom do navegador em 100%.

**Como gravar:** QuickTime ("Gravação de Tela") ou OBS. Mouse devagar, 2 segundos parado em cada
tela importante, e **sem cortes** nas partes de autorização.

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

> Os números do passo 8 não são enfeite: eles são o escopo `user.info.stats` funcionando. Escopo
> pedido que não aparece no vídeo é motivo de recusa.

## Cena 4 — Escolher o modo (01:45 – 02:00)

1. Clique em **Configurar postagens dessa conta**
2. Mostre o bloco **"Como o corte chega no TikTok"**, com as duas opções
3. Clique em **Direto no perfil**

## Cena 5 — As opções de publicação (02:00 – 03:30) — **a que a auditoria mais examina**

Abra o primeiro corte da fila e mostre, **um por um, pausando em cada**:

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

## Cena 6 — Publicar (03:30 – 04:30)

1. Clique em **Postar agora** naquele corte
2. Mostre o status mudando para enviando / processando
3. **Abra o TikTok** na conta de teste e **mostre o vídeo publicado**
4. Volte ao Post Flow e mostre o corte na aba **Postados**

> Se demorar, corte e escreva na legenda "3 minutes later". Terminar mostrando o vídeo dentro do
> TikTok é o que fecha a demonstração.

---

## O que reprova na hora

- Tela de autorização do TikTok não aparecer (navegador já logado)
- Escopo ou produto pedido que não aparece funcionando no vídeo
- Domínio do vídeo diferente do cadastrado no formulário
- Marca d'água ou logo do Post Flow no vídeo — não existe, e não pode passar a existir
- Termos ou Privacidade que não abrem
