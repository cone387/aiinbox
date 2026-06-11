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
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"time"
	"unsafe"

	"github.com/cone387/aiinbox/backend/internal/server"
	"github.com/getlantern/systray"
)

//go:embed assets/icon.ico
var iconData []byte

func init() {
	// Write logs to a file next to the executable for diagnostics.
	exe, err := os.Executable()
	if err != nil {
		return
	}
	logPath := filepath.Join(filepath.Dir(exe), "aiinbox-desktop.log")
	f, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644)
	if err != nil {
		return
	}
	log.SetOutput(f)
}

func main() {
	configPath := flag.String("config", "", "path to config file")
	flag.Parse()

	srv, err := server.New(*configPath)
	if err != nil {
		log.Printf("Failed to initialize server: %v", err)
		fatalMsg("初始化失败", fmt.Sprintf("无法初始化服务器:\n%v", err))
		os.Exit(1)
	}

	// Try to start the listener synchronously so we can detect port conflicts
	// before systray takes over the main thread.
	if err := srv.Listen(); err != nil {
		log.Printf("Failed to listen on %s: %v", srv.Addr(), err)
		fatalMsg("启动失败", fmt.Sprintf("无法监听端口 %s:\n%v\n\n可能有其他程序正在使用该端口，请关闭后重试。", srv.Addr(), err))
		os.Exit(1)
	}

	// Serve HTTP in the background.
	go func() {
		if err := srv.Serve(); err != nil && err != http.ErrServerClosed {
			log.Printf("Server error: %v", err)
		}
	}()

	log.Printf("AI Inbox running on %s", srv.Addr())

	// Run systray (blocks until quit).
	systray.Run(func() { onReady(srv) }, func() { onExit(srv) })
}

// fatalMsg shows a Windows MessageBox (or just logs on other platforms).
func fatalMsg(title, msg string) {
	log.Printf("%s: %s", title, msg)
	if runtime.GOOS == "windows" {
		user32 := syscall.NewLazyDLL("user32.dll")
		msgBox := user32.NewProc("MessageBoxW")
		titlePtr, _ := syscall.UTF16PtrFromString(title)
		msgPtr, _ := syscall.UTF16PtrFromString(msg)
		// MB_ICONERROR = 0x10
		msgBox.Call(0, uintptr(unsafe.Pointer(msgPtr)), uintptr(unsafe.Pointer(titlePtr)), 0x10)
	}
}

// onReady is called once the systray is initialised.
func onReady(srv *server.Server) {
	systray.SetIcon(iconData)
	systray.SetTitle("AI Inbox")
	systray.SetTooltip(fmt.Sprintf("AI Inbox — running on %s", srv.Addr()))

	// Left-click opens browser, right-click shows menu.
	systray.SetOnLeftClick(func() {
		openBrowser(fmt.Sprintf("http://%s", srv.Addr()))
	})

	// Menu items (right-click)
	mTitle := systray.AddMenuItem("AI Inbox", "")
	mTitle.Disable()
	systray.AddSeparator()
	mBrowser := systray.AddMenuItem("打开浏览器", "Open AI Inbox in browser")
	mResetPwd := systray.AddMenuItem("重置密码", "Reset password (localhost only)")
	mDataDir := systray.AddMenuItem("打开数据目录", "Open data folder")
	systray.AddSeparator()
	mQuit := systray.AddMenuItem("退出", "Quit AI Inbox")

	// Auto-open browser once the server is ready.
	go func() {
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
			case <-mResetPwd.ClickedCh:
				openBrowser(fmt.Sprintf("http://%s/reset-password", srv.Addr()))
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
