/**
 * Creates a standardized error object for HTTP client requests
 * @param {Object} errData - Error data object
 * @param {string} [errData.url] - The URL that caused the error
 * @param {number} [errData.status] - HTTP status code
 * @param {boolean} [errData.isAbort] - Whether the request was aborted
 * @param {Error} [errData.originalError] - Original error object
 * @param {Object} [errData.response] - Response data from the server
 */
export class ClientResponseError extends Error {
  constructor(errData) {
    // Pass the message to parent Error constructor if available
    super(errData?.response?.message || "ClientResponseError");

    this.url = errData?.url || "";
    this.status = errData?.status || 0;
    // this is only meaningful with a requestJson with AbortController
    this.isAbort = Boolean(errData?.isAbort);
    this.originalError = errData?.originalError;
    this.response = errData?.response || {};
    this.name = "ClientResponseError " + this.status;
    this.message = this.response?.message; // Prioritize the server's message
    this.code = this.response?.code || "";
    /**
     * Field-level error details array from the API envelope.
     * 
     * Error response structure example:
     * {
     *   "status": 400,
     *   "code": "invalid_input", // Machine-readable 
     *   "message": "The request contains invalid data.", // Human-readable explanation
     *   "data?": [ // optional details
     *     {
     *       "code": "max_length",        // Machine-readable issue type
     *       "message": "Password exceeds maximum length of 20 characters", // Human-readable explanation
     *       "param?": "password",          // The param causing the issue (optional if not field-specific)
     *       "value?": "mypasswordiswaytoolong123", // Optional: the problematic input
     *     },
     *     {
     *       "code": "required",
     *       "message": "Username is required"
     *       "param?": "username",
     *     }
     *   ]
     * }
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
   * Returns form validation errors grouped by input name, ready for form rendering.
   *
   * @returns {Record<string, string[]>} e.g. { password: ["Too short", "Requires number"] }
   */
  get formErrors() {
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
