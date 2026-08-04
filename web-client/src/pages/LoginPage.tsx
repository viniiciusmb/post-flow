import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { BrandMark } from "@/components/brand-mark"
import { api, ApiError } from "@/lib/api"
import type { SessionUser } from "@/types/api"
import { useT } from "@/i18n"

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.9 32.6 29.4 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l6-6C34 5.1 29.3 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.4-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l6-6C34 5.1 29.3 3 24 3 16.3 3 9.7 7.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 45c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 36.5 26.7 37 24 37c-5.3 0-9.8-3.4-11.4-8.1l-6.5 5C9.6 40.6 16.2 45 24 45z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-1 3-3.2 5.4-6 6.9l6.3 5.3C39.6 37.5 43 31.4 43 24c0-1.4-.1-2.7-.4-3.5z"
      />
    </svg>
  )
}

export function ProductPreview() {
  const t = useT()
  return (
    // Coluna de verdade (texto em cima, mockup embaixo) em vez de posicionar o
    // texto por cima: com posicionamento absoluto o cartão cobria o final do
    // parágrafo em telas mais baixas.
    <div className="relative hidden overflow-hidden border-l border-border/60 bg-[#fbfbfd] lg:flex lg:flex-col dark:bg-[#0c0d10] lg:items-center lg:justify-center lg:gap-9 lg:p-16">
      <div className="absolute -top-16 -left-16 size-80 rounded-full bg-indigo-600/10 blur-3xl" />
      <div className="absolute -right-10 -bottom-10 size-72 rounded-full bg-cyan-500/15 blur-3xl" />

      <div className="relative z-10 max-w-md text-center">
        <h2 className="font-heading text-2xl leading-tight font-semibold tracking-tight text-foreground">
          {t("auth.previaTitulo")}
        </h2>
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
          {t("auth.previaTexto")}
        </p>
      </div>

      <div className="relative z-10 w-[300px] -rotate-2 rounded-[20px] border border-border bg-white p-4 dark:bg-card shadow-[0_30px_60px_-20px_rgba(15,15,40,0.18),0_10px_24px_-12px_rgba(15,15,40,0.08)]">
        <div className="mb-3.5 flex items-center gap-2.5 border-b border-border/70 pb-3.5">
          <div className="size-8.5 shrink-0 rounded-full bg-foreground/85" />
          <div>
            <div className="text-[13.5px] font-semibold">@seucanal</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-green-600">
              <span className="size-1.5 animate-pulse rounded-full bg-green-600" />
              {t("auth.monitorandoCanal")}
            </div>
          </div>
        </div>

        {/* Corte fictício, no formato que o produto realmente entrega: vertical,
            com a numeração de parte no topo e a legenda queimada embaixo. É um
            mockup declarado (nada aqui é foto de cliente real), mas usa a mesma
            linguagem visual da saída de verdade, então mostra o produto em vez
            de um retângulo com play. */}
        <div className="relative mb-4 aspect-[9/13] w-full overflow-hidden rounded-xl bg-[#101014]">
          {/* "Cena" abstrata: só um clima de estúdio, sem fingir ser uma foto. */}
          <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,#3a3f52_0%,#191c26_55%,#0e1015_100%)]" />
          <div className="absolute bottom-[24%] left-1/2 size-28 -translate-x-1/2 rounded-full bg-white/[0.07] blur-xl" />

          <span className="absolute top-2.5 left-2.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[9.5px] font-bold text-white">
            Parte 1
          </span>

          {/* Legenda queimada, no estilo "balão escuro" que existe no produto. */}
          <div className="absolute inset-x-3 bottom-9 flex flex-col items-center gap-1">
            <span className="rounded bg-black/85 px-1.5 py-0.5 text-[11px] leading-tight font-extrabold text-white">
              O ERRO QUE QUASE
            </span>
            <span className="rounded bg-black/85 px-1.5 py-0.5 text-[11px] leading-tight font-extrabold text-white">
              TODO MUNDO COMETE
            </span>
          </div>

          <span className="absolute right-2.5 bottom-2.5 rounded-full bg-white/12 px-2 py-0.5 text-[9.5px] font-semibold text-white/80">
            0:38
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          {[
            { label: t("auth.videoNovoDetectado"), state: "done" },
            { label: t("auth.adicionadoAFila"), state: "done" },
            { label: t("auth.publicandoNoTikTok"), state: "active" },
          ].map((step, i) => (
            <div
              key={step.label}
              className={cnStep(step.state)}
            >
              <span className={cnStepNum(step.state)}>
                {step.state === "done" ? "✓" : i + 1}
              </span>
              {step.label}
            </div>
          ))}
        </div>
      </div>

      <div className="absolute right-10 bottom-24 z-20 flex rotate-3 items-center gap-2 rounded-xl border border-border bg-white px-3.5 py-2.5 text-[12.5px] font-semibold dark:bg-card shadow-[0_16px_32px_-12px_rgba(15,15,40,0.16)]">
        <div className="flex size-5 shrink-0 items-center justify-center rounded-md bg-[#0b0b14] dark:ring-1 dark:ring-white/15">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
            <path
              d="M16.5 3c.3 2.4 1.8 4 4.5 4.2v3c-1.7.1-3.2-.4-4.5-1.4v6.7c0 3.5-2.8 6.3-6.3 6.3S4 18.9 4 15.4s2.8-6.3 6.3-6.3c.4 0 .8 0 1.1.1v3.2c-.4-.1-.7-.2-1.1-.2-1.8 0-3.2 1.4-3.2 3.2s1.4 3.2 3.2 3.2 3.3-1.3 3.3-3.1V3h3.1z"
              fill="#fff"
            />
          </svg>
        </div>
        Postado com sucesso
      </div>
    </div>
  )
}

function cnStep(state: string) {
  return [
    "flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-[12.5px] transition-colors",
    state === "active"
      ? "bg-muted font-medium text-foreground"
      : state === "done"
        ? "font-medium text-foreground"
        : "text-muted-foreground",
  ].join(" ")
}

function cnStepNum(state: string) {
  return [
    "flex size-4.5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold transition-colors",
    state === "done"
      ? "border-indigo-600 bg-indigo-600 text-white"
      : state === "active"
        ? "border-indigo-600 text-indigo-600"
        : "border-border text-muted-foreground",
  ].join(" ")
}

export function LoginPage() {
  const t = useT()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(false)
  // O login com Google acontece fora da página (sai pro Google e volta), então
  // o que deu errado chega na URL, não numa resposta de fetch.
  const [error, setError] = useState<string | null>(
    new URLSearchParams(window.location.search).get("erro")
  )
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const { user } = await api.post<{ user: SessionUser }>("/api/auth/login", {
        email,
        password,
        rememberMe,
      })
      window.location.href = user.role === "admin" ? "/admin" : "/client"
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("auth.naoFoiPossivelEntrar"))
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(360px,480px)_1fr]">
      <div className="flex flex-col justify-between px-8 py-10 sm:px-14">
        <a href="/login" className="flex items-center gap-2.5">
          <BrandMark className="size-7.5" />
          <span className="font-heading text-lg font-bold tracking-tight">Post Flow</span>
        </a>

        <div className="mx-auto w-full max-w-[340px]">
          <div className="mb-8">
            <h1 className="font-heading text-[28px] font-semibold tracking-tight">
              {t("auth.bemVindo")}
            </h1>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
              {t("auth.bemVindoTexto")}
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            <FieldGroup>
              {error && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}

              <Field>
                <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  placeholder={t("auth.emailPlaceholder")}
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="password">{t("auth.senha")}</FieldLabel>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </Field>

              <div className="flex items-center justify-between text-[13.5px]">
                <label className="flex items-center gap-2 text-muted-foreground">
                  <Checkbox
                    checked={rememberMe}
                    onCheckedChange={(checked) => setRememberMe(checked === true)}
                  />
                  {t("auth.lembrarDeMim")}
                </label>
                <a href="/esqueci-senha" className="font-medium text-primary hover:underline">
                  {t("auth.esqueceuSenha")}
                </a>
              </div>

              <Field>
                <Button type="submit" disabled={loading}>
                  {loading ? t("auth.entrando") : t("auth.entrar")}
                </Button>
              </Field>

              <div className="flex items-center gap-3 text-[12.5px] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
                {t("auth.ouContinueCom")}
              </div>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  // Navegação de página inteira, não fetch: o Google recusa ser
                  // aberto dentro de um iframe ou por XHR, e o retorno precisa
                  // cair no nosso servidor pra criar a sessão.
                  window.location.href = "/auth/google/login"
                }}
              >
                <GoogleIcon />
                {t("auth.entrarComGoogle")}
              </Button>

              <p className="text-center text-[13.5px] text-muted-foreground">
                {t("auth.aindaNaoTemConta")}{" "}
                <a href="/register" className="font-medium text-primary hover:underline">
                  {t("auth.criarContaGratis")}
                </a>
              </p>
            </FieldGroup>
          </form>
        </div>

        <p className="mx-auto max-w-[340px] text-center text-xs leading-relaxed text-muted-foreground/70">
          {t("auth.rodapeA")}{" "}
          <a href="/termos" className="underline">
            {t("auth.rodapeTermos")}
          </a>{" "}
          {t("auth.rodapeE")}{" "}
          <a href="/privacidade" className="underline">
            {t("auth.rodapePrivacidade")}
          </a>{" "}
          {t("auth.rodapeFim")}
        </p>
      </div>

      <ProductPreview />
    </div>
  )
}
