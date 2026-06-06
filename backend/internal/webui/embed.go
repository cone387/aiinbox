// Package webui embeds the built frontend (frontend/dist) into the server
// binary so a released executable is fully self-contained. In CI the real
// build is copied into the dist directory before `go build`; locally a
// placeholder index.html keeps the build working without a frontend present.
package webui

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var embedded embed.FS

// Dist returns the embedded frontend build rooted at the dist directory.
func Dist() (fs.FS, error) {
	return fs.Sub(embedded, "dist")
}
