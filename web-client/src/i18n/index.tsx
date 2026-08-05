import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { pt } from "./pt"
import { en } from "./en"
import { es } from "./es"

/**
 * Tradução do painel.
 *
 * Feito à mão em vez de react-i18next de propósito: o que este projeto precisa
 * é procurar uma chave num objeto e trocar `{n}` por um número. Uma dependência
 * com detector de idioma, backend de carregamento e sistema de plurais traria
 * mais configuração do que código.
 *
 * O idioma escolhido vai pro localStorage E pro cookie `lang`. O cookie não é
 * redundante: as páginas públicas (landing, termos, privacidade) são montadas
 * no servidor, e sem ele sairiam sempre em português.
 *
 * `pt` é a única fonte completa de chaves — o tipo Dicionario é derivado dela,
 * então esquecer uma chave em `en` ou `es` é erro de compilação, não um texto
 * em português que aparece no meio da tela em inglês.
 */

export const IDIOMAS = [
  { code: "pt", label: "Português", flag: "🇧🇷" },
  { code: "en", label: "English", flag: "🇺🇸" },
  { code: "es", label: "Español", flag: "🇪🇸" },
] as const

export type Idioma = (typeof IDIOMAS)[number]["code"]

const DICIONARIOS = { pt, en, es }

const PADRAO: Idioma = "pt"

function lerCookie(nome: string) {
  const achado = document.cookie.match(new RegExp(`(?:^|; )${nome}=([^;]*)`))
  return achado ? decodeURIComponent(achado[1]) : null
}

function normalizar(valor: string | null | undefined): Idioma | null {
  if (!valor) return null
  const prefixo = valor.trim().toLowerCase().split(/[-_]/)[0]
  return (IDIOMAS as readonly { code: string }[]).some((i) => i.code === prefixo)
    ? (prefixo as Idioma)
    : null
}

export function idiomaInicial(): Idioma {
  // Mesma ordem do servidor (src/config/locales.js): escolha explícita,
  // idioma do navegador, padrão. Divergir daria uma troca visível de idioma
  // no meio do carregamento.
  return (
    normalizar(localStorage.getItem("lang")) ??
    normalizar(lerCookie("lang")) ??
    normalizar(navigator.language) ??
    PADRAO
  )
}

type Valores = Record<string, string | number>

type Contexto = {
  idioma: Idioma
  setIdioma: (i: Idioma) => void
  t: (chave: ChaveDeTraducao, valores?: Valores) => string
}

const I18nContext = createContext<Contexto | null>(null)

export function I18nProvider({ children }: { children: ReactNode }) {
  const [idioma, setIdiomaState] = useState<Idioma>(() => idiomaInicial())

  const setIdioma = useCallback((novo: Idioma) => {
    localStorage.setItem("lang", novo)
    // 1 ano. O cookie é lido pelo servidor nas páginas públicas; sem `path=/`
    // ele valeria só na página onde foi trocado.
    document.cookie = `lang=${novo}; path=/; max-age=31536000; samesite=lax`
    document.documentElement.lang = novo === "pt" ? "pt-BR" : novo
    setIdiomaState(novo)
  }, [])

  const t = useCallback(
    (chave: ChaveDeTraducao, valores?: Valores) => {
      const dicionario = DICIONARIOS[idioma] as Record<string, string>
      // Cair no português é melhor que mostrar a chave crua: se uma tradução
      // faltar em produção, a tela continua legível.
      const texto = dicionario[chave] ?? (pt as Record<string, string>)[chave] ?? chave
      if (!valores) return texto
      return texto.replace(/\{(\w+)\}/g, (bruto, nome) =>
        nome in valores ? String(valores[nome]) : bruto
      )
    },
    [idioma]
  )

  const valor = useMemo(() => ({ idioma, setIdioma, t }), [idioma, setIdioma, t])

  return <I18nContext.Provider value={valor}>{children}</I18nContext.Provider>
}

export function useI18n() {
  const ctx = useContext(I18nContext)
  if (!ctx) throw new Error("useI18n precisa estar dentro de <I18nProvider>")
  return ctx
}

/** Atalho pra quem só precisa traduzir. */
export function useT() {
  return useI18n().t
}

/**
 * Traduz fora de componente.
 *
 * Existe pro código que roda longe da árvore do React — o cliente HTTP, um
 * formatador chamado de dentro de template string. Lê o idioma do
 * armazenamento em vez do contexto; como trocar de idioma recarrega a página,
 * os dois nunca discordam.
 */
export function traduzir(chave: ChaveDeTraducao, valores?: Valores): string {
  const dicionario = DICIONARIOS[idiomaInicial()] as Record<string, string>
  const texto = dicionario[chave] ?? (pt as Record<string, string>)[chave] ?? chave
  if (!valores) return texto
  return texto.replace(/\{(\w+)\}/g, (bruto, nome) =>
    nome in valores ? String(valores[nome]) : bruto
  )
}

export type ChaveDeTraducao = keyof typeof pt
export type Dicionario = Record<ChaveDeTraducao, string>
