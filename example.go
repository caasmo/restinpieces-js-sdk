package main

//go:generate go run gen/gogenerate-assets.go -baseDir static

import (
	"embed"
	"flag"
	"io/fs"
	"log/slog"
	"net/http"
	"os"

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
	flag.Parse()

	// Load initial configuration
	//cfg, err := config.Load(*dbfile)
	//if err != nil {
	//	slog.Error("failed to load initial config", "error", err)
	//	os.Exit(1)
	//}

	//dbPool, err := restinpieces.NewCrawshawPool(*dbfile)
	dbPool, err := restinpieces.NewZombiezenPool(*dbfile)
	if err != nil {
		slog.Error("failed to create database pool", "error", err)
	    os.Exit(1)
	}

	// Defer closing the pool here, as the user (main) owns it now.
	// This must happen *after* app.Close() finishes.
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

	// Log embedded assets using the app's logger and config
	// Note: config is now accessed via app.Config()
	//logEmbeddedAssets(restinpieces.EmbeddedAssets, app.Config(), app.Logger())

	//		app.Logger().Info("Starting server in verbose mode")

	// Start the server
	srv.Run() // srv is returned by restinpieces.New
}
