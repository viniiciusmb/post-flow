import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { BrandMark } from "@/components/brand-mark"
import { api, ApiError } from "@/lib/api"
import type { SessionUser } from "@/types/api"

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

function ProductPreview() {
  return (
    <div className="relative hidden overflow-hidden border-l border-border/60 bg-[#fbfbfd] lg:flex lg:items-center lg:justify-center lg:p-16">
      <div className="absolute -top-16 -left-16 size-80 rounded-full bg-indigo-600/10 blur-3xl" />
      <div className="absolute -right-10 -bottom-10 size-72 rounded-full bg-cyan-500/15 blur-3xl" />

      <div className="absolute top-16 left-16 max-w-md">
        <h2 className="font-heading text-2xl leading-tight font-semibold tracking-tight text-foreground">
          Detecte e poste automaticamente, sem tocar em nada.
        </h2>
        <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">
          Conecte sua conta do Google Drive, o Post Flow detecta vídeos novos e
          publica no TikTok sozinho.
        </p>
      </div>

      <div className="relative z-10 w-[300px] -rotate-2 rounded-[20px] border border-border bg-white p-4 shadow-[0_30px_60px_-20px_rgba(15,15,40,0.18),0_10px_24px_-12px_rgba(15,15,40,0.08)]">
        <div className="mb-3.5 flex items-center gap-2.5 border-b border-border/70 pb-3.5">
          <div className="size-8.5 shrink-0 rounded-full bg-gradient-to-br from-indigo-600 to-cyan-500" />
          <div>
            <div className="text-[13.5px] font-semibold">@seucanal</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-green-600">
              <span className="size-1.5 animate-pulse rounded-full bg-green-600" />
              Monitorando Drive
            </div>
          </div>
        </div>

        <div className="relative mb-4 aspect-[9/13] w-full overflow-hidden rounded-xl bg-gradient-to-br from-[#14141c] via-[#2a2a38] to-[#1a1a24]">
          <span className="absolute top-2.5 left-2.5 rounded-full bg-black/55 px-2 py-1 text-[10px] font-semibold text-white">
            Vídeo novo detectado
          </span>
          <div className="absolute top-1/2 left-1/2 flex size-9.5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-white/10">
            <div className="ml-0.5 h-0 w-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-white" />
          </div>
        </div>

        <div className="flex flex-col gap-0.5">
          {[
            { label: "Vídeo baixado do Drive", state: "done" },
            { label: "Adicionado à fila de postagem", state: "done" },
            { label: "Publicando no TikTok...", state: "active" },
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

      <div className="absolute right-10 bottom-24 z-20 flex rotate-3 items-center gap-2 rounded-xl border border-border bg-white px-3.5 py-2.5 text-[12.5px] font-semibold shadow-[0_16px_32px_-12px_rgba(15,15,40,0.16)]">
        <div className="flex size-5 shrink-0 items-center justify-center rounded-md bg-[#0b0b14]">
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
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [rememberMe, setRememberMe] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
      setError(err instanceof ApiError ? err.message : "Nao foi possivel entrar.")
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
              Bem-vindo de volta
            </h1>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">
              Entre para acompanhar as postagens automáticas dos seus canais.
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
                <FieldLabel htmlFor="email">E-mail</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  placeholder="voce@exemplo.com"
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="password">Senha</FieldLabel>
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
                  Lembrar de mim
                </label>
                <a href="#" className="font-medium text-primary hover:underline">
                  Esqueceu a senha?
                </a>
              </div>

              <Field>
                <Button type="submit" disabled={loading}>
                  {loading ? "Entrando..." : "Entrar"}
                </Button>
              </Field>

              <div className="flex items-center gap-3 text-[12.5px] text-muted-foreground before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">
                ou continue com
              </div>

              <Button
                type="button"
                variant="outline"
                disabled
                title="Em breve"
                className="w-full"
              >
                <GoogleIcon />
                Entrar com Google
              </Button>

              <p className="text-center text-[13.5px] text-muted-foreground">
                Ainda não tem conta?{" "}
                <a href="/register" className="font-medium text-primary hover:underline">
                  Criar conta grátis
                </a>
              </p>
            </FieldGroup>
          </form>
        </div>

        <p className="mx-auto max-w-[340px] text-center text-xs leading-relaxed text-muted-foreground/70">
          Ao entrar, você concorda com os{" "}
          <a href="/termos" className="underline">
            Termos de Uso
          </a>{" "}
          e a{" "}
          <a href="/privacidade" className="underline">
            Política de Privacidade
          </a>{" "}
          do Post Flow.
        </p>
      </div>

      <ProductPreview />
    </div>
  )
}
