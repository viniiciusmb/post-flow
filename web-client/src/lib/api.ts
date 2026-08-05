import { traduzir } from "@/i18n"
export class ApiError extends Error {
  status: number
  /**
   * Corpo completo da resposta de erro. A mensagem já vem em `message`; isto
   * aqui serve pros casos em que o servidor manda uma pista extra que muda o
   * que a tela faz (ex: `expired: true` na redefinição de senha, que troca o
   * formulário por "peça um link novo" em vez de deixar tentando de novo).
   */
  data: Record<string, unknown>
  constructor(status: number, message: string, data: Record<string, unknown> = {}) {
    super(message)
    this.status = status
    this.data = data
  }
}

/**
 * Token anti-CSRF. O servidor grava esse valor num cookie legível (csrf_token)
 * e exige o mesmo valor no cabeçalho X-CSRF-Token em toda requisição que muda
 * estado. Um site de terceiro consegue até forçar a requisição, mas não
 * consegue ler o cookie de outro domínio pra descobrir o valor, então a
 * comparação falha do lado do servidor. Ver src/web/middleware/csrf.js.
 */
export function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/)
  return match ? decodeURIComponent(match[1]) : ""
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrfToken(),
      ...init?.headers,
    },
  })

  if (response.status === 204) return undefined as T

  const data = await response.json().catch(() => ({}))

  if (!response.ok) {
    throw new ApiError(response.status, data.error || traduzir("comum.erroInesperado"), data)
  }

  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
}
