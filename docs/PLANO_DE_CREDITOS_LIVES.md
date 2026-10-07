# Plano: cortes de live consumindo o mesmo crédito dos cortes do YouTube

Proposta de 06/10/2026. **Ainda não implementado** — falta o fundador escolher a taxa (seção 3).
Custos medidos em produção, não estimados. Dólar a R$ 5,50.

## 1. Quanto custa hoje

| | Custo medido | Por minuto | Fonte |
|---|---|---|---|
| **Corte de vídeo do YouTube** | US$ 0,56 por hora de vídeo | **R$ 0,052** | 12 vídeos completos, 249 min (CLAUDE.md, 11/09/2026) |
| **Corte de live, média** | US$ 0,24 por hora de live | R$ 0,022 | 11,5 h gravadas, 7 lives, 28/09 a 07/10 |
| **Corte de live, configuração atual** (mais cortes por hora) | US$ 0,33 por hora de live | **R$ 0,030** | live do coringa, 06/10: 1,2 h, 14 cortes |

Para onde vai o dinheiro de uma hora de live (média): transcrição US$ 0,12 · juiz US$ 0,07 ·
legenda dos cortes US$ 0,04 · o resto (formato, ajuste fino, revisão, posição do texto) US$ 0,02.

- **Um minuto de live custa ~60% de um minuto de YouTube.** A transcrição da live sai mais barata
  (modelo cobrado por token e áudio acelerado) e não há proxy pago: a Twitch/Kick não bloqueia o
  servidor como o YouTube.
- **Gravação compartilhada:** dois clientes acompanhando o mesmo canal pagam UMA transcrição
  (~35% do custo). Cada cliente a mais no mesmo canal é margem.
- **"Clipar este momento"** (botão manual) custa ~US$ 0,02 por corte (transcreve 2,5 min, renderiza,
  ~5 chamadas de IA).

## 2. O limite que aparece antes do dinheiro: o processador

A VPS tem **2 núcleos**, e o worker de lives tem **1**. Hoje cada corte leva ~5 min da fila até
ficar pronto. Com o nível de qualidade no máximo (até 15 cortes/h), um núcleo dá conta de mais ou
menos **2 a 3 lives ao mesmo tempo**. Por isso a sugestão limita lives simultâneas por plano: sem
isso, a fila de render atrasaria todo mundo antes de o crédito virar problema.

## 3. Sugestão

**1 crédito continua sendo 1 minuto de vídeo do YouTube. Na live, 1 crédito = 2 minutos de live
clipada.**

- Conta simples de explicar: "uma live de 2 horas usa 60 créditos".
- Quase empata o custo por crédito: R$ 0,052 (YouTube) contra R$ 0,060 (2 min de live, na
  configuração mais cara de hoje).
- O minuto só conta enquanto **aquele cliente está recebendo cortes** daquela live (automático
  ligado ou "Clipar esta live"). Canal só acompanhado, sem clipar, não gasta nada.
- **"Clipar este momento"** = **2 créditos** fixos por clique.
- **Admin isento**, como já é no YouTube.

| Plano | Preço | Créditos/semana | ≈ por mês | Só live: horas/mês | Nosso custo (só live) | Margem | Lives ao mesmo tempo |
|---|---|---|---|---|---|---|---|
| Starter | R$ 99,90 | 90 | 390 | **13 h** | R$ 24 | **76%** | 1 |
| Pro | R$ 159,90 | 180 | 780 | **26 h** | R$ 47 | **70%** | 2 |
| Max | R$ 229,90 | 270 | 1.170 | **39 h** | R$ 71 | **69%** | 3 |

(Margem antes da taxa do Asaas, com o cliente usando 100% da cota em live. Na média real os
clientes usam 11% da cota, então a margem de verdade é bem maior.)

**Excedente na live**: metade da taxa por minuto do YouTube (Starter R$ 0,125 · Pro R$ 0,10 ·
Max R$ 0,09 por minuto de live). Ainda fica 3 a 4 vezes acima do custo.

### Alternativa mais agressiva (pra brigar com o Cut.pro)

O Cut.pro cobra 1 crédito por minuto de live, mas o plano Plus (R$ 69,90) dá 1.000 créditos/mês:
**R$ 0,07 por minuto de live**. O nosso Starter, com a sugestão acima, sai a R$ 0,128 por minuto
de live, mas inclui a publicação automática no TikTok e os cortes do YouTube.
Se quiser empatar: **1 crédito = 3 minutos de live**. O Starter vira 19,5 h de live/mês
(R$ 0,085/min), com margem de ~65% no pior caso. O que segura essa opção é o processador, não o
dinheiro.

## 4. A cota semanal e as lives

Live é longa e concentrada: uma live de 4 h gasta 120 créditos, mais que a semana inteira do
Starter (90). Para não virar frustração:

1. **Mostrar a conta antes**: no "Adicionar canal" e no "Clipar esta live", "isto usa ~1 crédito a
   cada 2 minutos; você tem X créditos (≈ Y horas de live)".
2. **Limite por live**, escolhido pelo cliente na engrenagem do canal ("parar depois de N créditos").
3. **Acabou o crédito no meio da live**: para de clipar para aquele cliente e avisa na tela; se
   ele autorizou o cartão de excedente, continua cobrando como excedente.
4. Crédito avulso (que não vence) é gasto antes do excedente, igual ao YouTube.

## 5. Como implementar (quando a taxa for escolhida)

1. Tabela `live_credit_usage` (sessão, cliente, bloco de 10 min, créditos, status) com
   `UNIQUE(session_id, user_id, bloco)`. Reenvio ou reinício do worker nunca cobra duas vezes.
2. A cada bloco de 10 min gravado, para cada cliente que está recebendo cortes, `reserve` de 5
   créditos no motor que já existe (`clientCreditsRepository.reserve`, atômico e testado com
   concorrência). Sem saldo: o cliente sai de `followersWithQuality` naquela sessão; se mais
   ninguém acompanha, a gravação para.
3. "Clipar este momento": reserva 2 créditos no clique (409 se não tiver).
4. Tela: "esta live já usou X créditos" no cartão do canal; limite por live na engrenagem.
5. Testes: idempotência por bloco, 10 blocos simultâneos contra saldo curto, corte parando quando o
   crédito acaba, admin isento. Teste de mutação em cada trava.
