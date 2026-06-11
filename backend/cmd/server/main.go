package main

import (
	"flag"
	"fmt"
	"log"

	"github.com/cone387/aiinbox/backend/internal/server"
)

func main() {
	configPath := flag.String("config", "", "path to config file")
	flag.Parse()

	srv, err := server.New(*configPath)
	if err != nil {
		log.Fatalf("Failed to initialize server: %v", err)
	}

	addr := srv.Addr()
	fmt.Printf("AI Inbox server starting on %s (database: %s)\n", addr, srv.Cfg.Database.Driver)
	if err := srv.Start(); err != nil {
		log.Fatalf("Failed to start server: %v", err)
	}
}
