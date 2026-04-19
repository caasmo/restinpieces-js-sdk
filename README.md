# RestInPieces JS SDK

The official JavaScript SDK for RestInPieces.

## Installation

```bash
npm install restinpieces
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

- **Automated Endpoint Discovery**: Dynamic resolution of backend paths via capabilities.
- **Authentication Management**: Built-in handling for JWT and OAuth2 workflows.
- **Lightweight & Fast**: Bundled with `esbuild` for minimal footprint.
- **TypeScript Support**: Full type definitions included for a better developer experience.
- **Modern ESM**: Ships as a pure ES module.

## Development

### Setup

Clone the repository and install development dependencies:

```bash
git clone https://github.com/caasmo/restinpieces-js-sdk.git
cd restinpieces-js-sdk
npm install
```

### Building

The build process uses `esbuild` to bundle the source and `tsc` to generate type definitions. The output is located in the `dist/` directory.

```bash
npm run build
```

### Linting

We use ESLint with JSDoc support to maintain code quality and documentation consistency.

```bash
# Run linter
npm run lint

# Automatically fix issues
npm run lint:fix
```

### Type Checking

The SDK is written in JavaScript but provides TypeScript declarations. Types are automatically generated during the build process and verified via the project's configuration.

## License

MIT
