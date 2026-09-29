#!/bin/sh
# Redireciona o tunel do programa de bandeja da VPS antiga para a nova.
# Roda NA VPS ANTIGA.
#
#   tunel.sh ligar  [porta]   conexoes novas na porta (padrao 2222) vao pra nova
#   tunel.sh desligar [porta] volta ao normal (rele antigo atende de novo)
#
# Por que no firewall e nao trocando o container: o rele antigo gera chaves
# novas e esquece as autorizadas toda vez que reinicia. Deixando ele intacto,
# desfazer a troca e so apagar estas regras - o programa de bandeja volta pro
# rele antigo sem perceber nada. A nova tem as mesmas chaves de identidade do
# rele antigo (copiadas na preparacao), entao o programa tambem nao estranha
# o servidor novo.
set -eu
ACAO="${1:-}"
PORTA="${2:-2222}"
NOVA=177.7.61.54
MARCA="postflow-virada-$PORTA"

regras() {
  # $1 = -I (inserir) ou -D (apagar)
  iptables -t nat "$1" PREROUTING -p tcp --dport "$PORTA" -m comment --comment "$MARCA" -j DNAT --to-destination "$NOVA:2222"
  iptables -t nat "$1" POSTROUTING -p tcp -d "$NOVA" --dport 2222 -m comment --comment "$MARCA" -j MASQUERADE
  iptables "$1" DOCKER-USER -p tcp -d "$NOVA" --dport 2222 -m comment --comment "$MARCA" -j ACCEPT
  iptables "$1" DOCKER-USER -p tcp -s "$NOVA" --sport 2222 -m comment --comment "$MARCA" -j ACCEPT
}

ligado() { iptables -t nat -S PREROUTING | grep -q -- "$MARCA"; }

case "$ACAO" in
  ligar)
    ligado && { echo "ja estava ligado ($PORTA)"; exit 0; }
    regras -I
    echo "tunel $PORTA -> $NOVA:2222 ligado"
    ;;
  desligar)
    while ligado; do regras -D 2>/dev/null || break; done
    echo "tunel $PORTA desligado"
    ;;
  status)
    ligado && echo "ligado ($PORTA)" || echo "desligado ($PORTA)"
    ;;
  *) echo "uso: $0 ligar|desligar|status [porta]" >&2; exit 2 ;;
esac
