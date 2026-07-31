//go:build !windows

package main

import "os/exec"

// No Mac/Linux nao existe esse problema (o processo filho nao abre janela
// nenhuma) - fica vazio so pra existir a mesma funcao nos dois sistemas.
func hideWindow(cmd *exec.Cmd) {}
