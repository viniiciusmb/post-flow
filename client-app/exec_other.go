//go:build !windows

package main

import "os/exec"

// No Mac/Linux nao existe esse problema (o processo filho nao abre janela
// nenhuma) - fica vazio so pra existir a mesma funcao nos dois sistemas.
func hideWindow(cmd *exec.Cmd) {}

// No Mac o systray aceita PNG puro sem problema.
func platformIcon(png []byte) []byte {
	return png
}
