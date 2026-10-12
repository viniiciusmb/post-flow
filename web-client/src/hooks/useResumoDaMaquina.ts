import { useEffect, useSyncExternalStore } from "react"
import { api } from "@/lib/api"

/**
 * O resumo da máquina (quanto está na linha, lives gravando, fila) que a
 * barra do topo e o menu lateral mostram em TODA tela do painel novo.
 *
 * Uma leitura só por endereço, compartilhada: o topo e o menu pedem o mesmo
 * dado, e sem isso cada tela faria duas consultas a cada 10 s. Para quando a
 * aba fica escondida - ninguém está olhando.
 */
export type ResumoDaMaquina = {
  naLinha: number
  esperando: number
  livesGravando: number
  naFila: number
  publicandoAgora: number
  fontes: number
}

const INTERVALO_MS = 10_000

type Loja = { valor: ResumoDaMaquina | null; ouvintes: Set<() => void>; timer?: number; usos: number }
const lojas = new Map<string, Loja>()

function loja(endpoint: string): Loja {
  let l = lojas.get(endpoint)
  if (!l) {
    l = { valor: null, ouvintes: new Set(), usos: 0 }
    lojas.set(endpoint, l)
  }
  return l
}

async function buscar(endpoint: string) {
  const l = loja(endpoint)
  try {
    l.valor = await api.get<ResumoDaMaquina>(endpoint)
    l.ouvintes.forEach((f) => f())
  } catch {
    // Falha em silêncio: o indicador some em vez de mostrar erro numa barra
    // que existe só pra tranquilizar.
  }
}

function ligar(endpoint: string) {
  const l = loja(endpoint)
  l.usos += 1
  if (l.usos > 1) return
  const agendar = () => {
    window.clearInterval(l.timer)
    if (document.visibilityState === "visible") l.timer = window.setInterval(() => buscar(endpoint), INTERVALO_MS)
  }
  const aoMudar = () => {
    if (document.visibilityState === "visible") buscar(endpoint)
    agendar()
  }
  document.addEventListener("visibilitychange", aoMudar)
  ;(l as Loja & { desligar?: () => void }).desligar = () => {
    window.clearInterval(l.timer)
    document.removeEventListener("visibilitychange", aoMudar)
  }
  buscar(endpoint)
  agendar()
}

function desligar(endpoint: string) {
  const l = loja(endpoint)
  l.usos -= 1
  if (l.usos <= 0) (l as Loja & { desligar?: () => void }).desligar?.()
}

/** `endpoint` null = não consulta nada (quem não está no painel novo). */
export function useResumoDaMaquina(endpoint: string | null): ResumoDaMaquina | null {
  useEffect(() => {
    if (!endpoint) return
    ligar(endpoint)
    return () => desligar(endpoint)
  }, [endpoint])
  return useSyncExternalStore(
    (f) => {
      if (!endpoint) return () => {}
      const l = loja(endpoint)
      l.ouvintes.add(f)
      return () => l.ouvintes.delete(f)
    },
    () => (endpoint ? loja(endpoint).valor : null)
  )
}
