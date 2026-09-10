import { useState } from "react"
import type { DateRangeKey } from "@/types/api"

const STORAGE_KEY = "postflow.dateRange"
// Chave de versão do padrão. Quando o padrão muda, quem já tinha uma escolha
// guardada continuaria vendo a antiga para sempre — inclusive quem nunca
// escolheu nada e só herdou o padrão de antes, que é a maioria. Trocar a
// versão zera uma vez só; a partir daí a escolha de cada um é respeitada.
const VERSION_KEY = "postflow.dateRange.v"
const VERSION = "2"

// "Hoje" é o padrão: o dashboard responde primeiro "como está agora", e quem
// quer olhar o acumulado troca em um clique.
const DEFAULT_RANGE: DateRangeKey = "today"

const VALIDOS: DateRangeKey[] = ["today", "yesterday", "last7days", "this_month", "last_month", "all", "custom"]

function readInitial(): DateRangeKey {
  try {
    if (window.localStorage.getItem(VERSION_KEY) !== VERSION) {
      window.localStorage.setItem(VERSION_KEY, VERSION)
      window.localStorage.setItem(STORAGE_KEY, DEFAULT_RANGE)
      return DEFAULT_RANGE
    }
    const stored = window.localStorage.getItem(STORAGE_KEY) as DateRangeKey | null
    // "custom" não é retomado: o intervalo escolhido não é guardado junto, então
    // voltar nele abriria a tela num período que ninguém sabe qual é.
    if (stored && stored !== "custom" && VALIDOS.includes(stored)) return stored
  } catch {
    // Navegador com armazenamento bloqueado: o padrão serve.
  }
  return DEFAULT_RANGE
}

// Compartilha o periodo escolhido entre os dashboards (guardado no
// localStorage) - troca uma vez, todos os paineis abrem no mesmo filtro.
export function useDateRange() {
  const [range, setRangeState] = useState<DateRangeKey>(readInitial)

  function setRange(next: DateRangeKey) {
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // Sem armazenamento, a escolha vale só nesta tela.
    }
    setRangeState(next)
  }

  return { range, setRange }
}
