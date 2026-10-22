/**
 * Line-delimited JSON protocol between the MCP/CLI client and the native
 * engine host process.
 *
 * The shipped CapCut application runs its videoeditor engine in its own
 * process and talks to it over a local socket, exactly so that native console
 * output cannot corrupt the caller's channel. This module is the wire format
 * for that arrangement.
 */

/**
 * Encode one request as a single line.
 *
 * @param {Record<string, unknown>} message request payload
 * @returns {string} the framed line
 */
export const encode = (message) => `${JSON.stringify(message)}\n`;

/**
 * Decode one response line.
 *
 * @param {string} line one framed line
 * @returns {Record<string, unknown>} the decoded payload
 */
export const decode = (line) => JSON.parse(line);
