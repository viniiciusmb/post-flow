// Programa de bandeja do Post Flow - abre um tunel SSH reverso (ssh -R) da
// maquina do cliente ate a VPS, pra que os downloads DAQUELE cliente saiam
// pela internet dele em vez da VPS. So supervisiona o processo `ssh` do
// sistema (ou um binario portatil empacotado, no Windows) - nao reimplementa
// nada de SSH/SOCKS na mao.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"time"

	"github.com/getlantern/systray"
)

// Dominio novo. Os programas JA INSTALADOS continuam apontando pro antigo, e
// isso e de proposito: o dominio antigo segue servindo o sistema normalmente,
// entao nenhum cliente precisa reinstalar nada. Quem baixar daqui pra frente ja
// vem no dominio novo.
//
// Se um dia o dominio antigo for desligado, TODO cliente com o programa
// instalado precisa baixar de novo - por isso ele nao pode ser desligado sem
// aviso.
const defaultAPIBase = "https://postflowclips.com"

type pairingInfo struct {
	PairingCode  string `json:"pairingCode"`
	SSHHost      string `json:"sshHost"`
	SSHPort      int    `json:"sshPort"`
	AssignedPort int    `json:"assignedPort"`
	SSHUser      string `json:"sshUser"`
}

func apiBase() string {
	if v := os.Getenv("POSTFLOW_API_BASE"); v != "" {
		return v
	}
	return defaultAPIBase
}

func configDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		home = "."
	}
	dir := filepath.Join(home, ".postflow-tunnel")
	_ = os.MkdirAll(dir, 0o700)
	return dir
}

// No Windows nao da pra confiar que o OpenSSH do sistema esta instalado -
// procura primeiro um binario portatil empacotado ao lado do executavel
// (pasta ssh-bin/), so cai pro PATH do sistema se nao achar (caso do Mac,
// que sempre tem /usr/bin/ssh).
func resolveBinary(name string) string {
	exe, err := os.Executable()
	if err == nil {
		candidate := filepath.Join(filepath.Dir(exe), "ssh-bin", name)
		if runtime.GOOS == "windows" {
			candidate += ".exe"
		}
		if _, statErr := os.Stat(candidate); statErr == nil {
			return candidate
		}
	}
	return name // cai pro PATH
}

func ensureKeypair() (privateKeyPath string, publicKey string, err error) {
	dir := configDir()
	privateKeyPath = filepath.Join(dir, "id_ed25519")
	publicKeyPath := privateKeyPath + ".pub"

	if _, statErr := os.Stat(privateKeyPath); statErr != nil {
		hostname, _ := os.Hostname()
		keygenBin := resolveBinary("ssh-keygen")
		cmd := exec.Command(keygenBin, "-t", "ed25519", "-f", privateKeyPath, "-N", "", "-C", "postflow-tunnel-"+hostname)
		hideWindow(cmd)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		if runErr := cmd.Run(); runErr != nil {
			return "", "", fmt.Errorf("falha ao gerar chave: %v (%s)", runErr, stderr.String())
		}
	}

	pubBytes, readErr := os.ReadFile(publicKeyPath)
	if readErr != nil {
		return "", "", fmt.Errorf("falha ao ler chave publica: %v", readErr)
	}
	return privateKeyPath, string(bytes.TrimSpace(pubBytes)), nil
}

func registerPending(publicKey string) (*pairingInfo, error) {
	hostname, _ := os.Hostname()
	body, _ := json.Marshal(map[string]string{"publicKey": publicKey, "label": hostname})

	resp, err := http.Post(apiBase()+"/api/tunnel/register-pending", "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("servidor respondeu %d: %s", resp.StatusCode, string(respBody))
	}

	var info pairingInfo
	if err := json.Unmarshal(respBody, &info); err != nil {
		return nil, err
	}
	return &info, nil
}


type connectionState int

const (
	stateDisconnected connectionState = iota
	stateConnecting
	stateConnected
	statePaused
)

func runSupervisor(privateKeyPath string, info *pairingInfo, pausedCh <-chan bool, stateCh chan<- connectionState) {
	sshBin := resolveBinary("ssh")
	knownHosts := filepath.Join(configDir(), "known_hosts")
	paused := false

	for {
		select {
		case p := <-pausedCh:
			paused = p
		default:
		}

		if paused {
			stateCh <- statePaused
			time.Sleep(1 * time.Second)
			continue
		}

		stateCh <- stateConnecting

		args := []string{
			"-N",
			"-R", fmt.Sprintf("%d", info.AssignedPort),
			"-o", "ServerAliveInterval=15",
			"-o", "ServerAliveCountMax=3",
			"-o", "ExitOnForwardFailure=yes",
			"-o", "StrictHostKeyChecking=accept-new",
			"-o", "UserKnownHostsFile=" + knownHosts,
			"-i", privateKeyPath,
			"-p", fmt.Sprintf("%d", info.SSHPort),
			fmt.Sprintf("%s@%s", info.SSHUser, info.SSHHost),
		}
		cmd := exec.Command(sshBin, args...)
		hideWindow(cmd)

		start := time.Now()
		err := cmd.Start()
		if err == nil {
			// Se ficar vivo mais de 5s, considera conectado de verdade (uma
			// falha de autorizacao/rede costuma derrubar o ssh quase na hora).
			go func() {
				time.Sleep(5 * time.Second)
				if cmd.ProcessState == nil {
					stateCh <- stateConnected
				}
			}()
			_ = cmd.Wait()
		}

		stateCh <- stateDisconnected

		if time.Since(start) < 5*time.Second {
			time.Sleep(10 * time.Second) // evita martelar em loop se algo estiver errado
		} else {
			time.Sleep(2 * time.Second)
		}
	}
}

func onReady() {
	systray.SetIcon(iconDisconnected)
	systray.SetTitle("Post Flow")
	systray.SetTooltip("Post Flow - Tunel")

	mStatus := systray.AddMenuItem("Status: iniciando...", "")
	mStatus.Disable()
	mCode := systray.AddMenuItem("", "")
	mCode.Hide()
	systray.AddSeparator()
	mPause := systray.AddMenuItem("Pausar conexão", "")
	systray.AddSeparator()
	mAutostart := systray.AddMenuItemCheckbox("Iniciar com o sistema", "", isAutostartEnabled())
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("Sair", "Fecha o programa")

	privateKeyPath, publicKey, err := ensureKeypair()
	if err != nil {
		mStatus.SetTitle("Erro ao gerar chave: " + err.Error())
		return
	}

	// Sempre busca um codigo NOVO ao abrir, nunca reaproveita um salvo em
	// disco - o codigo expira em 15min do lado do servidor, e um cache sem
	// data de validade fazia o programa mostrar/tentar um codigo ja
	// expirado depois de reabrir o app mais tarde (bug real visto por um
	// cliente testando: "codigo invalido ou expirado" mesmo colando
	// certinho, porque o app tinha guardado um codigo de um teste anterior
	// e nunca buscava um novo).
	info, err := registerPending(publicKey)
	if err != nil {
		mStatus.SetTitle("Erro ao conectar com o Post Flow")
		return
	}

	if info.PairingCode != "" {
		mCode.SetTitle("Código: " + info.PairingCode)
		mCode.Show()
	}

	pausedCh := make(chan bool, 1)
	stateCh := make(chan connectionState, 8)
	paused := false

	go runSupervisor(privateKeyPath, info, pausedCh, stateCh)

	go func() {
		for state := range stateCh {
			switch state {
			case stateConnecting:
				mStatus.SetTitle("Status: conectando...")
				systray.SetIcon(iconDisconnected)
			case stateConnected:
				mStatus.SetTitle("Status: Conectado")
				systray.SetIcon(iconConnected)
			case stateDisconnected:
				mStatus.SetTitle("Status: Desconectado")
				systray.SetIcon(iconDisconnected)
			case statePaused:
				mStatus.SetTitle("Status: Pausado")
				systray.SetIcon(iconPaused)
			}
		}
	}()

	go func() {
		for {
			select {
			case <-mPause.ClickedCh:
				paused = !paused
				pausedCh <- paused
				if paused {
					mPause.SetTitle("Retomar conexão")
				} else {
					mPause.SetTitle("Pausar conexão")
				}
			case <-mAutostart.ClickedCh:
				next := !mAutostart.Checked()
				if err := setAutostart(next); err == nil {
					if next {
						mAutostart.Check()
					} else {
						mAutostart.Uncheck()
					}
				}
			case <-mQuit.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}

func onExit() {}

func main() {
	systray.Run(onReady, onExit)
}
