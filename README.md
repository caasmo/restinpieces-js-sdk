## TODO

- make commands
- example showing auth  with curl examples
- with fileserver embeded
    - with auth showing html endpoints
- with fileserver 
- without cache, disabled things like Ip blocking
- example using app middleware
- example using custom db injecting pool?
- example passing logger to app
- example custom handler, app middleware
- example showing route features: Handle, showing framwework 

### Asset Generation
To bundle and optimize frontend assets (HTML, CSS, JavaScript) with minification and gzip compression:

    go generate

This creates production-ready assets in `public/dist/` with both compressed (.gz) and uncompressed versions.

## Run

    go run cmd/example1/...

    go run cmd/example/...
