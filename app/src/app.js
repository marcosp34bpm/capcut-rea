/**
 * Browser UI for the reconstructed editor.
 *
 * Every mutation goes through the same operation names the agent bridge uses,
 * and every mutation carries the expected revision the caller observed.
 */

const state = { draft: null, log: [] };

const el = (id) => document.getElementById(id);

const call = async (action, args = {}) => {
  const response = await fetch(`/api/${action}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ args }),
  });
  const payload = await response.json();
  if (!response.ok) {
    state.log.unshift(`✗ ${action} → ${payload.error?.code ?? response.status}`);
    renderLog();
    throw new Error(payload.error?.code ?? "request failed");
  }
  state.draft = payload.draft;
  state.log.unshift(`✓ ${action}`);
  renderLog();
  render();
  return payload.result;
};

const refresh = async () => {
  const response = await fetch("/api/state");
  const payload = await response.json();
  state.draft = payload.draft;
  render();
};

const formatUs = (value) => {
  const seconds = (value ?? 0) / 1_000_000;
  return `${seconds.toFixed(2)}s`;
};

const renderLog = () => {
  el("log").textContent = state.log.slice(0, 20).join("\n") || "sem operações ainda";
};

const renderAssets = () => {
  const container = el("assets");
  container.innerHTML = "";
  const select = el("asset-id");
  select.innerHTML = "";
  for (const asset of state.draft.assets) {
    const row = document.createElement("div");
    row.className = "row";
    row.innerHTML = `<span>${asset.name}</span><span class="pill">${asset.kind} · rev ${asset.revision}</span>`;
    container.append(row);
    const option = document.createElement("option");
    option.value = asset.assetId;
    option.textContent = `${asset.name} (rev ${asset.revision})`;
    select.append(option);
  }
};

const renderTracks = () => {
  const container = el("tracks");
  container.innerHTML = "";
  for (const track of state.draft.tracks) {
    const element = document.createElement("div");
    element.className = "track";
    const head = document.createElement("h3");
    head.innerHTML = `<span>${track.name}</span><span class="pill">${track.type}</span><span class="pill">${track.segments.length} seg</span>`;
    element.append(head);
    for (const segment of track.segments) {
      const seg = document.createElement("div");
      seg.className = "seg";
      seg.innerHTML = `<span>${segment.name}</span><span class="mono">${formatUs(segment.timelineStartUs)} → ${formatUs(segment.timelineStartUs + segment.timelineDurationUs)}</span>`;
      element.append(seg);
      for (const effect of segment.effects) {
        const eff = document.createElement("div");
        eff.className = "seg eff";
        eff.innerHTML = `<span>fx · ${effect.name}</span><span class="mono">${Object.keys(effect.params).join(", ") || "no params"}</span>`;
        element.append(eff);
      }
      for (const keyframe of segment.keyframes) {
        const key = document.createElement("div");
        key.className = "seg key";
        key.innerHTML = `<span>key · ${keyframe.property}</span><span class="mono">${formatUs(keyframe.timeUs)} = ${keyframe.value}</span>`;
        element.append(key);
      }
    }
    container.append(element);
  }
  if (state.draft.tracks.length === 0) {
    container.innerHTML = '<p class="hint">Nenhuma track. Use "add-track".</p>';
  }
};

const renderPreview = () => {
  const canvas = el("preview");
  const context = canvas.getContext("2d");
  const { width, height } = state.draft.canvas.size;
  context.fillStyle = "#0a0c10";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = canvas.width / width;
  for (const node of state.draft.canvas.nodes) {
    const layout = node.layout;
    context.save();
    context.globalAlpha = 0.85;
    context.fillStyle = node.type === "text" ? "#f0a13a" : "#4d7cfe";
    context.fillRect(
      layout.x * scale,
      layout.y * scale,
      Math.max(4, layout.width * scale),
      Math.max(4, layout.height * scale),
    );
    context.fillStyle = "#0d0f14";
    context.font = "10px ui-monospace, monospace";
    context.fillText(node.label, layout.x * scale + 4, layout.y * scale + 12);
    context.restore();
  }
};

const render = () => {
  const draft = state.draft;
  el("head-meta").innerHTML =
    `revisão <span class="mono">${draft.revision}</span> · ` +
    `canvas <span class="mono">${draft.canvasRevision}</span> · ` +
    `${draft.tracks.length} tracks · ${draft.canvas.nodes.length} nodes`;
  renderAssets();
  renderTracks();
  renderPreview();
};

const wire = () => {
  el("add-track").addEventListener("click", async () => {
    await call("timeline.add-track", { type: "video", name: "Vídeo 1" });
  });
  el("undo").addEventListener("click", async () => {
    await call("editor.undo", {});
  });
  el("refresh").addEventListener("click", refresh);
  el("insert").addEventListener("click", async () => {
    const asset = state.draft.assets.find(
      (candidate) => candidate.assetId === el("asset-id").value,
    );
    await call("timeline.add-draft", {
      assetId: asset.assetId,
      expectedAssetRevision: asset.revision,
      dryRun: true,
    });
  });
  el("insert-real").addEventListener("click", async () => {
    const asset = state.draft.assets.find(
      (candidate) => candidate.assetId === el("asset-id").value,
    );
    await call("timeline.add-draft", {
      assetId: asset.assetId,
      expectedAssetRevision: asset.revision,
      dryRun: false,
    });
  });
  el("add-node").addEventListener("click", async () => {
    await call("canvas.create-node", {
      type: "text",
      label: `Texto ${state.draft.canvas.nodes.length + 1}`,
    });
  });
  el("dup-node").addEventListener("click", async () => {
    const node = state.draft.canvas.nodes[0];
    if (!node) return;
    await call("canvas.duplicate-node", {
      objectId: node.objectId,
      expectedCanvasRevision: state.draft.canvasRevision,
    });
  });
  el("move-node").addEventListener("click", async () => {
    const node = state.draft.canvas.nodes[0];
    if (!node) return;
    await call("canvas.move-node", {
      objectId: node.objectId,
      expectedCanvasRevision: state.draft.canvasRevision,
      parentFrameId: null,
    });
  });
  el("del-node").addEventListener("click", async () => {
    const node = state.draft.canvas.nodes[0];
    if (!node) return;
    await call("canvas.delete-node", {
      objectId: node.objectId,
      expectedRevision: node.revision,
    });
  });
};

wire();
await refresh();
