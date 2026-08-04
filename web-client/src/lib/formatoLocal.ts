import { idiomaInicial } from "@/i18n"

/**
 * Data e hora no idioma escolhido.
 *
 * O projeto tinha `toLocaleString("pt-BR")` escrito em dez lugares. Com o site
 * em três idiomas isso mostraria "02/08/2026" a um americano, que lê como 8 de
 * fevereiro — uma data errada, não só um formato estranho.
 *
 * Lê o idioma direto do armazenamento em vez de um hook porque estas funções
 * são chamadas de dentro de `map`, de template string e de código fora de
 * componente, onde não dá pra usar hook. Trocar o idioma recarrega a página
 * (ver LanguageToggle), então não há risco de ficar desatualizado.
 */
function localeDoNavegador() {
  const idioma = idiomaInicial()
  return idioma === "pt" ? "pt-BR" : idioma === "es" ? "es-ES" : "en-US"
}

export function dataHora(valor: string | Date | null | undefined) {
  if (!valor) return ""
  return new Date(valor).toLocaleString(localeDoNavegador())
}

export function data(valor: string | Date | null | undefined) {
  if (!valor) return ""
  return new Date(valor).toLocaleDateString(localeDoNavegador())
}

export function hora(valor: string | Date | null | undefined) {
  if (!valor) return ""
  return new Date(valor).toLocaleTimeString(localeDoNavegador(), { hour: "2-digit", minute: "2-digit" })
}

/** Número com separador de milhar do idioma (1.234 vs 1,234). */
export function numero(valor: number | null | undefined) {
  if (valor === null || valor === undefined) return "0"
  return valor.toLocaleString(localeDoNavegador())
}
