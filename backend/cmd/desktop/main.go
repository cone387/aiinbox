// Command desktop launches AI Inbox as a system-tray application.
// It starts the HTTP server in the background, shows a tray icon, and
// automatically opens the browser. The user can interact via the tray
// menu: open the browser, open the data directory, or quit.
package main

import (
	"context"
	_ "embed"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"runtime"
	"time"

	"github.com/cone387/aiinbox/backend/internal/server"
	"github.com/getlantern/systray"
)

//go:embed assets/icon.ico
var iconData []byte

func main() {
	configPath := flag.String("config", "", "path to config file")
	flag.Parse()

	srv, err := server.New(*configPath)
	if err != nil {
		log.Fatalf("Failed to initialize server: %v", err)
	}

	// Start the HTTP server in the background.
	go func() {
		if err := srv.Start(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("Server error: %v", err)
		}
	}()

	log.Printf("AI Inbox running on %s", srv.Addr())

	// Run systray (blocks until quit).
	systray.Run(func() { onReady(srv) }, func() { onExit(srv) })
}

// onReady is called once the systray is initialised.
func onReady(srv *server.Server) {
	systray.SetIcon(iconData)
	systray.SetTitle("AI Inbox")
	systray.SetTooltip(fmt.Sprintf("AI Inbox — running on %s", srv.Addr()))

	// Menu items
	mTitle := systray.AddMenuItem("AI Inbox", "")
	mTitle.Disable()
	systray.AddSeparator()
	mBrowser := systray.AddMenuItem("打开浏览器", "Open AI Inbox in browser")
	mDataDir := systray.AddMenuItem("打开数据目录", "Open data folder")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("退出", "Quit AI Inbox")

	// Auto-open browser once the server is ready.
	go func() {
		// Wait a bit for the server to be ready.
		time.Sleep(300 * time.Millisecond)
		url := fmt.Sprintf("http://%s", srv.Addr())
		openBrowser(url)
	}()

	// Event loop
	go func() {
		for {
			select {
			case <-mBrowser.ClickedCh:
				openBrowser(fmt.Sprintf("http://%s", srv.Addr()))
			case <-mDataDir.ClickedCh:
				openDir(srv.DataDir())
			case <-mQuit.ClickedCh:
				systray.Quit()
				return
			}
		}
	}()
}

func onExit(srv *server.Server) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Shutdown error: %v", err)
	}
}

// openBrowser opens the given URL in the user's default browser.
func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("Failed to open browser: %v", err)
	}
}

// openDir opens a directory in the file manager.
func openDir(path string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("explorer", path)
	case "darwin":
		cmd = exec.Command("open", path)
	default:
		cmd = exec.Command("xdg-open", path)
	}
	if err := cmd.Start(); err != nil {
		log.Printf("Failed to open directory: %v", err)
	}
}
