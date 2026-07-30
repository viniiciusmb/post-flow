package main

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
)

// Gera um icone bem simples (circulo colorido) na hora, sem precisar de
// nenhum arquivo de imagem externo no repositorio. Verde = conectado,
// cinza = desconectado/pausado.
func generateIcon(c color.RGBA) []byte {
	const size = 32
	img := image.NewRGBA(image.Rect(0, 0, size, size))
	center := float64(size) / 2
	radius := center - 2

	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			dx := float64(x) + 0.5 - center
			dy := float64(y) + 0.5 - center
			if dx*dx+dy*dy <= radius*radius {
				img.Set(x, y, c)
			} else {
				img.Set(x, y, color.RGBA{0, 0, 0, 0})
			}
		}
	}

	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	return buf.Bytes()
}

var (
	iconConnected    = generateIcon(color.RGBA{34, 197, 94, 255})  // verde
	iconDisconnected = generateIcon(color.RGBA{148, 163, 184, 255}) // cinza
	iconPaused       = generateIcon(color.RGBA{234, 179, 8, 255})  // amarelo
)
