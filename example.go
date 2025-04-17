package main

//go:generate go run gen/gogenerate-assets.go -baseDir static

import (
	"embed"
	"flag"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"fmt"

	"github.com/caasmo/restinpieces"

	//"github.com/caasmo/restinpieces/custom"

	// TODO
	"github.com/caasmo/restinpieces/core"
	r "github.com/caasmo/restinpieces/router"
)

var (
	dbfile = flag.String("db", "app.db", "Path to the database file")
	configFile = flag.String("config", "", "Path to configuration file")
)

//go:embed static/dist/*
var EmbeddedAssets embed.FS // move to embed.go

func main() {
	// Define flags directly in main
	dbPath := flag.String("db", "", "Path to the SQLite database file (required)")
	ageKeyPath := flag.String("age-key", "", "Path to the age identity (private key) file (required)")

	// Set custom usage message for the application
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: %s -db <database-path> -age-key <identity-file-path>\n\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "Start the restinpieces application server.\n\n")
		fmt.Fprintf(os.Stderr, "Flags:\n")
		flag.PrintDefaults()
	}

	// Parse flags
	flag.Parse()

	// Validate required flags
	if *dbPath == "" || *ageKeyPath == "" {
		flag.Usage()
		os.Exit(1)
	}

	dbPool, err := restinpieces.NewZombiezenPerformancePool(*dbfile)
	if err != nil {
		slog.Error("failed to create database pool", "error", err)
	    os.Exit(1)
	}

	defer func() {
		slog.Info("Closing database pool...")
		if err := dbPool.Close(); err != nil {
			slog.Error("Error closing database pool", "error", err)
		}
	}()

	app, srv, err := restinpieces.New(
		*configFile,
		//restinpieces.WithDbCrawshaw(dbPool), 
		restinpieces.WithDbZombiezen(dbPool), 
		restinpieces.WithRouterServeMux(),    
		restinpieces.WithCacheRistretto(),
		restinpieces.WithTextLogger(nil), 
	)
	if err != nil {
		slog.Error("failed to initialize application", "error", err)
		os.Exit(1)
	}

	// Serve static files from configured public directory
	cfg := app.Config()
	subFS, err := fs.Sub(EmbeddedAssets, cfg.PublicDir)
	if err != nil {
		// TODO
		panic("failed to create sub filesystem: " + err.Error())
	}

	ffs := http.FileServerFS(subFS)
	app.Router().Register(map[string]*r.Chain{
        "/": r.NewChain(ffs).WithMiddleware(
			core.StaticHeadersMiddleware,
			core.GzipMiddleware(subFS),
		),
    })

	// Start the server
	srv.Run() // srv is returned by restinpieces.New
}
