//go:build !windows

package main

import "log"

func fatalMsg(title, msg string) {
	log.Printf("[FATAL] %s: %s", title, msg)
}

func infoMsg(title, msg string) {
	log.Printf("[INFO] %s: %s", title, msg)
}

func confirmMsg(title, msg string) bool {
	log.Printf("[CONFIRM] %s: %s", title, msg)
	return false
}
