export { ClientError };
export default Restinpieces;
/**
 * Configuration object accepted by the {@link Restinpieces} constructor.
 * All fields are optional; omitted fields fall back to {@link Restinpieces.defaultConfig}.
 */
export type RestinpiecesConfig = {
    /**
     * - Base URL prepended to every API request
     */
    baseURL?: string;
    /**
     * - BCP 47 language tag sent with requests
     */
    lang?: string;
    /**
     * - Custom storage adapter; a `LocalStore` is instantiated when `null`
     */
    storage?: LocalStore | null;
    /**
     * - `"METHOD /path"` string for the endpoint discovery call
     */
    endpointsPath?: string;
};
/**
 * Standard API envelope returned by every server response.
 */
export type ApiResponse<T> = {
    /**
     * - Response payload; shape depends on the called endpoint
     */
    data?: T;
    /**
     * - Optional human-readable message from the server
     */
    message?: string;
    /**
     * - HTTP status code mirrored in the body
     */
    status?: number;
};
/**
 * Internal facade over the storage adapter, scoped to a single domain.
 */
export type StoreHandle = object;
export type AuthStore = {
    /**
     * - Persists authentication data
     */
    save: (arg0: import("./local-store.js").AuthData | null) => void;
    /**
     * - Loads persisted authentication data
     */
    load: () => import("./local-store.js").AuthData | null;
    /**
     * - Returns `true` if the stored token is present and unexpired
     */
    isValid: () => boolean;
};
/**
 * Typed facades for each persisted domain.
 */
export type ClientStore = {
    /**
     * - Authentication storage facade
     */
    auth: AuthStore;
    /**
     * - OAuth2 provider storage facade
     */
    provider: {
        save: (arg0: import("./local-store.js").ProviderData | null) => void;
        load: () => import("./local-store.js").ProviderData | null;
    };
    /**
     * - Endpoint map storage facade
     */
    endpoints: {
        save: (arg0: import("./local-store.js").EndpointMap | null) => void;
        load: () => import("./local-store.js").EndpointMap | null;
    };
    /**
     * - Endpoints hash storage facade
     */
    endpointsHash: {
        save: (arg0: string | null) => void;
        load: () => string | null;
    };
};
import { ClientError } from "./client-error.js";
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
declare class Restinpieces {
    /**
     * Default configuration values merged with the caller's options.
     * @type {Required<RestinpiecesConfig>}
     */
    static defaultConfig: Required<RestinpiecesConfig>;
    /**
     * @param {RestinpiecesConfig} [config]
     */
    constructor(config?: RestinpiecesConfig);
    /** @type {string} */
    baseURL: string;
    /** @type {string} BCP 47 language tag */
    lang: string;
    /** @type {LocalStore} Underlying storage adapter */
    storage: LocalStore;
    /** @type {HttpClient} Low-level HTTP transport */
    httpClient: HttpClient;
    /**
     * `"METHOD /path"` string used to discover all capability endpoints.
     * @type {string}
     */
    endpointsPath: string;
    /**
     * In-flight endpoint discovery promise.
     * Shared across concurrent callers so the network request is deduplicated.
     * @type {Promise<import('./local-store.js').EndpointMap>|null}
     */
    endpointsPromise: Promise<import("./local-store.js").EndpointMap> | null;
    /**
     * When `true`, the next capability call will bypass the local cache and
     * re-fetch the endpoint map from the server.
     * @type {boolean}
     */
    _endpointsStale: boolean;
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
    _endpointsHash: string | null;
    /**
     * Typed, domain-scoped facades over the storage adapter.
     * @type {ClientStore}
     */
    store: ClientStore;
    /**
     * Fetches the capability→endpoint map from the server and writes it to cache.
     *
     * Concurrent callers share the same in-flight Promise so only one HTTP
     * request is made regardless of how many callers are waiting.
     *
     * @returns {Promise<import('./local-store.js').EndpointMap>}
     * @throws {ClientError} When the server returns an empty or invalid endpoint list
     */
    _fetchEndpoints(): Promise<import("./local-store.js").EndpointMap>;
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
    request(method: string, path: string, queryParams?: Record<string, any>, body?: Record<string, any> | null, headers?: Record<string, string>, signal?: AbortSignal | null): Promise<any>;
    /**
     * Silently refreshes the access token using the stored credentials.
     * Saves the new token to storage on success.
     *
     * Requires a valid session (Bearer token in storage).
     *
     * @returns {Promise<ApiResponse<import('./local-store.js').AuthData>>}
     * @throws {ClientError}
     */
    refreshAuth(): Promise<ApiResponse<import("./local-store.js").AuthData>>;
    /**
     * Returns the list of OAuth2 providers configured on the server.
     *
     * @returns {Promise<ApiResponse<Array<{ name: string, authUrl: string }>>>}
     * @throws {ClientError}
     */
    listOauth2Providers(): Promise<ApiResponse<Array<{
        name: string;
        authUrl: string;
    }>>>;
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
    registerWithPassword(body?: {
        email: string;
        password: string;
        password_confirm: string;
    } | null, headers?: Record<string, string>, signal?: AbortSignal | null): Promise<{
        email: string;
        verificationToken: string;
    }>;
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
    requestEmailVerification(body?: Record<string, any> | null, headers?: Record<string, string>, signal?: AbortSignal | null): Promise<ApiResponse<object>>;
    /**
     * Confirms an email address using a token received by email.
     *
     * @param {{ token: string }|null} [body]
     * @param {Record<string, string>} [headers]
     * @param {AbortSignal|null} [signal]
     * @returns {Promise<ApiResponse<object>>}
     * @throws {ClientError}
     */
    confirmEmailVerification(body?: {
        token: string;
    } | null, headers?: Record<string, string>, signal?: AbortSignal | null): Promise<ApiResponse<object>>;
    /**
     * Requests a verification OTP for the given email address.
     *
     * @param {{ email: string, password: string }|null} [body]
     * @param {Record<string, string>} [headers]
     * @param {AbortSignal|null} [signal]
     * @returns {Promise<ApiResponse<object>>}
     * @throws {ClientError}
     */
    requestEmailOtpVerification(body?: {
        email: string;
        password: string;
    } | null, headers?: Record<string, string>, signal?: AbortSignal | null): Promise<ApiResponse<object>>;
    /**
     * Confirms an email address using an OTP received by email.
     *
     * @param {{ otp: string, verification_token: string }|null} [body]
     * @param {Record<string, string>} [headers]
     * @param {AbortSignal|null} [signal]
     * @returns {Promise<ApiResponse<import('./local-store.js').AuthData>>}
     * @throws {ClientError}
     */
    confirmEmailOtpVerification(body?: {
        otp: string;
        verification_token: string;
    } | null, headers?: Record<string, string>, signal?: AbortSignal | null): Promise<ApiResponse<import("./local-store.js").AuthData>>;
    /**
     * Confirms an email address change using a token received at the new address.
     *
     * @param {{ token: string }|null} [body]
     * @param {Record<string, string>} [headers]
     * @param {AbortSignal|null} [signal]
     * @returns {Promise<ApiResponse<object>>}
     * @throws {ClientError}
     */
    confirmEmailChange(body?: {
        token: string;
    } | null, headers?: Record<string, string>, signal?: AbortSignal | null): Promise<ApiResponse<object>>;
    /**
     * Sends a password-reset email to the given address.
     *
     * @param {{ email: string }|null} [body]
     * @param {Record<string, string>} [headers]
     * @param {AbortSignal|null} [signal]
     * @returns {Promise<ApiResponse<object>>}
     * @throws {ClientError}
     */
    requestPasswordReset(body?: {
        email: string;
    } | null, headers?: Record<string, string>, signal?: AbortSignal | null): Promise<ApiResponse<object>>;
    /**
     * Requests a password reset OTP for the given email address.
     *
     * @param {{ email: string }|null} [body]
     * @param {Record<string, string>} [headers]
     * @param {AbortSignal|null} [signal]
     * @returns {Promise<ApiResponse<object>>}
     * @throws {ClientError}
     */
    requestPasswordResetOtp(body?: {
        email: string;
    } | null, headers?: Record<string, string>, signal?: AbortSignal | null): Promise<ApiResponse<object>>;
    /**
     * Verifies the password reset OTP and returns a grant token.
     *
     * @param {{ otp: string, verification_token: string }|null} [body]
     * @param {Record<string, string>} [headers]
     * @param {AbortSignal|null} [signal]
     * @returns {Promise<ApiResponse<{ token: string }>>}
     * @throws {ClientError}
     */
    verifyPasswordResetOtp(body?: {
        otp: string;
        verification_token: string;
    } | null, headers?: Record<string, string>, signal?: AbortSignal | null): Promise<ApiResponse<{
        token: string;
    }>>;
    /**
     * Confirms the new password using the grant token.
     * Saves auth data to storage on success.
     *
     * @param {{ token: string, password: string, password_confirm: string }|null} [body]
     * @param {Record<string, string>} [headers]
     * @param {AbortSignal|null} [signal]
     * @returns {Promise<ApiResponse<import('./local-store.js').AuthData>>}
     * @throws {ClientError}
     */
    confirmPasswordResetOtp(body?: {
        token: string;
        password: string;
        password_confirm: string;
    } | null, headers?: Record<string, string>, signal?: AbortSignal | null): Promise<ApiResponse<import("./local-store.js").AuthData>>;
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
    requestEmailChange(body?: {
        newEmail: string;
    } | null, headers?: Record<string, string>, signal?: AbortSignal | null): Promise<ApiResponse<object>>;
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
    authWithPassword(body?: {
        email: string;
        password: string;
    } | null, headers?: Record<string, string>, signal?: AbortSignal | null): Promise<null | {
        email: string;
        verificationToken: string;
    }>;
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
    authWithOauth2(body?: {
        code: string;
        provider: string;
        [key: string]: any;
    } | null, headers?: Record<string, string>, signal?: AbortSignal | null): Promise<ApiResponse<import("./local-store.js").AuthData>>;
    #private;
}
import { LocalStore } from "./local-store.js";
import { HttpClient } from "./http-client.js";
