/**
 * Native CapCut editor bridge.
 *
 * Loads the shipped `videoeditor_addon.node` Node-API addon from the local
 * CapCut installation and drives the real editor engine through its
 * `initialize` / `invoke` contract.
 *
 * The addon was reverse-engineered with REA; the operation catalogue and the
 * request envelope below were recovered from the shipped
 * `videoeditor-service.mjs` and `app-server.mjs` runtime files, not guessed.
 *
 * Domains: `system`, `player`, `draft`, `edit`, `job`, `voice_input`.
 * The `edit` domain is the editor: every operation mutates the native draft
 * and returns a JSON diff against the draft root.
 */

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";

const require = createRequire(import.meta.url);

const DEFAULT_CAPCUT_ROOT =
  "C:\\Users\\marco\\AppData\\Local\\CapCut\\Apps\\9.6.0.4097";

/** Operations the native `edit` domain accepts, recovered from app-server.mjs. */
export const EDIT_OPERATIONS = {
  draft: [
    "setCanvasSize", "setCanvasBackground", "setCover", "clearCover",
    "setDraftName", "setDraftId", "setDraftUpdateTime", "ensureDraftCanvasSize",
    "updateDraftAIGCWatermark", "clearDraft", "setDraft", "setAlignMode",
    "setDraftKeywordsConfigs", "setVideoGeneratorType",
  ],
  track: ["add", "delete", "mute", "updateTrackName"],
  segment: [
    "move", "scale", "translate", "rotate", "updateLayout", "split", "insert",
    "delete", "mirror", "setTimeRange", "innerReplace", "innerReplaceStack",
    "paste", "visible", "mute", "setName", "duplicate", "setDescription",
    "multiSegmentsSetTimeRange",
  ],
  video: [
    "add", "setMaterial", "setMask", "clearMask", "setOpacity",
    "setBackgroundColor", "setBackgroundBlur", "setBackgroundImage",
    "clearBackground", "formatVideo", "setTransition", "updateTransition",
    "clearTransition", "setFade", "denoiseOn", "denoiseOff", "addAnimation",
    "updateAnimation", "deleteAnimation", "setSpeed", "pitchOn", "pitchOff",
    "setCurveSpeed", "seprateAudio", "setMatting", "clearMatting", "reverse",
    "crop", "muteOn", "muteOff", "setBasicColor", "resetBasicColor",
    "setVolume", "setFigure", "setMakeupRoot", "clearFigure", "setFigureFaceId",
    "setMix", "setChromaColor", "setChromaIntensity", "setChromaShadow",
    "setChromaEdgeSmooth", "setChromaSpill", "resetChroma", "applyAllChroma",
    "removeSmartCrop", "addSmartCrop", "setSmartColorAdjust", "setStable",
    "setVideoAlgorithm", "addDigitalHuman", "updateDigitalHuman",
    "updateDigitalHumanRendered", "addObjectLocked", "updateObjectLocked",
    "removeObjectLocked",
  ],
  audio: [
    "add", "setVolume", "setFade", "denoiseOn", "denoiseOff", "pitchOn",
    "pitchOff", "setVoiceEffect", "setVoiceEffectParams", "clearVoiceEffect",
    "setVoiceEffectToAll", "setVocalSeparation", "updateVocalSeparation",
    "removeVocalSeparation", "setVocalBeautify", "updateVocalBeautify",
    "resetVocalBeautify", "removeVocalBeautify", "setSpeed",
    "modifiedToneOn", "modifiedToneOff", "setMaterial", "addBeat", "removeBeat",
  ],
  text: [
    "add", "setMaterials", "addSubtitles", "setFixedSize", "addAnimation",
    "updateAnimation", "deleteAnimation", "addVideoTracker",
    "updateVideoTracker", "removeVideoTracker", "deleteTextToAudioIds",
    "updateSubtitleTemplate", "resetSubtitleTemplate", "updateEffect",
    "setSubtitleKeywords", "clearSubtitleKeywords",
  ],
  textTemplate: [
    "add", "setMaterial", "addAnimation", "updateAnimation", "deleteAnimation",
    "addVideoTracker", "updateVideoTracker", "removeVideoTracker",
  ],
  sticker: [
    "add", "addAnimation", "updateAnimation", "deleteAnimation",
    "addVideoTracker", "updateVideoTracker", "removeVideoTracker",
  ],
  effect: ["add", "updateAdjustParams", "resetAdjustParams"],
  filter: ["add", "update"],
  adjustment: ["add", "setBasicColor", "resetBasicColor"],
  keyframe: ["add", "delete", "update"],
  template: ["setMutableVideos", "setMutableAudios", "setMutableTexts", "setTemplateMute"],
  templateCombination: ["templateCombinationAdd", "replace", "setSize"],
  attachment: [
    "insertAsyncTasks", "deleteAsyncTasks", "updateAsyncTasksStatus",
    "insertVideoAlgorithms", "deleteVideoAlgorithms", "updateVideoAlgorithm",
    "insertAiWriterInfos", "deleteAiWriterInfos", "updateAiWriterInfo",
    "setAiCreatorContent", "updateAiCreation", "updateAiReel",
    "updateAiReelAgent",
  ],
  story: [
    "deleteAiStoryAlternative", "addAiStoryAlternativeMaterials",
    "cloneAiStoryAlternativeMaterials", "deleteAiStoryAlternativeMaterials",
    "updateAiStoryAlternativeMaterial", "pinAiStoryAlternativeMaterial",
    "updateMoveFeedsToAlternative", "updateStoryId", "innerReplace",
    "innerReplaceStack", "findInnerReplaceIds",
  ],
  undoRedo: ["undo", "redo", "canUndo", "canRedo", "getTopItemId", "resetUndoRedo"],
  batch: ["batchStart", "batchEnd", "freezeVideo"],
};

/** Flattened catalogue of every accepted `edit` operation key. */
export const EDIT_OPERATION_KEYS = Object.entries(EDIT_OPERATIONS).flatMap(
  ([group, operations]) => operations.map((operation) => `${group}.${operation}`),
);

/**
 * Parameter shapes confirmed against the shipped native engine.
 *
 * The native `edit` domain validates its parameters and answers with a typed
 * error when one is missing. The shapes below were confirmed by observing
 * those errors and the resulting native draft, not by guessing.
 */
export const PARAM_CONVENTIONS = {
  "track.mute": { required: ["track_id"] },
  "track.delete": { required: ["track_id"] },
  "track.updateTrackName": { required: ["track_id", "name"] },
  "segment.setTimeRange": { required: ["segment_id"], optional: ["start_time", "duration"] },
  "segment.split": { required: ["segment_id"], optional: ["splitpos", "splittime"] },
  "segment.delete": { required: ["segment_id"] },
  "segment.move": { required: ["segment_id"], optional: ["track_id"] },
  "segment.visible": { required: ["segment_id", "visible"] },
  "segment.setName": { required: ["segment_id", "name"] },
  "segment.multiSegmentsSetTimeRange": { required: ["segment_ids"] },
  "video.add": {
    required: ["path"],
    optional: ["sourceDuration", "sourceStartTime", "startTime", "trackIndex", "segmentId"],
  },
  "video.setSpeed": { required: ["segment_id"], optional: ["speed"] },
  "video.crop": { required: ["segment_id"], optional: ["crop"] },
  "video.setMatting": { required: ["segment_id"], optional: ["matting"] },
  "video.setOpacity": { required: ["segment_id"], optional: ["opacity"] },
  "video.setVolume": { required: ["segment_id"], optional: ["volume"] },
  "video.reverse": { required: ["segment_id"] },
  "video.setTransition": { required: ["segment_id"], optional: ["transition"] },
  "audio.add": { required: ["path"], optional: ["sourceDuration", "startTime", "trackIndex"] },
  "audio.setVolume": { required: ["segment_id"], optional: ["volume"] },
  "text.add": { required: ["content"], optional: ["seg_info", "time_range", "material"] },
  "draft.setCanvasSize": { optional: ["width", "height"] },
  "draft.setDraftName": { optional: ["name"], requires: ["draftSnapshot"] },
  "draft.setCover": { optional: ["cover"], requires: ["draftSnapshot"] },
  "undoRedo.undo": {},
  "undoRedo.redo": {},
  "undoRedo.canUndo": {},
  "undoRedo.canRedo": {},
  "keyframe.add": { required: ["segment_id"], optional: ["property", "time", "value"] },
};

/** Raised when the native addon rejects a request. */
export class NativeError extends Error {
  /**
   * @param {string} code native error code
   * @param {string} message native error message
   * @param {Record<string, unknown>} [details] extra context
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = "NativeError";
    this.code = code;
    this.details = details;
  }
}

/**
 * Resolve the local CapCut installation root.
 *
 * @param {string} [root] explicit root, or the `CAPCUT_ROOT` env value
 * @returns {string} the resolved root directory
 */
export const resolveCapCutRoot = (root) =>
  root ?? process.env.CAPCUT_ROOT ?? DEFAULT_CAPCUT_ROOT;

/**
 * Load and initialize the native editor addon.
 *
 * @param {string} [root] CapCut installation root
 * @returns {object} an initialized native session handle
 */
export const openNativeEditor = (root) => {
  const capcutRoot = resolveCapCutRoot(root);
  const addonPath = join(capcutRoot, "videoeditor_addon.node");
  if (!existsSync(addonPath)) {
    throw new NativeError(
      "native_addon_missing",
      `videoeditor_addon.node not found under ${capcutRoot}`,
      { addonPath, capcutRoot },
    );
  }
  const addon = require(addonPath);
  const modelsDir = join(capcutRoot, "Resources", "models");
  const initResult = addon.initialize(
    JSON.stringify({ modelsDir, algorithmConfigPath: "" }),
  );
  let details = initResult;
  if (typeof initResult === "string") {
    try {
      details = JSON.parse(initResult);
    } catch {
      details = { raw: initResult };
    }
  }
  if (details?.admissible === false) {
    throw new NativeError(
      "native_addon_not_admissible",
      details?.reason ?? "the native addon refused to initialize",
      { addonPath, details },
    );
  }
  return new NativeEditor(addon, { addonPath, capcutRoot, details });
};

/**
 * A live native editor session.
 *
 * Owns one `player` session of kind `draft` and routes `edit` operations to
 * the native engine.
 */
export class NativeEditor {
  /**
   * @param {object} addon the loaded Node-API addon
   * @param {Record<string, unknown>} meta addon path and init details
   */
  constructor(addon, meta) {
    this.addon = addon;
    this.meta = meta;
    this.sessionId = null;
    this.requestId = 0;
    this.draftRevision = 0;
    this.lastDiff = null;
    this.snapshot = null;
  }

  /**
   * Send one envelope to the native engine.
   *
   * @param {Record<string, unknown>} envelope request envelope
   * @returns {Promise<object>} the parsed native response
   */
  async send(envelope) {
    this.requestId += 1;
    const payload = await this.addon.invoke(
      JSON.stringify({ id: `req-${this.requestId}`, protocolVersion: 1, ...envelope }),
    );
    let parsed = payload;
    if (typeof payload === "string") {
      try {
        parsed = JSON.parse(payload);
      } catch {
        parsed = { raw: payload };
      }
    }
    if (parsed?.accepted === false) {
      throw new NativeError(
        parsed.error ?? "native_request_failed",
        parsed.message ?? `native request failed: ${envelope.operation ?? envelope.method}`,
        { request: { domain: envelope.domain, operation: envelope.operation ?? envelope.method } },
      );
    }
    return parsed;
  }

  /**
   * Create a native `player` session of the given kind.
   *
   * @param {string} [kind] session kind; `draft` is the editor
   * @returns {Promise<object>} the creation result
   */
  async createSession(kind = "draft") {
    const created = await this.send({
      domain: "player",
      operation: "create",
      params: { kind },
      priority: "interactive",
    });
    this.sessionId = created.sessionId;
    return created;
  }

  /**
   * Load a draft file into the current session.
   *
   * @param {string} draftPath absolute path of a `draft_content.json`
   * @returns {Promise<object>} the load result
   */
  async loadDraft(draftPath) {
    if (this.sessionId === null) await this.createSession("draft");
    const result = await this.send({
      domain: "player",
      operation: "load",
      params: { draftPath },
      sessionId: this.sessionId,
      priority: "interactive",
    });
    this.draftRevision = 0;
    return result;
  }

  /**
   * Read the current player state.
   *
   * @returns {Promise<object>} the player state
   */
  async getState() {
    return this.send({
      domain: "player",
      method: "getState",
      params: {},
      sessionId: this.sessionId,
      priority: "interactive",
    });
  }

  /**
   * Run one `edit` operation against the native draft.
   *
   * @param {string} operation dotted operation key, for example `segment.split`
   * @param {Record<string, unknown>} [params] operation parameters
   * @returns {Promise<object>} the operation result, including the draft diff
   */
  async edit(operation, params = {}) {
    if (!EDIT_OPERATION_KEYS.includes(operation)) {
      throw new NativeError(
        "unsupported_operation",
        `the native edit domain does not accept: ${operation}`,
        { operation },
      );
    }
    const result = await this.send({
      domain: "edit",
      operation,
      params,
      sessionId: this.sessionId,
      targetId: this.sessionId,
      priority: "interactive",
    });
    if (result.diff) {
      this.lastDiff = result.diff;
      this.draftRevision = result.diff.revision ?? this.draftRevision + 1;
      this.captureSnapshot();
    }
    return result;
  }

  /**
   * Store the draft root carried by the most recent diff, when present.
   *
   * @returns {object | null} the stored draft root
   */
  captureSnapshot() {
    const operations = this.lastDiff?.operations ?? [];
    for (const operation of operations) {
      if (operation.entity === "draft" && operation.op === "replace") {
        this.snapshot = operation.value;
        return this.snapshot;
      }
    }
    return null;
  }

  /**
   * Read the canonical native draft.
   *
   * The native `edit` domain returns the whole draft root in its diff, so a
   * read-only operation is issued to materialize it.
   *
   * @returns {Promise<object | null>} the canonical draft root
   */
  async readDraft() {
    if (this.snapshot !== null) return this.snapshot;
    await this.edit("draft.setCanvasSize", {});
    return this.snapshot;
  }

  /**
   * Return the draft snapshot carried by the most recent diff.
   *
   * @returns {object | null} the draft root, when a diff carried one
   */
  getDraftSnapshot() {
    return this.captureSnapshot() ?? this.snapshot ?? null;
  }

  /**
   * Read one decoded frame from the native player.
   *
   * @param {number} [index] frame slot index
   * @returns {Promise<{ bytes: number } | null>} the frame description
   */
  async readFrame(index = 0) {
    if (this.sessionId === null) return null;
    try {
      const frame = await this.addon.readFrame?.(this.sessionId, index);
      if (frame === undefined || frame === null) return null;
      const data = frame.data ?? frame;
      const length = Array.isArray(data) ? data.length : (data?.length ?? 0);
      if (length === 0) return null;
      return { bytes: length };
    } catch {
      return null;
    }
  }

  /**
   * Close the native session and shut the addon down.
   *
   * @returns {Promise<void>} resolves once the addon is released
   */
  async close() {
    try {
      await this.addon.shutdown?.();
    } catch {
      // The addon may already be gone; the session is closed either way.
    }
    this.sessionId = null;
  }
}
