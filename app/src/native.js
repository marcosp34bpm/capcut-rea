/**
 * Browser UI for the native engine.
 *
 * Every button issues a real `edit` operation against the shipped CapCut
 * engine through the native HTTP bridge.
 */

const el = (id) => document.getElementById(id);
const log = [];

const note = (line) => {
  log.unshift(line);
  el("log").textContent = log.slice(0, 24).join("\n");
};

const loadState = async () => {
  const response = await fetch("/api/state");
  const payload = await response.json();
  el("session").textContent = `sessão ${payload.sessionId}`;
  el("rev").textContent = `rev ${payload.draftRevision}`;
  return payload;
};

const edit = async (operation, params) => {
  const response = await fetch("/api/edit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operation, params }),
  });
  const payload = await response.json();
  if (!response.ok) {
    note(`✗ ${operation} → ${payload.error?.code ?? response.status}`);
    return null;
  }
  note(`✓ ${operation} (rev ${payload.draftRevision})`);
  return payload;
};

const renderTracks = (draft) => {
  const container = el("tracks");
  container.innerHTML = "";
  const tracks = draft?.tracks ?? [];
  if (tracks.length === 0) {
    container.innerHTML = '<p class="mono">nenhuma track no draft nativo</p>';
    return;
  }
  for (const track of tracks) {
    const head = document.createElement("div");
    head.className = "row";
    head.innerHTML = `<span>${track.type} track</span><span class="mono">${track.id.slice(0, 8)} · ${track.segments.length} seg</span>`;
    container.append(head);
    for (const segment of track.segments) {
      const seg = document.createElement("div");
      seg.className = "seg";
      const duration = (segment.source_timerange?.duration ?? 0) / 1_000_000;
      seg.innerHTML = `<span>${segment.id.slice(0, 8)}</span><span class="mono">${duration.toFixed(2)}s · speed ${segment.speed ?? 1}</span>`;
      container.append(seg);
    }
  }
  const trackSelect = el("track");
  const segmentSelect = el("segment");
  const previousTrack = trackSelect.value;
  const previousSegment = segmentSelect.value;
  trackSelect.innerHTML = "";
  segmentSelect.innerHTML = "";
  for (const track of tracks) {
    const option = document.createElement("option");
    option.value = track.id;
    option.textContent = `${track.type} ${track.id.slice(0, 8)}`;
    trackSelect.append(option);
    for (const segment of track.segments) {
      const segmentOption = document.createElement("option");
      segmentOption.value = segment.id;
      segmentOption.textContent = `${segment.id.slice(0, 12)} (${((segment.source_timerange?.duration ?? 0) / 1e6).toFixed(2)}s)`;
      segmentSelect.append(segmentOption);
    }
  }
  if (previousTrack) trackSelect.value = previousTrack;
  if (previousSegment) segmentSelect.value = previousSegment;
};

const renderFacts = (state) => {
  const rows = [
    ["status", state.status],
    ["kind", state.kind],
    ["duração", `${((state.durationUs ?? 0) / 1e6).toFixed(2)}s`],
    ["posição", `${((state.positionUs ?? 0) / 1e6).toFixed(2)}s`],
    ["frame", `${state.frameWidth}×${state.frameHeight}`],
    ["codec", state.sourceMedia?.codec ?? "—"],
    ["source", `${state.sourceMedia?.width}×${state.sourceMedia?.height}`],
    ["gpu", state.gpuAdapterSelection?.cefGpuState ?? "—"],
  ];
  el("facts").innerHTML = rows
    .map(([key, value]) => `<div class="row"><span>${key}</span><span class="mono">${value}</span></div>`)
    .join("");
};

const wire = () => {
  el("split").addEventListener("click", async () => {
    const payload = await edit("segment.split", {
      segment_id: el("segment").value,
      track_id: el("track").value,
      splitpos: Number(el("offset").value),
    });
    if (payload) renderTracks(payload.draft);
  });
  el("speed").addEventListener("click", async () => {
    const payload = await edit("video.setSpeed", {
      segment_id: el("segment").value,
      track_id: el("track").value,
      speed: 2.0,
    });
    if (payload) renderTracks(payload.draft);
  });
  el("mute").addEventListener("click", async () => {
    const payload = await edit("track.mute", { track_id: el("track").value });
    if (payload) renderTracks(payload.draft);
  });
  el("addvideo").addEventListener("click", async () => {
    const response = await fetch("/api/video-add", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        path: el("media").value,
        sourceDuration: Number(el("mediaduration").value),
        startTime: Number(el("offset").value),
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      note(`✗ video.add → ${payload.error?.code ?? response.status}`);
      return;
    }
    note(`✓ video.add (rev ${payload.draftRevision})`);
    renderTracks(payload.draft);
  });
  el("canundo").addEventListener("click", async () => {
    const payload = await edit("undoRedo.canUndo", {});
    if (payload) note(`  canUndo diff presente: ${payload.result?.diff !== undefined}`);
  });
  el("undo").addEventListener("click", async () => {
    const payload = await edit("undoRedo.undo", {});
    if (payload) renderTracks(payload.draft);
  });
  el("reload").addEventListener("click", refresh);
};

const refresh = async () => {
  const payload = await loadState();
  renderFacts(payload.state);
  const response = await fetch("/api/draft");
  const body = await response.json();
  renderTracks(body.draft);
};

wire();
await refresh();
