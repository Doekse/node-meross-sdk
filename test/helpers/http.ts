/**
 * Fetch Response stand-ins shared by cloud, LAN, and Session tests.
 */

/**
 * Builds a Fetch Response whose `text()` returns JSON or a raw string.
 *
 * @param body JSON-serializable value, or a string used as-is
 * @param status HTTP status
 * @param statusText Reason phrase
 */
export function jsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
        status,
        statusText,
        ok: status === 200,
        async text() {
            return text;
        }
    } as Response;
}

/**
 * Cloud HTTP 200 with `apiStatus: 0`. `data` is the field hosts persist.
 *
 * @param data Sign-in token or device-list payload
 */
export function ok(data: unknown): Response {
    return jsonResponse({ apiStatus: 0, data });
}
