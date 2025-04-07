package main
//go:generate go run gen/gogenerate-assets.go -baseDir static

import (
	"flag"
	"log/slog"
	"os"
	"embed"
	"io/fs"
	"net/http"

	"github.com/caasmo/restinpieces"

	//"github.com/caasmo/restinpieces/custom"

    // TODO
	r "github.com/caasmo/restinpieces/router"
	"github.com/caasmo/restinpieces/core"
)

// entry points is custom 
// New creates app and 
// user says load auth routes
// user can use the router
// and has db conection to zombiezen or cranwsaw
// user adds commands
// user adds handlers
// need access to cache, its own
// needs to choose wich db, etc
// auth endpoints need work with zombiezen, we need to test
// user has With availableo
// new pure dn jsut pool.
// use has his own.
// revisitar si necesitamos db, auth endpoints estan ocultos,b
// db is auth db , only needed for auth, 
// we needed interface for auth with various
// pass the pool to db.
// if you want to use auth pass    
// User: i want to work with zombiezen, auth need pool
// pass pool to db,
// reanme to Dbauth, build dbauth with pool
// user does not want acces to db
// not only dbauth, but job
// dbqueue
// these things can you use to facilitate your work
// endpoint
// write functions``
// you can clone, and fork
// or you can use these things.
// you can use the queue and job
// hot realoding
// blokcking
// user has to build app.
//
// restinpieces.New is the custom
// user say: 
// fefault
// restinpieces.New(
	// withZombiezenDbClient
	// WithStandardMux
	// 
// how i use the router 
// and the db
// how i use the queue
// how i disable the endpoints
// framework has no command make you own
//)
// split db interface in dbAuth and dbQueue, 
// user can use dbQueue is generic enough
// restinpieces is the struct.
// has the server.
// restincipeces.Run()
// restincipeces.Router()
// restincipeces.Dbqueue()
// restincipeces.Cache()
// user has own struct with its own db
// can embed the restinpieces object
// config user uses its own config
// db we wnat the pool, the dbclient 
// dbinterface has get pool Pool() 
// you can have your own and pass to db, or lets start with dbBase SetPool(), Pool()



var (
	dbfile  = flag.String("db", "app.db", "Path to the database file")
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

	app, srv, err := restinpieces.New(
		*dbfile,
		restinpieces.WithDBCrawshaw(*dbfile), // Pass dbfile here as well for DB init
		restinpieces.WithRouterServeMux(),  // Using Httprouter as an example default
		restinpieces.WithCacheRistretto(),
		restinpieces.WithTextLogger(nil), // Use default text logger options
	)
	if err != nil {
		slog.Error("failed to initialize application", "error", err)
		os.Exit(1)
	}
	defer app.Close() // Ensure resources are cleaned up

	// Serve static files from configured public directory

	// --- file server ---
    cfg:= app.Config()
	subFS, err := fs.Sub(EmbeddedAssets, cfg.PublicDir)
	if err != nil {
		// TODO
		panic("failed to create sub filesystem: " + err.Error())
	}

	ffs := http.FileServerFS(subFS)
	app.Router().Register(
		r.NewRoute("/").WithHandler(ffs).WithMiddleware(
			core.StaticHeadersMiddleware,
			core.GzipMiddleware(subFS),
		),
	)

	// Log embedded assets using the app's logger and config
	// Note: config is now accessed via app.Config()
	//logEmbeddedAssets(restinpieces.EmbeddedAssets, app.Config(), app.Logger())

//		app.Logger().Info("Starting server in verbose mode")

	// Start the server
	srv.Run() // srv is returned by restinpieces.New
}

