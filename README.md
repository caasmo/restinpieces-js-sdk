# RestInPieces JS SDK

The official JavaScript SDK for RestInPieces.

## Installation

```bash
npm install restinpieces
```

Or directly from GitHub:

```bash
npm install github:caasmo/restinpieces-js-sdk
```

## Usage

```javascript
import Restinpieces from 'restinpieces';

const client = new Restinpieces({
  baseURL: 'https://api.yourdomain.com',
});

// Example: Authenticating with password
client.authWithPassword({
  identity: 'user@example.com',
  password: 'yourpassword',
}).then(response => {
  console.log('Logged in!', response);
});
```

## Building from Source

To build the SDK from source, follow these steps:

1. **Clone the repository**:
   ```bash
   git clone https://github.com/caasmo/restinpieces-js-sdk.git
   cd restinpieces-js-sdk
   ```

2. **Install esbuild globally**:
   ```bash
   npm install -g esbuild
   ```

3. **Run the build script**:
   ```bash
   # Using npm
   npm run build

   # Or using the script directly
   ./build.sh
   ```


## Features

- **Automated Endpoint Discovery**: Fetches and caches API endpoints.
- **Authentication Management**: Built-in handling for JWT and OAuth2.
- **Lightweight**: Zero dependencies, bundled with `esbuild`.
- **Browser Compatible**: Uses `fetch` and `localStorage`.

## License

MIT
