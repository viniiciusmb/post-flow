//go:build windows

package main

import (
	"os/exec"
	"syscall"
)

// Evita que o Windows abra uma janela de terminal visivel toda vez que o
// programa chama `ssh`/`ssh-keygen` por baixo dos panos - sem isso, cada
// tentativa de conexao (que se repete a cada ~10s ate o cliente parear) faz
// um terminal preto pipocar na tela e sumir sozinho, parecendo um bug grave.
func hideWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{
		HideWindow:    true,
		CreationFlags: 0x08000000, // CREATE_NO_WINDOW
	}
}
