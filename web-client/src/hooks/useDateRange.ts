import { useState } from "react"
import type { DateRangeKey } from "@/types/api"

const STORAGE_KEY = "postflow.dateRange"
const DEFAULT_RANGE: DateRangeKey = "last7days"

function readInitial(): DateRangeKey {
  const stored = window.localStorage.getItem(STORAGE_KEY)
  if (stored === "today" || stored === "yesterday" || stored === "last7days" || stored === "this_month" || stored === "last_month") {
    return stored
  }
  return DEFAULT_RANGE
}

// Compartilha o periodo escolhido entre os dashboards (guardado no
// localStorage) - troca uma vez, todos os paineis abrem no mesmo filtro.
export function useDateRange() {
  const [range, setRangeState] = useState<DateRangeKey>(readInitial)

  function setRange(next: DateRangeKey) {
    window.localStorage.setItem(STORAGE_KEY, next)
    setRangeState(next)
  }

  return { range, setRange }
}
