package main

import (
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"os"

	"github.com/caasmo/restinpieces"
	"github.com/caasmo/restinpieces/config"
	"github.com/caasmo/restinpieces/custom"
	"github.com/caasmo/restinpieces/server"
	"github.com/caasmo/restinpieces/setup"
)

var (
	dbfile  = flag.String("db", "app.db", "Path to the database file")
	verbose = flag.Bool("verbose", false, "Enable verbose logging")
)

func main() {
	flag.Parse()

	// Load initial configuration
	cfg, err := config.Load(*dbfile)
	if err != nil {
		slog.Error("failed to load initial config", "error", err)
		os.Exit(1)
	}

	// Create the config provider with the initial config
	configProvider := config.NewProvider(cfg)

	app, proxy, err := setup.SetupApp(configProvider)
	if err != nil {
		slog.Error("failed to initialize app", "error", err)
		os.Exit(1)
	}
	defer app.Close()

	// Log embedded assets using the app's logger
	app.Logger().Debug("logging embedded assets", "public_dir", cfg.PublicDir)
	logEmbeddedAssets(restinpieces.EmbeddedAssets, cfg, app.Logger())

	// Setup custom app
	cApp := custom.NewApp(app)

	// Setup routing
	route(cfg, app, cApp)

	// Setup Scheduler
	scheduler, err := setup.SetupScheduler(configProvider, app.Db(), app.Logger())
	if err != nil {
		slog.Error("failed to setup scheduler", "error", err)
		os.Exit(1)
	}

	// Start the server
	srv := server.NewServer(configProvider, proxy, scheduler, app.Logger())
	if *verbose {
		app.Logger().Info("Starting server in verbose mode")
	}
	srv.Run()
}

// Placeholder for logEmbeddedAssets function
func logEmbeddedAssets(assets fs.FS, cfg *config.Config, logger *slog.Logger) {
	logger.Info("logging embedded assets (placeholder)")
	// Implementation would go here, e.g., walking the fs.FS
	// and logging file names or other details.
}

// Placeholder for route function
func route(cfg *config.Config, app *setup.App, cApp *custom.App) {
	app.Logger().Info("setting up routes (placeholder)")
	// Implementation would involve setting up HTTP routes
	// using app.Router() or similar.
}
