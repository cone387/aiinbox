//go:build ignore

// mkico bundles multiple PNG files into a single ICO file.
// Usage: go run mkico.go output.ico input16.png input32.png input48.png input64.png input128.png input256.png
package main

import (
	"bytes"
	"encoding/binary"
	"fmt"
	"image/png"
	"os"
	"sort"
)

func main() {
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "Usage: go run mkico.go output.ico input1.png [input2.png ...]")
		os.Exit(1)
	}

	outPath := os.Args[1]
	inputs := os.Args[2:]

	type imgEntry struct {
		size int
		data []byte
		w, h int
	}

	var entries []imgEntry
	for _, path := range inputs {
		data, err := os.ReadFile(path)
		if err != nil {
			fmt.Fprintf(os.Stderr, "read %s: %v\n", path, err)
			os.Exit(1)
		}
		// Decode to get dimensions
		r, err := png.Decode(bytes.NewReader(data))
		if err != nil {
			fmt.Fprintf(os.Stderr, "decode %s: %v\n", path, err)
			os.Exit(1)
		}
		b := r.Bounds()
		w, h := b.Dx(), b.Dy()
		entries = append(entries, imgEntry{size: w, data: data, w: w, h: h})
	}

	// Sort by size ascending
	sort.Slice(entries, func(i, j int) bool { return entries[i].size < entries[j].size })

	// Calculate offsets
	headerSize := 6 + 16*len(entries) // ICONDIR + ICONDIRENTRY[]
	offset := headerSize

	// Build ICO
	var buf bytes.Buffer
	// ICONDIR
	binary.Write(&buf, binary.LittleEndian, uint16(0))            // Reserved
	binary.Write(&buf, binary.LittleEndian, uint16(1))            // Type: ICO
	binary.Write(&buf, binary.LittleEndian, uint16(len(entries))) // Count

	// Write directory entries
	for _, e := range entries {
		wByte := byte(e.w)
		hByte := byte(e.h)
		if e.w >= 256 {
			wByte = 0 // 0 means 256
		}
		if e.h >= 256 {
			hByte = 0
		}
		buf.WriteByte(wByte)                               // Width
		buf.WriteByte(hByte)                               // Height
		buf.WriteByte(0)                                   // Color palette
		buf.WriteByte(0)                                   // Reserved
		binary.Write(&buf, binary.LittleEndian, uint16(1)) // Color planes
		binary.Write(&buf, binary.LittleEndian, uint16(32)) // Bits per pixel
		binary.Write(&buf, binary.LittleEndian, uint32(len(e.data))) // Image data size
		binary.Write(&buf, binary.LittleEndian, uint32(offset))      // Offset
		offset += len(e.data)
	}

	// Write image data
	for _, e := range entries {
		buf.Write(e.data)
	}

	if err := os.WriteFile(outPath, buf.Bytes(), 0644); err != nil {
		fmt.Fprintf(os.Stderr, "write %s: %v\n", outPath, err)
		os.Exit(1)
	}
	fmt.Printf("Created %s (%d images, %d bytes)\n", outPath, len(entries), buf.Len())
}
