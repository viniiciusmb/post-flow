package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
)

// Gera um icone bem simples (circulo colorido) na hora, sem precisar de
// nenhum arquivo de imagem externo no repositorio. Verde = conectado,
// cinza = desconectado/pausado.
func generatePNGIcon(c color.RGBA) []byte {
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

// Embrulha um PNG dentro de um .ico minimo (o formato ICO aceita PNG bruto
// dentro dele desde o Windows Vista, sem precisar de um codificador
// BMP/DIB completo). So o Windows precisa disso - testado ao vivo: sem
// isso, o systray no Windows nao mostra erro nenhum, mas o icone
// simplesmente nao aparece na bandeja (o menu ainda funciona clicando no
// lugar certo, mas ninguem acha o lugar certo sem o icone visivel).
func wrapPNGAsICO(png []byte) []byte {
	const size = 32
	var buf bytes.Buffer
	_ = binary.Write(&buf, binary.LittleEndian, uint16(0)) // reservado
	_ = binary.Write(&buf, binary.LittleEndian, uint16(1)) // tipo = icone
	_ = binary.Write(&buf, binary.LittleEndian, uint16(1)) // 1 imagem
	buf.WriteByte(size)                                     // largura
	buf.WriteByte(size)                                     // altura
	buf.WriteByte(0)                                        // paleta de cores (0 = nao indexado)
	buf.WriteByte(0)                                        // reservado
	_ = binary.Write(&buf, binary.LittleEndian, uint16(1))  // planos de cor
	_ = binary.Write(&buf, binary.LittleEndian, uint16(32)) // bits por pixel
	_ = binary.Write(&buf, binary.LittleEndian, uint32(len(png))) // tamanho da imagem
	_ = binary.Write(&buf, binary.LittleEndian, uint32(22))       // offset (6 + 16 = 22)
	buf.Write(png)
	return buf.Bytes()
}

var (
	iconConnected    = platformIcon(generatePNGIcon(color.RGBA{34, 197, 94, 255}))   // verde
	iconDisconnected = platformIcon(generatePNGIcon(color.RGBA{148, 163, 184, 255})) // cinza
	iconPaused       = platformIcon(generatePNGIcon(color.RGBA{234, 179, 8, 255}))   // amarelo
)
