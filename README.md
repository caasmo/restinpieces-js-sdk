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

## Features

- **Automated Endpoint Discovery**: Fetches and caches API endpoints.
- **Authentication Management**: Built-in handling for JWT and OAuth2.
- **Lightweight**: Zero dependencies, bundled with `esbuild`.
- **Browser Compatible**: Uses `fetch` and `localStorage`.

## License

MIT
