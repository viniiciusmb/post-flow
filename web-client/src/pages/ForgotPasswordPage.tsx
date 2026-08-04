import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { AuthShell, AuthErro } from "@/pages/AuthShell"
import { api, ApiError } from "@/lib/api"
import { useT } from "@/i18n"

export function ForgotPasswordPage() {
  const t = useT()
  const [email, setEmail] = useState("")
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [mensagem, setMensagem] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErro(null)
    setEnviando(true)
    try {
      const r = await api.post<{ message: string }>("/api/auth/forgot-password", { email })
      // A resposta é a mesma exista ou não a conta - de propósito, pra que esta
      // tela não sirva pra descobrir quem é cliente do Post Flow.
      setMensagem(r.message)
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : t("auth.naoFoiPossivelEnviar"))
    } finally {
      setEnviando(false)
    }
  }

  if (mensagem) {
    return (
      <AuthShell titulo={t("auth.verifiqueEmail")} descricao={mensagem}>
        <div className="space-y-4">
          <p className="text-[14.5px] leading-relaxed text-muted-foreground">
            {t("auth.linkVale30min")}
          </p>
          <Button variant="outline" className="w-full" onClick={() => setMensagem(null)}>
            {t("auth.usarOutroEmail")}
          </Button>
          <p className="text-center text-[13.5px] text-muted-foreground">
            <a href="/login" className="font-medium text-primary hover:underline">
              {t("auth.voltarParaEntrar")}
            </a>
          </p>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      titulo={t("auth.esqueceuTitulo")}
      descricao={t("auth.esqueceuTexto")}
    >
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          {erro && <AuthErro>{erro}</AuthErro>}

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
            <Button type="submit" disabled={enviando}>
              {enviando ? t("auth.enviando") : t("auth.enviarOLink")}
            </Button>
          </Field>

          <p className="text-center text-[13.5px] text-muted-foreground">
            {t("auth.lembrouASenha")}{" "}
            <a href="/login" className="font-medium text-primary hover:underline">
              {t("auth.entrar")}
            </a>
          </p>
        </FieldGroup>
      </form>
    </AuthShell>
  )
}
