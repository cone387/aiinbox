package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"os"
)

// ICO file format: ICONDIR + ICONDIRENTRY + PNG data
func main() {
	// Create a 32x32 icon
	img := image.NewRGBA(image.Rect(0, 0, 32, 32))
	blue := color.RGBA{R: 66, G: 133, B: 244, A: 255}
	white := color.RGBA{R: 255, G: 255, B: 255, A: 255}

	for y := 0; y < 32; y++ {
		for x := 0; x < 32; x++ {
			img.Set(x, y, blue)
		}
	}

	// Draw "AI" letters
	// Letter A - left stroke
	for i := 6; i < 24; i++ {
		img.Set(8, i, white)
		img.Set(9, i, white)
	}
	// Letter A - right stroke
	for i := 6; i < 24; i++ {
		img.Set(12, i, white)
		img.Set(13, i, white)
	}
	// Letter A - crossbar
	for x := 8; x <= 13; x++ {
		img.Set(x, 14, white)
		img.Set(x, 15, white)
	}

	// Letter I - vertical
	for i := 6; i < 24; i++ {
		img.Set(19, i, white)
		img.Set(20, i, white)
		img.Set(21, i, white)
	}
	// Letter I - top bar
	for x := 17; x <= 23; x++ {
		img.Set(x, 6, white)
		img.Set(x, 7, white)
	}
	// Letter I - bottom bar
	for x := 17; x <= 23; x++ {
		img.Set(x, 22, white)
		img.Set(x, 23, white)
	}

	// Encode PNG
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, img); err != nil {
		panic(err)
	}
	pngData := pngBuf.Bytes()

	// Build ICO file
	var buf bytes.Buffer

	// ICONDIR (6 bytes)
	binary.Write(&buf, binary.LittleEndian, uint16(0))     // Reserved
	binary.Write(&buf, binary.LittleEndian, uint16(1))     // Type: ICO
	binary.Write(&buf, binary.LittleEndian, uint16(1))     // Count: 1 image

	// ICONDIRENTRY (16 bytes)
	buf.WriteByte(32)                            // Width: 32
	buf.WriteByte(32)                            // Height: 32
	buf.WriteByte(0)                             // Color palette: 0
	buf.WriteByte(0)                             // Reserved
	binary.Write(&buf, binary.LittleEndian, uint16(1))   // Color planes
	binary.Write(&buf, binary.LittleEndian, uint16(32))  // Bits per pixel
	binary.Write(&buf, binary.LittleEndian, uint32(len(pngData)))  // Image size
	binary.Write(&buf, binary.LittleEndian, uint32(22))  // Offset (6 + 16 = 22)

	// PNG data
	buf.Write(pngData)

	f, err := os.Create(os.Args[1])
	if err != nil {
		panic(err)
	}
	defer f.Close()

	if _, err := f.Write(buf.Bytes()); err != nil {
		panic(err)
	}
}
