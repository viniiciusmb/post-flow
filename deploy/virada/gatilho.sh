#!/usr/bin/env bash
# Gatilho da virada: espera ate a hora marcada e dispara "virada.sh executar".
# Iniciado pelo launchd (virada.sh agendar) dentro de um "caffeinate", que
# impede o Mac de dormir enquanto espera - desde que ele esteja NA TOMADA e
# com a TAMPA ABERTA (tampa fechada faz o Mac dormir de qualquer jeito).
#
# A hora fica em ~/.postflow-virada/horario (formato "AAAA-MM-DD HH:MM", hora
# local do Mac). Se o Mac dormir e so acordar depois da janela da madrugada,
# o "executar --agendado" se recusa a rodar - nada acontece com o site cheio.
set -uo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
ESTADO="$HOME/.postflow-virada"
LOG="$HOME/Library/Logs/postflow-virada.log"
export PATH="/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

avisar() {
  osascript -e "display notification \"$2\" with title \"Post Flow - $1\" sound name \"Glass\"" >/dev/null 2>&1 || true
}

HORARIO=$(cat "$ESTADO/horario" 2>/dev/null) || { echo "sem horario agendado" >> "$LOG"; exit 0; }
ALVO=$(date -j -f "%Y-%m-%d %H:%M" "$HORARIO" +%s) || exit 1
echo "[$(date '+%H:%M:%S')] Gatilho armado para $HORARIO (pid $$)." >> "$LOG"

# Espera pelo relogio de parede, 30s por vez: um "sleep" unico longo nao conta
# o tempo em que o Mac eventualmente cochilou.
esperar_ate() {
  while [ "$(date +%s)" -lt "$1" ]; do
    [ -f "$ESTADO/horario" ] || { echo "[$(date '+%H:%M:%S')] Gatilho cancelado." >> "$LOG"; exit 0; }
    sleep 30
  done
}

# 1h30 antes: adianta a copia dos arquivos (sem parar nada), pra na hora da
# troca sobrar so o que ficou pronto nesse meio tempo.
ADIANTAR=$((ALVO - 90 * 60))
if [ "$(date +%s)" -lt "$ADIANTAR" ]; then
  esperar_ate "$ADIANTAR"
  echo "[$(date '+%H:%M:%S')] Adiantando a copia dos arquivos..." >> "$LOG"
  "$AQUI/copiar-cortes.sh" >> "$LOG" 2>&1 || echo "[$(date '+%H:%M:%S')] (copia adiantada falhou - a virada tenta de novo)" >> "$LOG"
fi
esperar_ate "$ALVO"

avisar "virada" "Comecou a troca de servidor ($HORARIO)."
if "$AQUI/virada.sh" executar --agendado; then
  case "$(cat "$ESTADO/fase" 2>/dev/null)" in
    concluida) avisar "virada concluida" "Site no ar na VPS nova. Troque o DNS na Hostinger (A -> 177.7.61.54)." ;;
    *)         avisar "virada" "Terminou sem trocar nada (ver ~/Library/Logs/postflow-virada.log)." ;;
  esac
else
  avisar "virada FALHOU" "Tudo foi desfeito e o site continua na VPS antiga. Ver o log."
fi
rm -f "$ESTADO/horario"
launchctl bootout "gui/$(id -u)/com.postflow.virada" >/dev/null 2>&1 || true
