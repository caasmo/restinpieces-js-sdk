/**
 * @typedef {object} AuthData
 * Authentication token payload as returned by the API and persisted to storage.
 * @property {string} access_token - JWT access token
 * @property {string} [refresh_token] - Optional refresh token for silent renewal
 * @property {string} [token_type] - Token type, typically `"Bearer"`
 * @property {number} [expires_in] - Lifetime of the access token in seconds
 */

/**
 * @typedef {object} ProviderData
 * OAuth2 provider information saved after the user selects a provider.
 * @property {string} name - Provider identifier (e.g. `"google"`, `"github"`)
 * @property {string} [authUrl] - Authorization URL to redirect the user to
 */

/**
 * @typedef {Record<string, string>} EndpointMap
 * Maps capability keys to `"METHOD /path"` strings as returned by the server.
 * @example { "auth_with_password": "POST /api/auth/password" }
 */

/**
 * Thin `localStorage` adapter that handles JSON serialization and provides
 * typed accessors for the three data domains the SDK persists:
 * authentication tokens, OAuth2 provider state, and the capability→endpoint map.
 *
 * All `#get` / `#set` operations are wrapped in try/catch; storage failures
 * throw a plain `Error` with a descriptive message so callers can decide
 * whether to degrade gracefully or surface the error.
 *
 * @example
 * const store = new LocalStore();
 * store.saveAuth({ access_token: "ey..." });
 * store.isTokenValid(); // true / false
 */
export class LocalStore {
  /**
   * `localStorage` key registry.
   * Changing these values will invalidate any data written by a previous version.
   * @type {{ auth: string, provider: string, endpoints: string }}
   */
  static #keys = {
    auth: "_rip_auth",
    provider: "_rip_provider",
    endpoints: "_rip_endpoints",
  };

  // ---------------------------------------------------------------------------
  // Private generic accessors
  // ---------------------------------------------------------------------------

  /**
   * Reads and JSON-parses a value from `localStorage`.
   *
   * @template T
   * @param {"auth" | "provider" | "endpoints"} key - Domain key (`"auth"`, `"provider"`, `"endpoints"`)
   * @returns {T|null} Parsed value, or `null` if the key is absent
   * @throws {Error} When `localStorage` access or JSON parsing fails
   */
  #get(key) {
    try {
      const value = localStorage.getItem(LocalStore.#keys[key]);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Failed to retrieve ${key}:`, error);
      throw new Error(`Failed to retrieve ${key}: ` + error.message, { cause: error });
    }
  }

  /**
   * JSON-serializes `value` and writes it to `localStorage`.
   *
   * @template T
   * @param {"auth" | "provider" | "endpoints"} key - Domain key
   * @param {T} value - Value to store; must be JSON-serializable
   * @returns {void}
   * @throws {Error} When `localStorage` is unavailable or the quota is exceeded
   */
  #set(key, value) {
    try {
      localStorage.setItem(LocalStore.#keys[key], JSON.stringify(value));
    } catch (error) {
      console.error(`Failed to store ${key}:`, error);
      throw new Error(`Failed to store ${key}: ` + error.message, { cause: error });
    }
  }

  // ---------------------------------------------------------------------------
  // Auth
  // ---------------------------------------------------------------------------

  /**
   * Loads the persisted authentication data.
   * @returns {AuthData|null} The stored auth payload, or `null` if not present
   */
  loadAuth() {
    return this.#get("auth");
  }

  /**
   * Persists authentication data returned by a login or token-refresh response.
   * Pass `null` to clear the stored auth state.
   * @param {AuthData|null} value
   * @returns {void}
   */
  saveAuth(value) {
    this.#set("auth", value);
  }

  /**
   * Checks whether the stored access token is present and not yet expired
   * by decoding its JWT payload without a signature check.
   *
   * @returns {boolean}
   *   `true` if the token exists and its `exp` claim is in the future;
   *   `false` if the token is absent, malformed, or expired.
   */
  isTokenValid() {
    try {
      const auth = this.loadAuth();
      if (!auth?.access_token) return false;
      const payload = JSON.parse(atob(auth.access_token.split(".")[1]));
      return payload.exp > Date.now() / 1000;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Provider
  // ---------------------------------------------------------------------------

  /**
   * Loads the persisted OAuth2 provider state.
   * @returns {ProviderData|null}
   */
  loadProvider() {
    return this.#get("provider");
  }

  /**
   * Persists OAuth2 provider state selected during an OAuth2 flow.
   * Pass `null` to clear.
   * @param {ProviderData|null} value
   * @returns {void}
   */
  saveProvider(value) {
    this.#set("provider", value);
  }

  // ---------------------------------------------------------------------------
  // Endpoints
  // ---------------------------------------------------------------------------

  /**
   * Loads the cached capability→endpoint map.
   * @returns {EndpointMap|null}
   */
  loadEndpoints() {
    return this.#get("endpoints");
  }

  /**
   * Persists the capability→endpoint map received from the server.
   * Pass `null` to mark the cache as stale (forces a re-fetch on next use).
   * @param {EndpointMap|null} value
   * @returns {void}
   */
  saveEndpoints(value) {
    this.#set("endpoints", value);
  }
}
