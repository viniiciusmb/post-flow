import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { AuthShell, AuthErro } from "@/pages/AuthShell"
import { api, ApiError } from "@/lib/api"

const SENHA_MINIMA = 8

export function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get("token") || ""

  // "checando" evita mostrar o formulário por um instante antes de descobrir
  // que o link já venceu.
  const [estado, setEstado] = useState<"checando" | "valido" | "expirado" | "pronto" | "muitas">(
    "checando"
  )
  const [senha, setSenha] = useState("")
  const [repetir, setRepetir] = useState("")
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!token) {
      setEstado("expirado")
      return
    }
    api
      .get<{ valid: boolean }>(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((r) => setEstado(r.valid ? "valido" : "expirado"))
      // 429 é limite de tentativas, não link vencido. Mandar a pessoa "pedir um
      // link novo" nesse caso só faria ela gastar mais tentativas e afundar.
      .catch((err) =>
        setEstado(err instanceof ApiError && err.status === 429 ? "muitas" : "expirado")
      )
  }, [token])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErro(null)

    if (senha.length < SENHA_MINIMA) {
      setErro(`A nova senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`)
      return
    }
    if (senha !== repetir) {
      setErro("As duas senhas não são iguais.")
      return
    }

    setSalvando(true)
    try {
      await api.post("/api/auth/reset-password", { token, password: senha })
      setEstado("pronto")
    } catch (err) {
      // O servidor manda expired: true quando o link venceu ou já foi usado -
      // aí não adianta deixar a pessoa tentando de novo no mesmo formulário.
      if (err instanceof ApiError && err.status === 429) {
        setEstado("muitas")
      } else if (err instanceof ApiError && (err.data as { expired?: boolean }).expired) {
        setEstado("expirado")
      } else {
        setErro(err instanceof ApiError ? err.message : "Não foi possível salvar a senha nova.")
      }
      setSalvando(false)
    }
  }

  if (estado === "checando") {
    return (
      <AuthShell titulo="Um instante" descricao="Conferindo o link...">
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/40" />
        </div>
      </AuthShell>
    )
  }

  if (estado === "muitas") {
    return (
      <AuthShell
        titulo="Muitas tentativas"
        descricao="Tivemos tentativas demais vindas daqui nos últimos minutos. Espere alguns minutos e abra o link de novo - ele continua valendo."
      >
        <Button variant="outline" className="w-full" onClick={() => window.location.reload()}>
          Tentar de novo
        </Button>
      </AuthShell>
    )
  }

  if (estado === "expirado") {
    return (
      <AuthShell
        titulo="Link expirado"
        descricao="Esse link já foi usado ou passou dos 30 minutos de validade. Peça um novo, leva um segundo."
      >
        <div className="space-y-4">
          <Button className="w-full" onClick={() => (window.location.href = "/esqueci-senha")}>
            Pedir um link novo
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

  if (estado === "pronto") {
    return (
      <AuthShell
        titulo="Senha alterada"
        descricao="Sua senha nova já está valendo. Por segurança, as outras sessões abertas foram encerradas."
      >
        <Button className="w-full" onClick={() => (window.location.href = "/login")}>
          Entrar agora
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      titulo="Criar uma nova senha"
      descricao="Escolha uma senha que você ainda não usa em outro lugar."
    >
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          {erro && <AuthErro>{erro}</AuthErro>}

          <Field>
            <FieldLabel htmlFor="senha">Nova senha</FieldLabel>
            <Input
              id="senha"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              autoFocus
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
            />
            <p className="text-[12.5px] text-muted-foreground">Pelo menos {SENHA_MINIMA} caracteres.</p>
          </Field>

          <Field>
            <FieldLabel htmlFor="repetir">Repita a nova senha</FieldLabel>
            <Input
              id="repetir"
              type="password"
              placeholder="••••••••"
              autoComplete="new-password"
              required
              value={repetir}
              onChange={(e) => setRepetir(e.target.value)}
            />
          </Field>

          <Field>
            <Button type="submit" disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar a nova senha"}
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </AuthShell>
  )
}
