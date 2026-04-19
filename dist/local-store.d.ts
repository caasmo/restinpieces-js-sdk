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
    static #keys: {
        auth: string;
        provider: string;
        endpoints: string;
    };
    /**
     * Loads the persisted authentication data.
     * @returns {AuthData|null} The stored auth payload, or `null` if not present
     */
    loadAuth(): AuthData | null;
    /**
     * Persists authentication data returned by a login or token-refresh response.
     * Pass `null` to clear the stored auth state.
     * @param {AuthData|null} value
     * @returns {void}
     */
    saveAuth(value: AuthData | null): void;
    /**
     * Checks whether the stored access token is present and not yet expired
     * by decoding its JWT payload without a signature check.
     *
     * @returns {boolean}
     *   `true` if the token exists and its `exp` claim is in the future;
     *   `false` if the token is absent, malformed, or expired.
     */
    isTokenValid(): boolean;
    /**
     * Loads the persisted OAuth2 provider state.
     * @returns {ProviderData|null}
     */
    loadProvider(): ProviderData | null;
    /**
     * Persists OAuth2 provider state selected during an OAuth2 flow.
     * Pass `null` to clear.
     * @param {ProviderData|null} value
     * @returns {void}
     */
    saveProvider(value: ProviderData | null): void;
    /**
     * Loads the cached capability→endpoint map.
     * @returns {EndpointMap|null}
     */
    loadEndpoints(): EndpointMap | null;
    /**
     * Persists the capability→endpoint map received from the server.
     * Pass `null` to mark the cache as stale (forces a re-fetch on next use).
     * @param {EndpointMap|null} value
     * @returns {void}
     */
    saveEndpoints(value: EndpointMap | null): void;
    #private;
}
/**
 * Authentication token payload as returned by the API and persisted to storage.
 */
export type AuthData = {
    /**
     * - JWT access token
     */
    access_token: string;
    /**
     * - Optional refresh token for silent renewal
     */
    refresh_token?: string;
    /**
     * - Token type, typically `"Bearer"`
     */
    token_type?: string;
    /**
     * - Lifetime of the access token in seconds
     */
    expires_in?: number;
};
/**
 * OAuth2 provider information saved after the user selects a provider.
 */
export type ProviderData = {
    /**
     * - Provider identifier (e.g. `"google"`, `"github"`)
     */
    name: string;
    /**
     * - Authorization URL to redirect the user to
     */
    authUrl?: string;
};
/**
 * Maps capability keys to `"METHOD /path"` strings as returned by the server.
 */
export type EndpointMap = Record<string, string>;
