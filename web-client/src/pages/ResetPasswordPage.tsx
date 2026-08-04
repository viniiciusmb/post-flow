import { useEffect, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { AuthShell, AuthErro } from "@/pages/AuthShell"
import { api, ApiError } from "@/lib/api"
import { useT } from "@/i18n"

const SENHA_MINIMA = 8

export function ResetPasswordPage() {
  const t = useT()
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
      setErro(t("auth.senhasDiferentes"))
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
        setErro(err instanceof ApiError ? err.message : t("auth.naoFoiPossivelSalvarSenha"))
      }
      setSalvando(false)
    }
  }

  if (estado === "checando") {
    return (
      <AuthShell titulo={t("auth.umInstante")} descricao={t("auth.conferindoLink")}>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/40" />
        </div>
      </AuthShell>
    )
  }

  if (estado === "muitas") {
    return (
      <AuthShell
        titulo={t("auth.muitasTentativas")}
        descricao={t("auth.muitasTentativasTexto")}
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
        titulo={t("auth.linkExpirado")}
        descricao={t("auth.linkExpiradoTexto")}
      >
        <div className="space-y-4">
          <Button className="w-full" onClick={() => (window.location.href = "/esqueci-senha")}>
            {t("auth.pedirNovoLink")}
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

  if (estado === "pronto") {
    return (
      <AuthShell
        titulo={t("auth.senhaAlterada")}
        descricao={t("auth.senhaAlteradaTexto")}
      >
        <Button className="w-full" onClick={() => (window.location.href = "/login")}>
          {t("auth.entrar")}
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      titulo={t("auth.criarNovaSenha")}
      descricao={t("auth.criarNovaSenhaTexto")}
    >
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          {erro && <AuthErro>{erro}</AuthErro>}

          <Field>
            <FieldLabel htmlFor="senha">{t("auth.novaSenha")}</FieldLabel>
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
            <p className="text-[12.5px] text-muted-foreground">{t("auth.peloMenosCaracteres", { n: SENHA_MINIMA })}</p>
          </Field>

          <Field>
            <FieldLabel htmlFor="repetir">{t("auth.repitaNovaSenha")}</FieldLabel>
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
              {salvando ? t("comum.salvando") : t("auth.salvarNovaSenha")}
            </Button>
          </Field>
        </FieldGroup>
      </form>
    </AuthShell>
  )
}
