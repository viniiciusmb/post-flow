import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { AuthShell, AuthErro } from "@/pages/AuthShell"
import { api, ApiError } from "@/lib/api"

export function ForgotPasswordPage() {
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
      setErro(err instanceof ApiError ? err.message : "Não foi possível enviar o e-mail agora.")
    } finally {
      setEnviando(false)
    }
  }

  if (mensagem) {
    return (
      <AuthShell titulo="Verifique seu e-mail" descricao={mensagem}>
        <div className="space-y-4">
          <p className="text-[14.5px] leading-relaxed text-muted-foreground">
            O link vale por 30 minutos e só pode ser usado uma vez.
          </p>
          <Button variant="outline" className="w-full" onClick={() => setMensagem(null)}>
            Usar outro e-mail
          </Button>
          <p className="text-center text-[13.5px] text-muted-foreground">
            <a href="/login" className="font-medium text-primary hover:underline">
              Voltar para entrar
            </a>
          </p>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      titulo="Esqueceu a senha?"
      descricao="Escreva o e-mail da sua conta. Enviamos um link para você criar uma senha nova."
    >
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          {erro && <AuthErro>{erro}</AuthErro>}

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
            <Button type="submit" disabled={enviando}>
              {enviando ? "Enviando..." : "Enviar o link"}
            </Button>
          </Field>

          <p className="text-center text-[13.5px] text-muted-foreground">
            Lembrou a senha?{" "}
            <a href="/login" className="font-medium text-primary hover:underline">
              Entrar
            </a>
          </p>
        </FieldGroup>
      </form>
    </AuthShell>
  )
}
