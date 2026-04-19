import { ClientError } from "./client-error.js";

/**
 * Low-level HTTP client that wraps `fetch` with JSON handling and
 * standardized {@link ClientError} responses.
 *
 * All public methods return Promises that **always reject with a
 * {@link ClientError}** — never with a raw `TypeError` or `DOMException`.
 * This means callers need only a single `catch` branch and can rely on
 * consistent error fields (`status`, `code`, `isAbort`, `formErrors`, …).
 *
 * @example
 * const http = new HttpClient("https://api.example.com");
 * const data = await http.requestJson("/users", "GET", { page: 2 });
 */
export class HttpClient {
  /**
   * @param {string} baseURL - Base URL prepended to every request path.
   *   Can be absolute (`"https://api.example.com"`) or relative (`"/api"`).
   */
  constructor(baseURL) {
    /** @type {string} */
    this.baseURL = baseURL;
  }

  /**
   * Makes an HTTP request with JSON handling and standardized error responses.
   *
   * Behaviour summary:
   * - Non-2xx responses are parsed and thrown as {@link ClientError}.
   * - 204 No Content resolves with `{}`.
   * - Aborted requests resolve as a {@link ClientError} with `isAbort: true`.
   * - All other unexpected errors (network failures, invalid JSON) are
   *   wrapped in {@link ClientError} before being re-thrown.
   *
   * @param {string} path - URL path to append to `baseURL`
   * @param {string} [method] - HTTP method (`"GET"`, `"POST"`, …)
   * @param {Record<string, *>} [queryParams] - Key/value pairs serialized into the query string
   * @param {Record<string, *>|null} [body] - Request body; will be `JSON.stringify`-ed
   * @param {Record<string, string>} [headers] - Additional request headers (merged over defaults)
   * @param {AbortSignal|null} [signal] - Optional signal for request cancellation
   * @returns {Promise<*>} Resolves with the parsed JSON response body
   * @throws {ClientError} On any non-2xx status, network error, or abort
   *
   * @example
   * const controller = new AbortController();
   * const user = await http.requestJson(
   *   "/users/42",
   *   "PATCH",
   *   {},
   *   { name: "Alice" },
   *   { "X-Custom": "value" },
   *   controller.signal,
   * );
   */
  requestJson(
    path,
    method = "GET",
    queryParams = {},
    body = null,
    headers = {},
    signal = null,
  ) {
    let url = this.buildUrl(this.baseURL, path);

    const serializedQueryParams = this.serializeQueryParams(queryParams);
    if (serializedQueryParams) {
      url += (url.includes("?") ? "&" : "?") + serializedQueryParams;
    }

    /** @type {Record<string, string>} */
    const requestHeaders = {
      "Content-Type": "application/json",
      ...headers,
    };

    return fetch(url, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : null,
      signal,
    })
      .then((response) => {
        if (!response.ok) {
          return response.text().then((text) => {
            /** @type {import('./client-error.js').ErrorResponse} */
            let parsedError = {};
            try {
              parsedError = JSON.parse(text);
            } catch (_) {
              parsedError = { message: text || "Unknown error" };
            }
            throw new ClientError({
              url: response.url,
              status: response.status,
              response: parsedError,
            });
          });
        }

        if (response.status === 204) {
          return {};
        }

        return response.json().catch(() => {
          throw new ClientError({
            url: response.url,
            status: response.status,
            response: { message: "Invalid JSON response" },
          });
        });
      })
      .catch((error) => {
        if (error instanceof ClientError) {
          throw error;
        }
        if (error.name === "AbortError") {
          throw new ClientError({
            url,
            isAbort: true,
            originalError: error,
            response: { message: "Request aborted" },
          });
        }
        throw new ClientError({
          url,
          originalError: error,
          response: { message: error.message || "Network or unknown error" },
        });
      });
  }

  /**
   * Builds a full URL by combining `baseUrl` and an optional `path`.
   *
   * Handles relative `baseUrl` values by resolving them against the
   * current browser location, so the method works correctly whether the
   * app is served from the root or a sub-directory.
   *
   * @param {string} baseUrl - Base URL (absolute or relative)
   * @param {string} [path] - Optional path segment to append
   * @returns {string} The fully resolved URL string
   *
   * @example
   * buildUrl("https://api.example.com", "/users") // "https://api.example.com/users"
   * buildUrl("/api", "users")                      // "https://current-host/api/users"
   * buildUrl("", "items")                          // relative to current directory
   */
  buildUrl(baseUrl, path) {
    if (baseUrl === "") {
      const pathParts = window.location.pathname.split("/");
      pathParts.pop();
      baseUrl = pathParts.join("/") + "/";
    }

    let url;
    if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
      const base = baseUrl.startsWith("/")
        ? window.location.origin
        : window.location.href;
      url = new URL(baseUrl, base).href;
    } else {
      url = baseUrl;
    }

    if (path) {
      url =
        url +
        (url.endsWith("/") ? "" : "/") +
        (path.startsWith("/") ? path.substring(1) : path);
    }

    return url;
  }

  /**
   * Serializes a params object into a URL-encoded query string.
   *
   * Type-specific encoding rules:
   * - `null` / `undefined` values are **skipped**
   * - `Date` → ISO 8601 string with `T` replaced by a space
   * - `Array` → repeated key entries: `colors=red&colors=blue`
   * - Plain `Object` → JSON-encoded and percent-encoded
   * - Primitives (string, number, boolean) → `String()` + percent-encoded
   *
   * @param {Record<string, * | *[]>} params - Parameters to serialize
   * @returns {string} URL-encoded query string (without the leading `?`)
   *
   * @example
   * serializeQueryParams({ name: "John Doe", age: 30 })
   * // "name=John%20Doe&age=30"
   *
   * @example
   * serializeQueryParams({ colors: ["red", "green"] })
   * // "colors=red&colors=green"
   *
   * @example
   * serializeQueryParams({ filter: { minPrice: 10 } })
   * // "filter=%7B%22minPrice%22%3A10%7D"
   *
   * @example
   * serializeQueryParams({ created: new Date("2025-03-21T12:00:00Z") })
   * // "created=2025-03-21%2012%3A00%3A00.000Z"
   *
   * @example
   * serializeQueryParams({ name: "Test", category: null })
   * // Returns: "name=Test" (category is skipped)
   *
   * @example
   * // Mixed parameter types
   * serializeQueryParams({
   *   id: 1234,
   *   tags: ["new", "featured"],
   *   metadata: { version: "1.0" },
   *   updated: new Date("2025-03-21")
   * })
   * // Returns a complex query string with all parameters properly encoded
   */
  serializeQueryParams(params) {
    const result = [];
    for (const key in params) {
      const encodedKey = encodeURIComponent(key);
      const values = Array.isArray(params[key]) ? params[key] : [params[key]];
      for (let value of values) {
        if (value === null || value === undefined) {
          continue;
        }
        if (value instanceof Date) {
          value = value.toISOString().replace("T", " ");
        } else if (typeof value === "object") {
          value = JSON.stringify(value);
        }
        result.push(`${encodedKey}=${encodeURIComponent(value)}`);
      }
    }
    return result.join("&");
  }
}
