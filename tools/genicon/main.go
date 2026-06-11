package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"math"
	"os"
)

func main() {
	const size = 32
	img := image.NewRGBA(image.Rect(0, 0, size, size))

	// Transparent background
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			img.Set(x, y, color.RGBA{0, 0, 0, 0})
		}
	}

	// Rounded square background with gradient (indigo to teal)
	for y := 2; y < 30; y++ {
		for x := 2; x < 30; x++ {
			t := float64(y-2) / 28.0
			r := uint8(lerp(79, 20, t))
			g := uint8(lerp(70, 184, t))
			b := uint8(lerp(228, 166, t))
			img.Set(x, y, color.RGBA{r, g, b, 255})
		}
	}

	// Apply rounded corners mask
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			if !inRoundedRect(x, y, size, size, 6) {
				img.Set(x, y, color.RGBA{0, 0, 0, 0})
			}
		}
	}

	white := color.RGBA{255, 255, 255, 255}
	whiteSemi := color.RGBA{255, 255, 255, 180}

	// === Envelope body (bottom half) ===
	// Left wall
	for y := 13; y < 23; y++ {
		img.Set(6, y, white)
		img.Set(7, y, white)
	}
	// Right wall
	for y := 13; y < 23; y++ {
		img.Set(24, y, white)
		img.Set(25, y, white)
	}
	// Bottom wall
	for x := 6; x <= 25; x++ {
		img.Set(x, 22, white)
		img.Set(x, 23, white)
	}

	// === Envelope flap (V-shape opening at top) ===
	// Diagonal lines from corners to center
	for i := 0; i < 10; i++ {
		// Left diagonal
		img.Set(6+i, 12+i/2, white)
		if i > 0 {
			img.Set(6+i, 11+i/2, white)
		}
		// Right diagonal
		img.Set(25-i, 12+i/2, white)
		if i > 0 {
			img.Set(25-i, 11+i/2, white)
		}
	}

	// === AI sparkle/star inside envelope ===
	cx, cy := 16, 18
	// Center dot
	img.Set(cx, cy, white)
	img.Set(cx-1, cy, white)
	img.Set(cx+1, cy, white)
	img.Set(cx, cy-1, white)
	img.Set(cx, cy+1, white)
	// Sparkle arms
	img.Set(cx-2, cy, whiteSemi)
	img.Set(cx+2, cy, whiteSemi)
	img.Set(cx, cy-2, whiteSemi)
	img.Set(cx, cy+2, whiteSemi)
	// Diagonal sparkle
	img.Set(cx-1, cy-1, whiteSemi)
	img.Set(cx+1, cy-1, whiteSemi)
	img.Set(cx-1, cy+1, whiteSemi)
	img.Set(cx+1, cy+1, whiteSemi)

	// === Multi-platform colored dots (bottom strip) ===
	dots := []struct {
		x, y int
		c    color.RGBA
	}{
		{7, 26, color.RGBA{239, 68, 68, 255}},    // red (Tongyi)
		{11, 26, color.RGBA{34, 197, 94, 255}},   // green (Gemini)
		{15, 26, color.RGBA{251, 191, 36, 255}},  // amber (ChatGPT)
		{19, 26, color.RGBA{59, 130, 246, 255}},  // blue (DeepSeek)
		{23, 26, color.RGBA{168, 85, 247, 255}},  // purple (Doubao)
	}
	for _, d := range dots {
		for dy := 0; dy < 2; dy++ {
			for dx := 0; dx < 2; dx++ {
				img.Set(d.x+dx, d.y+dy, d.c)
			}
		}
	}

	// Encode PNG
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, img); err != nil {
		panic(err)
	}
	pngData := pngBuf.Bytes()

	// Build ICO file: ICONDIR(6) + ICONDIRENTRY(16) + PNG data
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint16(0))     // Reserved
	binary.Write(&buf, binary.LittleEndian, uint16(1))     // Type: ICO
	binary.Write(&buf, binary.LittleEndian, uint16(1))     // Count: 1 image
	buf.WriteByte(32)                                       // Width
	buf.WriteByte(32)                                       // Height
	buf.WriteByte(0)                                        // Color palette
	buf.WriteByte(0)                                        // Reserved
	binary.Write(&buf, binary.LittleEndian, uint16(1))     // Color planes
	binary.Write(&buf, binary.LittleEndian, uint16(32))    // Bits per pixel
	binary.Write(&buf, binary.LittleEndian, uint32(len(pngData))) // Image size
	binary.Write(&buf, binary.LittleEndian, uint32(22))    // Offset (6+16=22)
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

func lerp(a, b int, t float64) float64 {
	return float64(a) + float64(b-a)*t
}

func inRoundedRect(x, y, w, h, r int) bool {
	corners := [][2]int{{r, r}, {w - r - 1, r}, {r, h - r - 1}, {w - r - 1, h - r - 1}}
	for _, c := range corners {
		if (x < r && y < r && c == corners[0]) ||
			(x >= w-r && y < r && c == corners[1]) ||
			(x < r && y >= h-r && c == corners[2]) ||
			(x >= w-r && y >= h-r && c == corners[3]) {
			dx := float64(x - c[0])
			dy := float64(y - c[1])
			if dx*dx+dy*dy > float64(r*r) {
				return false
			}
		}
	}
	return x >= 2 && x < w-2 && y >= 2 && y < h-2
}

func dist(x1, y1, x2, y2 int) float64 {
	return math.Sqrt(float64((x1-x2)*(x1-x2) + (y1-y2)*(y1-y2)))
}
