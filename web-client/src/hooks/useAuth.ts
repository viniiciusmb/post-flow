import { useEffect, useState } from "react"
import { api, ApiError } from "@/lib/api"
import type { SessionUser } from "@/types/api"

type MeResponse = { user: SessionUser; ui?: { mostrarTunel?: boolean } }

/**
 * Uma requisição só por carregamento de página, compartilhada por quem chamar.
 *
 * Antes cada `useAuth()` disparava o seu próprio `/api/auth/me`, o que dava no
 * mesmo enquanto só as páginas chamavam. Agora o layout também precisa da
 * resposta (é ele que monta o menu), e sem esta partilha toda tela do painel
 * passaria a pedir a mesma coisa duas vezes.
 *
 * Vive no módulo, não em contexto do React, porque cada tela do painel é uma
 * página separada (o projeto é MPA, sem router): a promessa nasce e morre com
 * a página, então ela nunca fica velha.
 */
let pedido: Promise<MeResponse> | null = null

function buscarSessao() {
  if (!pedido) pedido = api.get<MeResponse>("/api/auth/me")
  return pedido
}

export function useAuth() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)
  /**
   * Mostrar ou não tudo que fala da internet do próprio cliente (menu "Sua
   * conexão", cota bônus, minutos extras nas caixas de preço, passo do tour).
   * Decidido pelo admin na tela "Banda".
   *
   * Começa FALSO, e não verdadeiro: a resposta do servidor demora um instante,
   * e um padrão "mostrar" faria o menu da conexão piscar na tela antes de
   * sumir — pior do que nunca ter aparecido. Escondido enquanto não se sabe.
   */
  const [mostrarTunel, setMostrarTunel] = useState(false)

  useEffect(() => {
    let cancelled = false

    buscarSessao()
      .then((data) => {
        if (cancelled) return
        setUser(data.user)
        setMostrarTunel(data.ui?.mostrarTunel === true)
      })
      .catch((err) => {
        // Uma sessão vencida não pode deixar a promessa compartilhada envenenada
        // para a próxima chamada: sem isto, quem chamasse depois receberia o
        // mesmo erro sem nunca ter tentado.
        pedido = null
        if (!cancelled && err instanceof ApiError && err.status === 401) {
          window.location.href = "/login"
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [])

  async function logout() {
    await api.post("/api/auth/logout")
    window.location.href = "/login"
  }

  return { user, loading, logout, mostrarTunel }
}
