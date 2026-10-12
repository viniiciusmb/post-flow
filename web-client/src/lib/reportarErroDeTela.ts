import { csrfToken } from "@/lib/api"

/**
 * Manda pro servidor os erros de JavaScript das telas, pra quem está no painel
 * novo (as novidades em teste). É o que pega a "tela branca": um erro desses
 * não chega no servidor por nenhum outro caminho - a tela de Planos ficou em
 * branco em 21/08/2026 e só foi achada porque o fundador abriu a página.
 *
 * Vai pra tela "Erros em teste" do admin. No máximo 5 por página aberta e uma
 * vez cada mensagem: um erro em loop não pode virar centenas de requisições.
 */
let instalado = false

export function instalarRelatorioDeErros() {
  if (instalado || typeof window === "undefined") return
  instalado = true
  const vistas = new Set<string>()
  let enviados = 0

  function enviar(mensagem: string, pilha?: string) {
    const chave = mensagem.slice(0, 200)
    if (!mensagem || vistas.has(chave) || enviados >= 5) return
    vistas.add(chave)
    enviados += 1
    fetch("/api/client/erros-de-tela", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken() },
      body: JSON.stringify({ mensagem, pagina: window.location.pathname, pilha: (pilha || "").slice(0, 3000) }),
      keepalive: true,
    }).catch(() => {})
  }

  window.addEventListener("error", (e) => {
    // Erro de carregar imagem/script de outro site não é defeito nosso.
    if (!e.message) return
    enviar(e.message, e.error instanceof Error ? e.error.stack : undefined)
  })
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason
    // Falha de API já vira mensagem na própria tela; aqui interessa o que quebra o código.
    if (r && typeof r === "object" && "status" in r) return
    enviar(r instanceof Error ? r.message : String(r), r instanceof Error ? r.stack : undefined)
  })
}
