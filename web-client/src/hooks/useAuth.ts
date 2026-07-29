import { useEffect, useState } from "react"
import { api, ApiError } from "@/lib/api"
import type { SessionUser } from "@/types/api"

export function useAuth() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    api
      .get<{ user: SessionUser }>("/api/auth/me")
      .then((data) => {
        if (!cancelled) setUser(data.user)
      })
      .catch((err) => {
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

  return { user, loading, logout }
}
