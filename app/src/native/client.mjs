/**
 * Client for the native engine host process.
 *
 * Spawns `src/native/host.mjs`, connects to its local socket, and exposes the
 * same surface as the in-process `NativeEditor`, so the CLI, the HTTP server
 * and the MCP server all drive the real engine the same way.
 */

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { fileURLToPath } from "node:url";

import { NativeError } from "./editor.mjs";
import { decode, encode } from "./protocol.mjs";

const HOST_PATH = fileURLToPath(new URL("./host.mjs", import.meta.url));

/**
 * Open a connection to a native engine host process.
 *
 * @param {Record<string, string | undefined>} [environment] extra environment
 * @returns {Promise<object>} a remote editor handle
 */
export const openRemoteEditor = async (environment = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOST_PATH], {
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let readyBuffer = "";
    let settled = false;

    const fail = (cause) => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        cause instanceof Error
          ? cause
          : new NativeError("native_host_failed", String(cause)),
      );
    };

    child.stderr.on("data", () => {
      // Native diagnostics are not part of the protocol.
    });
    child.on("error", fail);
    child.on("exit", (code) => {
      if (!settled) {
        fail(
          new NativeError(
            "native_host_exited",
            `the native engine host exited with code ${code}`,
            { code },
          ),
        );
      }
    });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      readyBuffer += chunk;
      const index = readyBuffer.indexOf("\n");
      if (index < 0 || settled) return;
      const line = readyBuffer.slice(0, index).trim();
      readyBuffer = readyBuffer.slice(index + 1);
      let ready;
      try {
        ready = decode(line);
      } catch (cause) {
        fail(cause);
        return;
      }
      if (ready.ready !== true) {
        fail(new NativeError("native_host_not_ready", "the engine host did not report ready"));
        return;
      }
      settled = true;
      resolve(
        new RemoteEditor(child, ready.port, ready.sessionId, environment, {
          addonPath: ready.addonPath ?? null,
          capcutRoot: ready.capcutRoot ?? environment.CAPCUT_ROOT ?? null,
        }),
      );
    });
  });

/**
 * A remote handle on the native engine host.
 */
export class RemoteEditor {
  /**
   * @param {object} child the spawned host process
   * @param {number} port the host socket port
   * @param {string} sessionId the native session identifier
   * @param {Record<string, string | undefined>} environment host environment
   * @param {Record<string, unknown>} meta engine identity
   */
  constructor(child, port, sessionId, environment, meta = {}) {
    this.child = child;
    this.port = port;
    this.sessionId = sessionId;
    this.environment = environment;
    this.meta = meta;
    this.requestId = 0;
    this.pending = new Map();
    this.socket = createConnection({ port, host: "127.0.0.1" });
    this.socket.setEncoding("utf8");
    this.buffer = "";
    this.socket.on("data", (chunk) => {
      this.buffer += chunk;
      let index = this.buffer.indexOf("\n");
      while (index >= 0) {
        const line = this.buffer.slice(0, index).trim();
        this.buffer = this.buffer.slice(index + 1);
        if (line.length > 0) this.resolve(line);
        index = this.buffer.indexOf("\n");
      }
    });
    this.socket.on("error", (cause) => {
      for (const [, entry] of this.pending) {
        entry.reject(
          new NativeError("native_host_unreachable", cause.message, {}),
        );
      }
      this.pending.clear();
    });
  }

  /**
   * Resolve one framed response.
   *
   * @param {string} line one framed line
   * @returns {void}
   */
  resolve(line) {
    let message;
    try {
      message = decode(line);
    } catch {
      return;
    }
    const entry = this.pending.get(message.id);
    if (entry === undefined) return;
    this.pending.delete(message.id);
    if (message.ok === true) entry.resolve(message.result);
    else {
      entry.reject(
        new NativeError(
          message.error?.code ?? "native_request_failed",
          message.error?.message ?? "native request failed",
          message.error?.details ?? {},
        ),
      );
    }
  }

  /**
   * Send one request to the host and await its response.
   *
   * @param {Record<string, unknown>} request request payload
   * @returns {Promise<unknown>} the response payload
   */
  request(request) {
    this.requestId += 1;
    const id = this.requestId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(encode({ ...request, id }));
    });
  }

  /**
   * Read the live native player state.
   *
   * @returns {Promise<object>} the player state
   */
  async getState() {
    return this.request({ method: "state" });
  }

  /**
   * Read the canonical native draft.
   *
   * @returns {Promise<object | null>} the draft root
   */
  async readDraft() {
    return this.request({ method: "draft" });
  }

  /**
   * Run one native edit operation.
   *
   * @param {string} operation dotted operation key
   * @param {Record<string, unknown>} [params] operation parameters
   * @returns {Promise<object>} the operation result
   */
  async edit(operation, params = {}) {
    return this.request({ method: "edit", operation, params });
  }

  /**
   * Return the draft snapshot carried by the most recent diff.
   *
   * @returns {Promise<object | null>} the draft root
   */
  async getDraftSnapshot() {
    return this.request({ method: "snapshot" });
  }

  /**
   * Report the identity of the engine this handle drives.
   *
   * @returns {Promise<object>} the editor metadata
   */
  async getState_() {
    return { sessionId: this.sessionId };
  }

  /**
   * Close the host process.
   *
   * @returns {Promise<void>} resolves once the host is released
   */
  async close() {
    this.socket.destroy();
    this.child.kill();
  }
}
