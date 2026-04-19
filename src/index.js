import { ClientError } from "./client-error.js";
import { LocalStore } from "./local-store.js";
import { HttpClient } from "./http-client.js";

/**
 * @typedef {object} RestinpiecesConfig
 * Configuration object accepted by the {@link Restinpieces} constructor.
 * All fields are optional; omitted fields fall back to {@link Restinpieces.defaultConfig}.
 * @property {string} [baseURL="/"] - Base URL prepended to every API request
 * @property {string} [lang="en-US"] - BCP 47 language tag sent with requests
 * @property {LocalStore|null} [storage=null] - Custom storage adapter; a `LocalStore` is instantiated when `null`
 * @property {string} [endpointsPath="GET /api/list-endpoints"] - `"METHOD /path"` string for the endpoint discovery call
 */

/**
 * @template T
 * @typedef {object} ApiResponse
 * Standard API envelope returned by every server response.
 * @property {T} [data] - Response payload; shape depends on the called endpoint
 * @property {string} [message] - Optional human-readable message from the server
 * @property {number} [status] - HTTP status code mirrored in the body
 */

/**
 * @typedef {object} StoreHandle
 * Internal facade over the storage adapter, scoped to a single domain.
 * @template T
 * @property {function(T): void} save - Persist a value
 * @property {function(): T|null} load - Load the persisted value (or `null`)
 */

/**
 * @typedef {object} AuthStore
 * @property {function(import('./local-store.js').AuthData|null): void} save
 * @property {function(): import('./local-store.js').AuthData|null} load
 * @property {function(): boolean} isValid - Returns `true` if the stored token is present and unexpired
 */

/**
 * @typedef {object} ClientStore
 * Typed facades for each persisted domain.
 * @property {AuthStore} auth
 * @property {{ save: function(import('./local-store.js').ProviderData|null): void, load: function(): import('./local-store.js').ProviderData|null }} provider
 * @property {{ save: function(import('./local-store.js').EndpointMap|null): void, load: function(): import('./local-store.js').EndpointMap|null }} endpoints
 */

/**
 * Internal registry of framework-supported capabilities.
 *
 * Capabilities act as stable "pointers" to dynamic backend paths. This abstraction
 * lets the SDK provide consistent auth workflows even when underlying API routes
 * are changed or versioned on the server.
 *
 * Protocol features:
 * - **Header injection** — the capability key is sent in `X-Restinpieces-Capability`.
 * - **Cache invalidation** — if the server detects a path/capability mismatch it
 *   returns a `capability_mismatch` error, signalling the SDK to mark the cache
 *   as stale and reload the endpoint map on the next request.
 *
 * @type {Record<string, string>}
 */
const CAPABILITIES = {
  REFRESH_AUTH: "refresh_auth",
  LIST_OAUTH2_PROVIDERS: "list_oauth2_providers",
  REGISTER_WITH_PASSWORD: "register_with_password",
  REQUEST_EMAIL_VERIFICATION: "request_email_verification",
  CONFIRM_EMAIL_VERIFICATION: "confirm_email_verification",
  CONFIRM_EMAIL_CHANGE: "confirm_email_change",
  REQUEST_PASSWORD_RESET: "request_password_reset",
  REQUEST_EMAIL_CHANGE: "request_email_change",
  AUTH_WITH_PASSWORD: "auth_with_password",
  AUTH_WITH_OAUTH2: "auth_with_oauth2",
};

/**
 * Main SDK client for the Restinpieces framework.
 *
 * Orchestrates authentication, capability-based endpoint resolution, and
 * transparent cache invalidation.  Intended as a single long-lived instance
 * per application — create it once and share it (e.g. via context or a module
 * singleton).
 *
 * @example
 * // Minimal setup
 * const rip = new Restinpieces({ baseURL: "https://api.example.com" });
 * await rip.authWithPassword({ email: "alice@example.com", password: "s3cr3t" });
 *
 * @example
 * // Full config
 * const rip = new Restinpieces({
 *   baseURL: "/api",
 *   lang: "fr-FR",
 *   endpointsPath: "GET /v2/endpoints",
 * });
 */
class Restinpieces {
  /**
   * Default configuration values merged with the caller's options.
   * @type {Required<RestinpiecesConfig>}
   */
  static defaultConfig = {
    baseURL: "/",
    lang: "en-US",
    storage: null,
    endpointsPath: "GET /api/list-endpoints",
  };

  /**
   * @param {RestinpiecesConfig} [config]
   */
  constructor(config = {}) {
    const mergedConfig = { ...Restinpieces.defaultConfig, ...config };

    /** @type {string} */
    this.baseURL = mergedConfig.baseURL;

    /** @type {string} BCP 47 language tag */
    this.lang = mergedConfig.lang;

    /** @type {LocalStore} Underlying storage adapter */
    this.storage = mergedConfig.storage || new LocalStore();

    /** @type {HttpClient} Low-level HTTP transport */
    this.httpClient = new HttpClient(this.baseURL);

    /**
     * `"METHOD /path"` string used to discover all capability endpoints.
     * @type {string}
     */
    this.endpointsPath = mergedConfig.endpointsPath;

    /**
     * In-flight endpoint discovery promise.
     * Shared across concurrent callers so the network request is deduplicated.
     * @type {Promise<import('./local-store.js').EndpointMap>|null}
     */
    this.endpointsPromise = null;

    /**
     * When `true`, the next capability call will bypass the local cache and
     * re-fetch the endpoint map from the server.
     * @type {boolean}
     */
    this._endpointsStale = false;

    /**
     * Typed, domain-scoped facades over the storage adapter.
     * @type {ClientStore}
     */
    this.store = {
      auth: {
        save: (data) => this.storage.saveAuth(data),
        load: () => this.storage.loadAuth(),
        isValid: () => this.storage.isTokenValid(),
      },
      provider: {
        save: (data) => this.storage.saveProvider(data),
        load: () => this.storage.loadProvider(),
      },
      endpoints: {
        save: (data) => this.storage.saveEndpoints(data),
        load: () => this.storage.loadEndpoints(),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Endpoint management
  // ---------------------------------------------------------------------------

  /**
   * Fetches the capability→endpoint map from the server and writes it to cache.
   *
   * Concurrent callers share the same in-flight Promise so only one HTTP
   * request is made regardless of how many callers are waiting.
   *
   * @returns {Promise<import('./local-store.js').EndpointMap>}
   * @throws {ClientError} When the server returns an empty or invalid endpoint list
   */
  _fetchEndpoints() {
    if (!this.endpointsPromise) {
      const [method, endpointPath] = this.endpointsPath.split(" ");

      this.endpointsPromise = this.httpClient
        .requestJson(endpointPath, method)
        .then((response) => {
          if (!response?.data) {
            throw new ClientError({ response: { message: "Empty endpoints list received" } });
          }
          this.store.endpoints.save(response.data);
          this.endpointsPromise = null;
          return response.data;
        })
        .catch((error) => {
          this.endpointsPromise = null;
          throw error;
        });
    }

    return this.endpointsPromise;
  }

  // ---------------------------------------------------------------------------
  // Core request primitives
  // ---------------------------------------------------------------------------

  /**
   * Public HTTP primitive — bypasses capability resolution and the endpoint
   * cache entirely.  Use this to call custom endpoints that are not part of
   * the framework's {@link CAPABILITIES} registry.
   *
   * @param {string} method - HTTP method (e.g. `"GET"`, `"POST"`)
   * @param {string} path - URL path to append to `baseURL`
   * @param {Record<string, *>} [queryParams] - Query string parameters
   * @param {Record<string, *>|null} [body] - Request body (JSON-serialized)
   * @param {Record<string, string>} [headers] - Additional request headers
   * @param {AbortSignal|null} [signal] - Optional cancellation signal
   * @returns {Promise<*>} Parsed JSON response body
   * @throws {ClientError}
   */
  request(method, path, queryParams = {}, body = null, headers = {}, signal = null) {
    return this.httpClient.requestJson(path, method, queryParams, body, headers, signal);
  }

  /**
   * Resolves a capability key to a `"METHOD /path"` string, injects the
   * required headers, and executes the request.
   *
   * On a `capability_mismatch` error the cache is invalidated so the next
   * call transparently re-discovers the correct path.
   *
   * @param {string} endpointKey - One of the values in {@link CAPABILITIES}
   * @param {Record<string, *>} queryParams
   * @param {Record<string, *>|null} body
   * @param {Record<string, string>} headers
   * @param {AbortSignal|null} signal
   * @param {boolean} [isAuthRequired] - When `true`, injects a Bearer token from storage
   * @returns {Promise<*>} Parsed JSON response body
   * @throws {ClientError} When the endpoint key is unknown, the token is missing, or the request fails
   */
  async #executeCapability(endpointKey, queryParams, body, headers, signal, isAuthRequired = false) {
    let endpoints = this.store.endpoints.load();

    if (this._endpointsStale || !endpoints || !endpoints[endpointKey]) {
      endpoints = await this._fetchEndpoints();
      this._endpointsStale = false;
    }

    const methodAndPath = endpoints[endpointKey];
    if (!methodAndPath || typeof methodAndPath !== "string") {
      throw new ClientError({
        status: 0,
        response: {
          message: `Endpoint key "${endpointKey}" not found or invalid in the endpoints list.`,
        },
      });
    }

    const [method, path] = methodAndPath.split(" ");

    /** @type {Record<string, string>} */
    const requestHeaders = {
      ...headers,
      "X-Restinpieces-Capability": endpointKey,
    };

    if (isAuthRequired) {
      const authData = this.store.auth.load() || {};
      if (!authData.access_token) {
        throw new ClientError({
          status: 401,
          response: { message: "No authentication token available." },
        });
      }
      requestHeaders["Authorization"] = `Bearer ${authData.access_token}`;
    }

    try {
      return await this.request(method, path, queryParams, body, requestHeaders, signal);
    } catch (error) {
      if (error instanceof ClientError && error.code === "capability_mismatch") {
        this._endpointsStale = true;
        this.store.endpoints.save(null);
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Authentication methods
  // ---------------------------------------------------------------------------

  /**
   * Silently refreshes the access token using the stored credentials.
   * Saves the new token to storage on success.
   *
   * Requires a valid session (Bearer token in storage).
   *
   * @returns {Promise<ApiResponse<import('./local-store.js').AuthData>>}
   * @throws {ClientError}
   */
  refreshAuth() {
    return this.#executeCapability(CAPABILITIES.REFRESH_AUTH, {}, null, {}, null, true)
      .then((response) => {
        if (response?.data?.access_token) {
          this.store.auth.save(response.data);
        }
        return response;
      });
  }

  /**
   * Returns the list of OAuth2 providers configured on the server.
   *
   * @returns {Promise<ApiResponse<Array<{ name: string, authUrl: string }>>>}
   * @throws {ClientError}
   */
  listOauth2Providers() {
    return this.#executeCapability(CAPABILITIES.LIST_OAUTH2_PROVIDERS, {}, null, {}, null, false);
  }

  /**
   * Registers a new user with email and password.
   * Saves auth data to storage when the server returns an access token.
   *
   * @param {{ email: string, password: string, [key: string]: * }|null} [body] - Registration payload
   * @param {Record<string, string>} [headers]
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<ApiResponse<import('./local-store.js').AuthData>>}
   * @throws {ClientError} Use `err.formErrors` to retrieve field-level validation errors
   */
  registerWithPassword(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.REGISTER_WITH_PASSWORD, {}, body, headers, signal, false)
      .then((response) => {
        if (response?.data?.access_token) {
          this.store.auth.save(response.data);
        }
        return response;
      });
  }

  /**
   * Requests a verification email for the currently authenticated user.
   * Requires a valid session (Bearer token in storage).
   *
   * @param {Record<string, *>|null} [body]
   * @param {Record<string, string>} [headers]
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<ApiResponse<{}>>}
   * @throws {ClientError}
   */
  requestEmailVerification(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.REQUEST_EMAIL_VERIFICATION, {}, body, headers, signal, true);
  }

  /**
   * Confirms an email address using a token received by email.
   *
   * @param {{ token: string }|null} [body]
   * @param {Record<string, string>} [headers]
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<ApiResponse<{}>>}
   * @throws {ClientError}
   */
  confirmEmailVerification(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.CONFIRM_EMAIL_VERIFICATION, {}, body, headers, signal, false);
  }

  /**
   * Confirms an email address change using a token received at the new address.
   *
   * @param {{ token: string }|null} [body]
   * @param {Record<string, string>} [headers]
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<ApiResponse<{}>>}
   * @throws {ClientError}
   */
  confirmEmailChange(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.CONFIRM_EMAIL_CHANGE, {}, body, headers, signal, false);
  }

  /**
   * Sends a password-reset email to the given address.
   *
   * @param {{ email: string }|null} [body]
   * @param {Record<string, string>} [headers]
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<ApiResponse<{}>>}
   * @throws {ClientError}
   */
  requestPasswordReset(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.REQUEST_PASSWORD_RESET, {}, body, headers, signal, false);
  }

  /**
   * Requests an email address change for the currently authenticated user.
   * Requires a valid session (Bearer token in storage).
   *
   * @param {{ newEmail: string }|null} [body]
   * @param {Record<string, string>} [headers]
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<ApiResponse<{}>>}
   * @throws {ClientError}
   */
  requestEmailChange(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.REQUEST_EMAIL_CHANGE, {}, body, headers, signal, true);
  }

  /**
   * Authenticates a user with email and password.
   * Saves auth data to storage on success.
   *
   * @param {{ email: string, password: string }|null} [body]
   * @param {Record<string, string>} [headers]
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<ApiResponse<import('./local-store.js').AuthData>>}
   * @throws {ClientError} Use `err.formErrors` to retrieve field-level validation errors
   *
   * @example
   * try {
   *   await rip.authWithPassword({ email: "alice@example.com", password: "s3cr3t" });
   * } catch (err) {
   *   if (err instanceof ClientError) {
   *     console.log(err.formErrors); // { email: ["Invalid credentials"] }
   *   }
   * }
   */
  authWithPassword(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.AUTH_WITH_PASSWORD, {}, body, headers, signal, false)
      .then((response) => {
        if (response?.data?.access_token) {
          this.store.auth.save(response.data);
        }
        return response;
      });
  }

  /**
   * Completes an OAuth2 authentication flow using a code/token from the provider.
   * Saves auth data to storage on success.
   *
   * @param {{ code: string, provider: string, [key: string]: * }|null} [body]
   * @param {Record<string, string>} [headers]
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<ApiResponse<import('./local-store.js').AuthData>>}
   * @throws {ClientError}
   */
  authWithOauth2(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.AUTH_WITH_OAUTH2, {}, body, headers, signal, false)
      .then((response) => {
        if (response?.data?.access_token) {
          this.store.auth.save(response.data);
        }
        return response;
      });
  }
}

export { ClientError };
export default Restinpieces;
