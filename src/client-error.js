/**
 * @typedef {Object} ErrorDetail
 * A single field-level validation issue returned by the API.
 * @property {string} code - Machine-readable issue type (e.g. `"max_length"`, `"required"`)
 * @property {string} message - Human-readable explanation shown to the user
 * @property {string} [param] - The request parameter that caused the issue (omitted when not field-specific)
 * @property {*} [value] - The problematic input value, when provided by the server
 */

/**
 * @typedef {Object} ErrorResponse
 * Shape of the JSON body returned by the API on non-2xx responses.
 * @property {number} [status] - HTTP status code mirrored in the body
 * @property {string} [code] - Machine-readable top-level error code (e.g. `"invalid_input"`)
 * @property {string} [message] - Human-readable top-level explanation
 * @property {ErrorDetail[]} [data] - Optional array of field-level error details
 */

/**
 * @typedef {Object} ClientErrorData
 * Constructor payload for {@link ClientError}.
 * @property {string} [url] - The URL that caused the error
 * @property {number} [status] - HTTP status code (0 when no response was received)
 * @property {boolean} [isAbort] - Whether the request was aborted via `AbortController`
 * @property {Error} [originalError] - The underlying error before wrapping
 * @property {ErrorResponse} [response] - Parsed response body from the server
 */

/**
 * Standardized error class for all HTTP client failures.
 *
 * Every error thrown by {@link HttpClient} is an instance of this class, so
 * callers only need a single `catch` branch.  The {@link ClientError#formErrors}
 * getter makes it easy to feed field errors directly into form libraries.
 *
 * @example
 * try {
 *   await client.authWithPassword({ email, password });
 * } catch (err) {
 *   if (err instanceof ClientError) {
 *     if (err.status === 401) { ... }
 *     console.log(err.formErrors); // { email: ["Invalid email"] }
 *   }
 * }
 *
 * @extends {Error}
 */
export class ClientError extends Error {
  /**
   * @param {ClientErrorData} errData
   */
  constructor(errData) {
    super(errData?.response?.message || "ClientError");

    /** @type {string} URL of the failed request */
    this.url = errData?.url || "";

    /** @type {number} HTTP status code, or `0` if no response was received */
    this.status = errData?.status || 0;

    /**
     * `true` when the request was cancelled via `AbortController`.
     * Only meaningful when using `requestJson` with an `AbortSignal`.
     * @type {boolean}
     */
    this.isAbort = Boolean(errData?.isAbort);

    /** @type {Error|undefined} The original error before wrapping */
    this.originalError = errData?.originalError;

    /** @type {ErrorResponse} Parsed response body from the server */
    this.response = errData?.response || {};

    /** @type {string} Error name including the status code, e.g. `"ClientError 404"` */
    this.name = "ClientError " + this.status;

    /** @type {string} Human-readable message, preferring the server's message */
    this.message = this.response?.message;

    /** @type {string} Machine-readable top-level error code from the server */
    this.code = this.response?.code || "";

    /**
     * Field-level error details from the API envelope.
     *
     * Error response structure:
     * ```json
     * {
     *   "status": 400,
     *   "code": "invalid_input",
     *   "message": "The request contains invalid data.",
     *   "data": [
     *     { "code": "max_length", "message": "Password exceeds 20 chars", "param": "password" },
     *     { "code": "required",   "message": "Username is required",      "param": "username" }
     *   ]
     * }
     * ```
     * @type {ErrorDetail[]}
     */
    this.data = this.response?.data ?? [];

    if (!this.message) {
      if (this.isAbort) {
        this.message = "The request was autocancelled.";
      } else if (this.originalError?.cause?.message?.includes("ECONNREFUSED")) {
        this.message = "Failed to connect to the server";
      } else {
        this.message = "Something went wrong while processing your request.";
      }
    }
  }

  /**
   * Returns field-level validation errors grouped by parameter name,
   * ready to be fed into form libraries such as React Hook Form or Vuelidate.
   *
   * Only errors that carry a `param` are included; top-level errors
   * without a field association are ignored.
   *
   * @returns {Record<string, string[]>}
   *   A map of field name → list of error messages.
   *   e.g. `{ password: ["Too short", "Requires a number"] }`
   *
   * @example
   * } catch (err) {
   *   if (err instanceof ClientError) {
   *     setFormErrors(err.formErrors);
   *     // { email: ["Already taken"], password: ["Too short"] }
   *   }
   * }
   */
  get formErrors() {
    /** @type {Record<string, string[]>} */
    const errors = {};

    for (const err of this.data) {
      if (err.param) {
        errors[err.param] ??= [];
        errors[err.param].push(err.message);
      }
    }

    return errors;
  }
}
