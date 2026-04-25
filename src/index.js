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
 * @property {function(import('./local-store.js').AuthData|null): void} save - Persists authentication data
 * @property {function(): import('./local-store.js').AuthData|null} load - Loads persisted authentication data
 * @property {function(): boolean} isValid - Returns `true` if the stored token is present and unexpired
 */

/**
 * @typedef {object} ClientStore
 * Typed facades for each persisted domain.
 * @property {AuthStore} auth - Authentication storage facade
 * @property {{ save: function(import('./local-store.js').ProviderData|null): void, load: function(): import('./local-store.js').ProviderData|null }} provider - OAuth2 provider storage facade
 * @property {{ save: function(import('./local-store.js').EndpointMap|null): void, load: function(): import('./local-store.js').EndpointMap|null }} endpoints - Endpoint map storage facade
 * @property {{ save: function(string|null): void, load: function(): string|null }} endpointsHash - Endpoints hash storage facade
 */

/**
 * Internal registry of framework-supported capabilities.
 *
 * Capabilities act as stable "pointers" to dynamic backend paths. This abstraction
 * lets the SDK provide consistent auth workflows even when underlying API routes
 * are changed or versioned on the server.
 *
 * Cache invalidation — the SDK sends a `X-Restinpieces-Endpoints-Hash` header
 * on every capability request. If the server detects a hash mismatch (routes
 * changed via config reload), it returns `err_endpoints_hash_mismatch`,
 * signalling the SDK to mark the cache as stale and reload the endpoint map
 * on the next request.
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
  REQUEST_EMAIL_OTP_VERIFICATION: "request_email_otp_verification",
  CONFIRM_EMAIL_OTP_VERIFICATION: "confirm_email_otp_verification",
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
     * Cached endpoints hash from the server's endpoint discovery response.
     * Sent on every capability request via `X-Restinpieces-Endpoints-Hash`.
     *
     * BOOTSTRAP LOGIC:
     * - `null`: First boot or upgraded legacy client (no hash in storage).
     *          Triggers a discovery call to sync the hash.
     * - `""`:   Synced with a server that does not provide hashes.
     *          Prevents infinite discovery loops on legacy backends.
     * - string: Valid hash used for cache invalidation.
     *
     * @type {string|null}
     */
    this._endpointsHash = this.storage.loadEndpointsHash();

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
      endpointsHash: {
        save: (data) => this.storage.saveEndpointsHash(data),
        load: () => this.storage.loadEndpointsHash(),
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
          if (!response?.data?.endpoints) {
            throw new ClientError({ response: { message: "Empty endpoints list received" } });
          }
          this.store.endpoints.save(response.data.endpoints);
          this._endpointsHash = response.data.hash || "";
          this.store.endpointsHash.save(this._endpointsHash);
          this.endpointsPromise = null;
          return response.data.endpoints;
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
   * @param {Record<string, any>} [queryParams] - Query string parameters
   * @param {Record<string, any>|null} [body] - Request body (JSON-serialized)
   * @param {Record<string, string>} [headers] - Additional request headers
   * @param {AbortSignal|null} [signal] - Optional cancellation signal
   * @returns {Promise<any>} Parsed JSON response body
   * @throws {ClientError}
   */
  request(method, path, queryParams = {}, body = null, headers = {}, signal = null) {
    return this.httpClient.requestJson(path, method, queryParams, body, headers, signal);
  }

  /**
   * Resolves a capability key to a `"METHOD /path"` string, injects the
   * endpoints hash header, and executes the request.
   *
   * On an `err_endpoints_hash_mismatch` error the cache is invalidated so
   * the next call transparently re-discovers the correct path.
   *
   * @param {string} endpointKey - One of the values in {@link CAPABILITIES}
   * @param {Record<string, any>} queryParams
   * @param {Record<string, any>|null} body
   * @param {Record<string, string>} headers
   * @param {AbortSignal|null} signal
   * @param {boolean} [isAuthRequired] - When `true`, injects a Bearer token from storage
   * @returns {Promise<any>} Parsed JSON response body
   * @throws {ClientError} When the endpoint key is unknown, the token is missing, or the request fails
   */
  async #executeCapability(endpointKey, queryParams, body, headers, signal, isAuthRequired = false) {
    let endpoints = this.store.endpoints.load();

    if (this._endpointsStale || !endpoints || this._endpointsHash === null || !endpoints[endpointKey]) {
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
    const requestHeaders = { ...headers };
    if (this._endpointsHash) {
      requestHeaders["X-Restinpieces-Endpoints-Hash"] = this._endpointsHash;
    }

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
      if (error instanceof ClientError && error.code === "err_endpoints_hash_mismatch") {
        this._endpointsStale = true;
        this.store.endpoints.save(null);
        this._endpointsHash = "";
        this.store.endpointsHash.save(null);
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
   * Composed registration flow — orchestrates two capability calls.
   *
   * Flow:
   *   1. REGISTER_WITH_PASSWORD — creates the user account.
   *   2. REQUEST_EMAIL_OTP_VERIFICATION — automatically triggered.
   *
   * Returns the data needed to complete the flow via confirmEmailOtpVerification.
   * This method NEVER saves to localStorage.
   *
   * @param {{ email: string, password: string, password_confirm: string }|null} [body]
   * @param {Record<string, string>} [headers]
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<{ email: string, verificationToken: string }>}
   * @throws {ClientError}
   */
  async registerWithPassword(body = null, headers = {}, signal = null) {
    await this.#executeCapability(
      CAPABILITIES.REGISTER_WITH_PASSWORD,
      {},
      {
        identity: body.email,
        password: body.password,
        password_confirm: body.password_confirm,
      },
      headers,
      signal,
      false
    );
    const otpResponse = await this.#executeCapability(
      CAPABILITIES.REQUEST_EMAIL_OTP_VERIFICATION, {}, { email: body.email, password: body.password }, headers, signal, false
    );
    return { email: body.email, verificationToken: otpResponse.data.verification_token };
  }

  /**
   * Requests a verification email for the currently authenticated user.
   * Requires a valid session (Bearer token in storage).
   *
   * @param {Record<string, any>|null} [body]
   * @param {Record<string, string>} [headers]
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<ApiResponse<object>>}
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
   * @returns {Promise<ApiResponse<object>>}
   * @throws {ClientError}
   */
  confirmEmailVerification(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.CONFIRM_EMAIL_VERIFICATION, {}, body, headers, signal, false);
  }

  /**
   * Requests a verification OTP for the given email address.
   *
   * @param {{ email: string, password: string }|null} [body]
   * @param {Record<string, string>} [headers]
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<ApiResponse<object>>}
   * @throws {ClientError}
   */
  requestEmailOtpVerification(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.REQUEST_EMAIL_OTP_VERIFICATION, {}, body, headers, signal, false);
  }

  /**
   * Confirms an email address using an OTP received by email.
   *
   * @param {{ otp: string, verification_token: string }|null} [body]
   * @param {Record<string, string>} [headers]
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<ApiResponse<import('./local-store.js').AuthData>>}
   * @throws {ClientError}
   */
  confirmEmailOtpVerification(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.CONFIRM_EMAIL_OTP_VERIFICATION, {}, body, headers, signal, false)
      .then((response) => {
        if (response?.data?.access_token) {
          this.store.auth.save(response.data);
        }
        return response;
      });
  }

  /**
   * Confirms an email address change using a token received at the new address.
   *
   * @param {{ token: string }|null} [body]
   * @param {Record<string, string>} [headers]
   * @param {AbortSignal|null} [signal]
   * @returns {Promise<ApiResponse<object>>}
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
   * @returns {Promise<ApiResponse<object>>}
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
   * @returns {Promise<ApiResponse<object>>}
   * @throws {ClientError}
   */
  requestEmailChange(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.REQUEST_EMAIL_CHANGE, {}, body, headers, signal, true);
  }

/**
 * Composed authentication flow — orchestrates two capability calls.
 *
 * CONVENTION BREAK: Unlike all other methods in this class, this method
 * does not return a raw ApiResponse. It returns a discriminated union
 * because it covers two distinct outcomes with different data shapes.
 * This is intentional — the return type reflects the flow, not the wire.
 *
 * Flow:
 *   1. AUTH_WITH_PASSWORD — on success, saves auth data and returns null.
 *   2. If the server requires OTP, automatically calls
 *      REQUEST_EMAIL_OTP_VERIFICATION and returns the data needed
 *      to complete the flow via confirmEmailOtpVerification.
 *
 * @param {{ email: string, password: string }|null} [body]
 * @param {Record<string, string>} [headers]
 * @param {AbortSignal|null} [signal]
 * @returns {Promise<null | { email: string, verificationToken: string }>}
 * @throws {ClientError} On credential failure, or when the subsequent OTP request fails.
 */
async authWithPassword(body = null, headers = {}, signal = null) {
  try {
    const response = await this.#executeCapability(CAPABILITIES.AUTH_WITH_PASSWORD, {}, { identity: body.email, password: body.password }, headers, signal, false);
    if (response?.data?.access_token) {
      this.store.auth.save(response.data);
    }
    return null;
  } catch (err) {
    if (err instanceof ClientError && err.code === "err_required_email_otp_verification") {
      const otpResponse = await this.#executeCapability(CAPABILITIES.REQUEST_EMAIL_OTP_VERIFICATION, {}, { email: body.email, password: body.password }, headers, signal, false);
      return {
        email: body.email,
        verificationToken: otpResponse.data.verification_token,
      };
    }
    throw err;
  }
}

  /**
   * Completes an OAuth2 authentication flow using a code/token from the provider.
   * Saves auth data to storage on success.
   *
   * @param {{ code: string, provider: string, [key: string]: any }|null} [body]
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
