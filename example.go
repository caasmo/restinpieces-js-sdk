package main

import (
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"os"

	"github.com/caasmo/restinpieces/config"
	"github.com/caasmo/restinpieces/custom"
	"github.com/caasmo/restinpieces/server"
	"github.com/caasmo/restinpieces/setup"
)

func main() {
	// Load initial configuration
	cfg, err := config.Load(*dbfile)
	if err != nil {
		slog.Error("failed to load initial config", "error", err)
		return err
	}

	// Create the config provider with the initial config
	configProvider := config.NewProvider(cfg)

	app, proxy, err := setup.SetupApp(configProvider)
	if err != nil {
		slog.Error("failed to initialize app", "error", err)
		return err
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
		return err
	}

	// Start the server
	srv := server.NewServer(configProvider, proxy, scheduler, app.Logger())
	if *verbose {
		app.Logger().Info("Starting server in verbose mode")
	}
	srv.Run()
}
