//go:build windows

package main

import (
	"log"
	"runtime"
	"syscall"
	"unsafe"
)

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

// infoMsg shows an informational MessageBox (MB_ICONINFORMATION).
func infoMsg(title, msg string) {
	log.Printf("[INFO] %s: %s", title, msg)
	if runtime.GOOS == "windows" {
		user32 := syscall.NewLazyDLL("user32.dll")
		msgBox := user32.NewProc("MessageBoxW")
		titlePtr, _ := syscall.UTF16PtrFromString(title)
		msgPtr, _ := syscall.UTF16PtrFromString(msg)
		// MB_ICONINFORMATION = 0x40
		msgBox.Call(0, uintptr(unsafe.Pointer(msgPtr)), uintptr(unsafe.Pointer(titlePtr)), 0x40)
	}
}

// confirmMsg shows a Yes/No MessageBox. Returns true if user clicked Yes.
func confirmMsg(title, msg string) bool {
	log.Printf("[CONFIRM] %s: %s", title, msg)
	if runtime.GOOS == "windows" {
		user32 := syscall.NewLazyDLL("user32.dll")
		msgBox := user32.NewProc("MessageBoxW")
		titlePtr, _ := syscall.UTF16PtrFromString(title)
		msgPtr, _ := syscall.UTF16PtrFromString(msg)
		// MB_YESNO | MB_ICONQUESTION = 0x4 | 0x20 = 0x24
		ret, _, _ := msgBox.Call(0, uintptr(unsafe.Pointer(msgPtr)), uintptr(unsafe.Pointer(titlePtr)), 0x24)
		return ret == 6 // IDYES = 6
	}
	return false
}
