import { ClientError } from "./client-error.js";
import { LocalStore } from "./local-store.js";
import { HttpClient } from "./http-client.js"; // Import the new class

/**
 * Internal registry of framework-supported capabilities.
 * 
 * Capabilities act as stable "pointers" to dynamic backend paths. This abstraction allows
 * the SDK to provide consistent auth workflows even when underlying API routes are changed 
 * or versioned on the server.
 * 
 * Protocol features:
 * - Header Injection: The capability key is sent in the `X-Restinpieces-Capability` header.
 * - Cache Invalidation: If the server detects a path/capability mismatch, it returns a 
 *   `capability_mismatch` error, signaling the SDK to mark the cache as stale and reload 
 *   the endpoint map.
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

class Restinpieces {
  // Default configuration
  static defaultConfig = {
    baseURL: "/",
    lang: "en-US",
    storage: null, // Will be instantiated if null
    endpointsPath: "GET /api/list-endpoints",
  };

  constructor(config = {}) {
    // Merge user config with defaults
    const mergedConfig = { ...Restinpieces.defaultConfig, ...config };

    this.baseURL = mergedConfig.baseURL;
    this.lang = mergedConfig.lang;
    this.storage = mergedConfig.storage || new LocalStore(); // Instantiate storage
    this.httpClient = new HttpClient(this.baseURL); // Instantiate HttpClient
    this.endpointsPath = mergedConfig.endpointsPath;
    this.endpointsPromise = null; // Tracks ongoing fetch endpoint requests
    this._endpointsStale = false; // Add this line

    // TODO: Consider moving these to config or removing if unused
    //this.recordServices = {};
    //this.enableAutoCancellation = true;
    //this.cancelControllers = {};

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

  // --- Endpoint Management ---

  // 1. Pure network fetch (no cache reading!)
  _fetchEndpoints() {
    if (!this.endpointsPromise) {
      const [method, endpointPath] = this.endpointsPath.split(" ");

      this.endpointsPromise = this.httpClient
        .requestJson(endpointPath, method)
        .then((response) => {
          if (!response?.data) {
            throw new ClientError({ response: { message: "Empty endpoints list received" } });
          }
          
          // Only write to the cache. We don't read from it.
          this.store.endpoints.save(response.data); 
          this.endpointsPromise = null; 
          return response.data;
        })
        .catch((error) => {
          this.endpointsPromise = null; // Clear promise on error
          throw error;
        });
    }

    return this.endpointsPromise;
  }

  // --- Core Request Methods ---

  // Public HTTP primitive — knows nothing about endpoint keys or caches.
  // Use this to call custom endpoints outside the framework's CAPABILITIES list.
  request(method, path, queryParams = {}, body = null, headers = {}, signal = null) {
    return this.httpClient.requestJson(path, method, queryParams, body, headers, signal);
  }

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

  // --- Authentication Methods ---

  refreshAuth() {
    return this.#executeCapability(CAPABILITIES.REFRESH_AUTH, {}, null, {}, null, true)
      .then((response) => {
        if (response?.data?.access_token) {
          this.store.auth.save(response.data);
        }
        return response;
      });
  }

  listOauth2Providers() {
    return this.#executeCapability(CAPABILITIES.LIST_OAUTH2_PROVIDERS, {}, null, {}, null, false);
  }

  registerWithPassword(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.REGISTER_WITH_PASSWORD, {}, body, headers, signal, false)
      .then((response) => {
        if (response?.data?.access_token) {
          this.store.auth.save(response.data);
        }
        return response;
      });
  }

  requestEmailVerification(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.REQUEST_EMAIL_VERIFICATION, {}, body, headers, signal, true);
  }

  confirmEmailVerification(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.CONFIRM_EMAIL_VERIFICATION, {}, body, headers, signal, false);
  }

  confirmEmailChange(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.CONFIRM_EMAIL_CHANGE, {}, body, headers, signal, false);
  }

  requestPasswordReset(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.REQUEST_PASSWORD_RESET, {}, body, headers, signal, false);
  }

  requestEmailChange(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.REQUEST_EMAIL_CHANGE, {}, body, headers, signal, true);
  }

  authWithPassword(body = null, headers = {}, signal = null) {
    return this.#executeCapability(CAPABILITIES.AUTH_WITH_PASSWORD, {}, body, headers, signal, false)
      .then((response) => {
        if (response?.data?.access_token) {
          this.store.auth.save(response.data);
        }
        return response;
      });
  }

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
