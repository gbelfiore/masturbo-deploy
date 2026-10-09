const vscode = acquireVsCodeApi();

const repoSelect = document.getElementById("repo");
const sourceSelect = document.getElementById("sourceBranch");
const repoMeta = document.getElementById("repoMeta");
const fromVersion = document.getElementById("fromVersion");
const versionInput = document.getElementById("version");
const versionHint = document.getElementById("versionHint");
const mergeBox = document.getElementById("mergeBranches");
const targetBox = document.getElementById("targetBranches");
const mergeSearch = document.getElementById("mergeSearch");
const targetSearch = document.getElementById("targetSearch");
const mergeEmpty = document.getElementById("mergeEmpty");
const targetEmpty = document.getElementById("targetEmpty");
const mergeSelected = document.getElementById("mergeSelected");
const targetSelected = document.getElementById("targetSelected");
const reuse = document.getElementById("reuse");
const dryRun = document.getElementById("dryRun");
const deleteMerged = document.getElementById("deleteMerged");
const deleteRelease = document.getElementById("deleteRelease");
const startBtn = document.getElementById("start");
const resumeBtn = document.getElementById("resumeTag");
const refreshBtn = document.getElementById("refresh");
const refreshAllBtn = document.getElementById("refreshAll");
const logEl = document.getElementById("log");
const langSelect = document.getElementById("lang");
const navRelease = document.getElementById("navRelease");
const navHistory = document.getElementById("navHistory");
const pageRelease = document.getElementById("page-release");
const pageHistory = document.getElementById("page-history");
const historyList = document.getElementById("historyList");
const historyEmpty = document.getElementById("historyEmpty");
const releaseNotes = document.getElementById("releaseNotes");
const generateNotesBtn = document.getElementById("generateNotes");

let running = false;
let runningMode = "";
let loadBusy = true;
let releaseDone = false;
let mergeFailed = false;
let currentVersion = "";
let locale = "en";
let i18n = {};
let lastRepoState = null;
let lastHistory = [];
let lastHistoryError = "";
let selectedHistoryId = "";
let generatingNotes = false;

refreshBtn.addEventListener("click", () => vscode.postMessage({ type: "refresh", repoPath: repoSelect.value }));
refreshAllBtn.addEventListener("click", () => vscode.postMessage({ type: "refresh", repoPath: repoSelect.value }));
repoSelect.addEventListener("change", () => {
  vscode.postMessage({ type: "selectRepo", path: repoSelect.value });
});
versionInput.addEventListener("input", () => updateHint(versionInput.value));
releaseNotes.addEventListener("input", persistSelection);
mergeSearch.addEventListener("input", () => filterChecks(mergeBox, mergeSearch.value, mergeEmpty));
targetSearch.addEventListener("input", () => filterChecks(targetBox, targetSearch.value, targetEmpty));
document.querySelectorAll("[data-tree]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tree = document.getElementById(btn.dataset.tree);
    if (tree) setCollapsed(tree, btn.dataset.collapse === "true");
  });
});

langSelect.addEventListener("change", () => {
  vscode.postMessage({ type: "setLanguage", locale: langSelect.value });
});
navRelease.addEventListener("click", () => showPage("release"));
navHistory.addEventListener("click", () => {
  showPage("history");
  vscode.postMessage({ type: "refreshHistory" });
});
[reuse, dryRun, deleteMerged, deleteRelease].forEach((box) => {
  box.addEventListener("change", persistHeaderTools);
  box.addEventListener("click", persistHeaderTools);
});
const rememberedTools = vscode.getState()?.headerTools;
if (rememberedTools) {
  applyHeaderTools(rememberedTools);
}

startBtn.addEventListener("click", () => {
  if (running || loadBusy || releaseDone) return;
  const version = versionInput.value.trim();
  if (!version) {
    appendLog("error", msg("enterVersion"));
    return;
  }
  if (!sourceSelect.value) {
    appendLog("error", msg("enterSource"));
    return;
  }
  clearLog();
  vscode.postMessage({
    type: "start",
    repoPath: repoSelect.value,
    version,
    mergeBranches: checked(mergeBox),
    targetBranches: checked(targetBox),
    sourceBranch: sourceSelect.value,
    releaseNotes: releaseNotes.value,
    reuseReleaseBranch: reuse.checked,
    dryRun: dryRun.checked,
    deleteMergedBranches: deleteMerged.checked,
    deleteReleaseBranch: deleteRelease.checked,
  });
  setRunning(true, "start");
});

generateNotesBtn.addEventListener("click", () => {
  if (generatingNotes || running || loadBusy || !repoSelect.value) return;
  generatingNotes = true;
  generateNotesBtn.disabled = true;
  vscode.postMessage({
    type: "generateNotes",
    repoPath: repoSelect.value,
    version: versionInput.value.trim(),
  });
});

resumeBtn.addEventListener("click", () => {
  if (running || loadBusy || !mergeFailed) return;
  const version = versionInput.value.trim();
  if (!version) {
    appendLog("error", msg("enterVersion"));
    return;
  }
  const targetBranches = checked(targetBox);
  if (!targetBranches.length) {
    appendLog("error", msg("noTargetBranches"));
    return;
  }
  clearLog();
  vscode.postMessage({
    type: "resumeTag",
    repoPath: repoSelect.value,
    version,
    targetBranches,
    releaseNotes: releaseNotes.value,
    dryRun: dryRun.checked,
  });
  setRunning(true, "resume");
});

window.addEventListener("message", (event) => {
  const data = event.data;
  if (data.type === "i18n") {
    locale = data.locale || "en";
    i18n = data.messages || {};
    langSelect.value = locale;
    applyI18n();
    return;
  }
  if (data.type === "headerTools") {
    applyHeaderTools(data.tools);
    const state = vscode.getState() || {};
    vscode.setState({ ...state, headerTools: currentHeaderTools() });
    return;
  }
  if (data.type === "history") {
    lastHistory = data.records || [];
    lastHistoryError = data.error || "";
    renderHistory();
    return;
  }
  if (data.type === "repos") {
    lastRepoState = data.repos.length ? lastRepoState : { error: msg("noGitRepo") };
    repoSelect.innerHTML = "";
    for (const repo of data.repos) {
      const option = document.createElement("option");
      option.value = repo.path;
      option.textContent = `${repo.name} — ${repo.path}`;
      if (repo.path === data.selected) option.selected = true;
      repoSelect.appendChild(option);
    }
    if (!data.repos.length) {
      setPills([msg("noGitRepo")]);
    }
    return;
  }
  if (data.type === "repoLoading") {
    loadBusy = true;
    releaseDone = false;
    mergeFailed = false;
    generatingNotes = false;
    updateActionButtons();
    return;
  }
  if (data.type === "repoState") {
    lastRepoState = data;
    loadBusy = false;
    releaseDone = false;
    mergeFailed = false;
    if (data.error) {
      setPills([data.error], true);
      mergeBox.innerHTML = "";
      targetBox.innerHTML = "";
      mergeSearch.value = "";
      targetSearch.value = "";
      mergeEmpty.classList.add("hidden");
      targetEmpty.classList.add("hidden");
      mergeSelected.innerHTML = "";
      targetSelected.innerHTML = "";
      sourceSelect.innerHTML = "";
      releaseNotes.value = "";
      fromVersion.textContent = "—";
      updateActionButtons();
      return;
    }
    currentVersion = data.currentVersion || "";
    fromVersion.textContent = currentVersion || msg("na");
    versionInput.value = currentVersion ? nextPatch(currentVersion) : "";
    versionInput.placeholder = currentVersion ? nextPatch(currentVersion) : "x.y.z";
    updateHint(versionInput.value);
    applyRepoPills(data);
    mergeSearch.value = "";
    targetSearch.value = "";
    fillSourceSelect(data.branches, data.savedSource || defaultSource(data.branches));
    fillChecks(mergeBox, data.branches, [], mergeSelected);
    fillChecks(targetBox, data.branches, data.savedTargets || defaultTargets(data.branches), targetSelected);
    setCollapsed(mergeBox, true);
    setCollapsed(targetBox, true);
    filterChecks(mergeBox, "", mergeEmpty);
    filterChecks(targetBox, "", targetEmpty);
    releaseNotes.value = data.savedNotes || "";
    if (data.tools) applyHeaderTools(data.tools);
    updateActionButtons();
    return;
  }
  if (data.type === "notesGenerated") {
    generatingNotes = false;
    if (data.text) {
      releaseNotes.value = data.text;
      persistSelection();
    }
    updateActionButtons();
    return;
  }
  if (data.type === "log") {
    appendLog(data.level, data.message);
    if (data.level === "warn" && generatingNotes) {
      generatingNotes = false;
      updateActionButtons();
    }
    return;
  }
  if (data.type === "done") {
    setRunning(false);
    releaseDone = data.ok === true;
    mergeFailed = data.conflict === true;
    updateActionButtons();
  }
});

function msg(key, vars) {
  let text = i18n[key] || key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(value);
    }
  }
  return text;
}

function applyI18n() {
  document.documentElement.lang = locale;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = msg(el.dataset.i18n);
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = msg(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll(".chevron").forEach((el) => {
    el.title = msg("expandCollapse");
  });
  document.querySelectorAll(".badge-x").forEach((el) => {
    el.title = msg("remove");
  });
  updateHint(versionInput.value);
  startBtn.textContent = running && runningMode === "start" ? msg("running") : msg("startRelease");
  resumeBtn.textContent = running && runningMode === "resume" ? msg("resumeMergeRunning") : msg("resumeMergeTag");
  updateActionButtons();
  if (lastRepoState) applyRepoPills(lastRepoState);
  renderHistory();
}

function applyRepoPills(state) {
  if (state.error) {
    setPills([state.error], true);
    return;
  }
  const pills = [
    msg("pillBranch", { name: state.current }),
    msg("pillBase", { name: state.source }),
    msg("pillProduction", { name: state.production }),
  ];
  if (state.mtDeploy) pills.push(msg("pillMtDeploy"));
  if (state.dirty) pills.push(msg("dirtyTree"));
  setPills(pills, Boolean(state.dirty));
}

function updateHint(version) {
  const from = currentVersion || "x.y.z";
  const to = (version || "").trim() || "x.y.z";
  versionHint.innerHTML = msg("versionHint", { from, to });
}

function nextPatch(version) {
  const parts = version.replace(/^v/i, "").split(".");
  const last = Number.parseInt(parts[parts.length - 1], 10);
  if (Number.isNaN(last)) return "";
  parts[parts.length - 1] = String(last + 1);
  return parts.join(".");
}

function setPills(items, warnLast) {
  repoMeta.innerHTML = "";
  items.forEach((item, index) => {
    const pill = document.createElement("span");
    pill.className = warnLast && index === items.length - 1 ? "pill warn" : "pill";
    pill.textContent = item;
    repoMeta.appendChild(pill);
  });
}

function buildTree(branches) {
  const root = { name: "", children: new Map(), branch: null };
  for (const branch of branches) {
    const parts = branch.split("/").filter(Boolean);
    if (!parts.length) continue;
    let node = root;
    parts.forEach((part, index) => {
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, children: new Map(), branch: null });
      }
      node = node.children.get(part);
      if (index === parts.length - 1) {
        node.branch = branch;
      }
    });
  }
  return root;
}

function sortNodes(a, b) {
  const aFolder = a.children.size > 0;
  const bFolder = b.children.size > 0;
  if (aFolder !== bFolder) return aFolder ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function fillChecks(container, branches, selected, badgesEl) {
  container.innerHTML = "";
  container.classList.add("tree");
  container._badges = badgesEl;
  const root = buildTree(branches);
  for (const child of [...root.children.values()].sort(sortNodes)) {
    container.appendChild(renderNode(child, selected, 0));
  }
  bindTree(container);
  renderSelected(container);
}

function renderNode(node, selected, depth) {
  const hasKids = node.children.size > 0;
  const wrap = document.createElement("div");
  wrap.className = `tree-node${hasKids ? "" : " is-leaf"}`;
  wrap.dataset.search = `${node.name} ${node.branch || ""}`.toLowerCase();
  wrap.dataset.full = (node.branch || "").toLowerCase();

  const row = document.createElement("div");
  row.className = `tree-row ${hasKids ? "folder" : "leaf"}`;
  row.style.paddingLeft = `${8 + depth * 16}px`;

  if (hasKids) {
    const chevron = document.createElement("button");
    chevron.type = "button";
    chevron.className = "chevron";
    chevron.title = msg("expandCollapse");
    row.appendChild(chevron);
  } else {
    const spacer = document.createElement("span");
    spacer.className = "chevron-spacer";
    row.appendChild(spacer);
  }

  const name = document.createElement("span");
  name.className = "tree-name";
  name.textContent = node.name;
  name.title = node.branch || node.name;
  row.appendChild(name);

  if (!hasKids && node.branch) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "round-check";
    input.value = node.branch;
    input.dataset.branch = node.branch;
    input.checked = selected.includes(node.branch);
    row.appendChild(input);
  }

  wrap.appendChild(row);

  if (hasKids) {
    const kids = document.createElement("div");
    kids.className = "tree-children";
    for (const child of [...node.children.values()].sort(sortNodes)) {
      kids.appendChild(renderNode(child, selected, depth + 1));
    }
    wrap.appendChild(kids);
  }
  return wrap;
}

function setCollapsed(container, collapsed) {
  container.querySelectorAll(".tree-node:not(.is-leaf)").forEach((node) => {
    node.classList.toggle("collapsed", collapsed);
  });
}

function bindTree(container) {
  container.querySelectorAll(".chevron").forEach((btn) => {
    btn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      btn.closest(".tree-node").classList.toggle("collapsed");
    });
  });
  container.querySelectorAll("input[data-branch]").forEach((box) => {
    box.addEventListener("change", () => {
      renderSelected(container);
    });
  });
  renderSelected(container);
}

function renderSelected(container) {
  const badgesEl = container._badges;
  if (!badgesEl) return;
  const values = checked(container);
  badgesEl.innerHTML = "";
  for (const value of values) {
    const badge = document.createElement("span");
    badge.className = "selected-badge";
    const text = document.createElement("span");
    text.textContent = value;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "badge-x";
    remove.title = msg("remove");
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      const input = [...container.querySelectorAll("input[data-branch]")].find((el) => el.dataset.branch === value);
      if (input) input.checked = false;
      renderSelected(container);
    });
    badge.append(text, remove);
    badgesEl.appendChild(badge);
  }
}

function filterChecks(container, query, emptyEl) {
  const q = (query || "").trim().toLowerCase();
  const matchNode = (el) => {
    const kidsWrap = el.querySelector(":scope > .tree-children");
    const kids = kidsWrap ? [...kidsWrap.children].filter((child) => child.classList.contains("tree-node")) : [];
    const text = `${el.dataset.search || ""} ${el.dataset.full || ""}`;
    const self = !q || text.includes(q);
    let childHit = false;
    for (const kid of kids) {
      if (matchNode(kid)) childHit = true;
    }
    const show = !q || self || childHit;
    el.classList.toggle("hidden", !show);
    if (q && show) el.classList.remove("collapsed");
    if (q && self) {
      el.querySelectorAll(".tree-node").forEach((desc) => desc.classList.remove("hidden"));
    }
    return show;
  };
  for (const node of [...container.children].filter((child) => child.classList.contains("tree-node"))) {
    matchNode(node);
  }
  const visibleLeaves = [...container.querySelectorAll(".tree-node.is-leaf")].filter((el) => !el.classList.contains("hidden"));
  const visibleFolders = [...container.querySelectorAll(".tree-node")].filter((el) => !el.classList.contains("hidden") && !el.classList.contains("is-leaf"));
  emptyEl.classList.toggle("hidden", visibleLeaves.length + visibleFolders.length > 0);
}

function checked(container) {
  return [...container.querySelectorAll("input[data-branch]:checked")].map((el) => el.value);
}

function defaultTargets(branches) {
  return ["develop", "unstable", "staging", "production"].filter((name) => branches.includes(name));
}

function defaultSource(branches) {
  if (branches.includes("develop")) return "develop";
  if (branches.includes("dev")) return "dev";
  return branches[0] || "";
}

function fillSourceSelect(branches, selected) {
  sourceSelect.innerHTML = "";
  const pick = selected && branches.includes(selected) ? selected : defaultSource(branches);
  for (const branch of branches) {
    const option = document.createElement("option");
    option.value = branch;
    option.textContent = branch;
    if (branch === pick) option.selected = true;
    sourceSelect.appendChild(option);
  }
}

function currentHeaderTools() {
  return {
    reuseRelease: reuse.checked === true,
    dryRun: dryRun.checked === true,
    deleteMerged: deleteMerged.checked === true,
    deleteRelease: deleteRelease.checked === true,
  };
}

function applyHeaderTools(tools) {
  if (!tools) return;
  reuse.checked = tools.reuseRelease === true;
  dryRun.checked = tools.dryRun === true;
  deleteMerged.checked = tools.deleteMerged === true;
  deleteRelease.checked = tools.deleteRelease === true;
}

function persistHeaderTools() {
  const tools = currentHeaderTools();
  const state = vscode.getState() || {};
  vscode.setState({ ...state, headerTools: tools });
  vscode.postMessage({
    type: "saveHeaderTools",
    tools,
  });
}

function persistSelection() {
  if (!repoSelect.value) return;
  vscode.postMessage({
    type: "saveSelection",
    repoPath: repoSelect.value,
    releaseNotes: releaseNotes.value,
  });
}

function showPage(name) {
  const history = name === "history";
  pageRelease.classList.toggle("hidden", history);
  pageHistory.classList.toggle("hidden", !history);
  navRelease.classList.toggle("is-active", !history);
  navHistory.classList.toggle("is-active", history);
}

function renderHistory() {
  const records = lastHistory || [];
  if (lastHistoryError) {
    historyEmpty.textContent = lastHistoryError;
  } else {
    historyEmpty.textContent = msg("historyEmpty");
  }
  historyEmpty.classList.toggle("hidden", records.length > 0);
  historyList.innerHTML = "";
  for (const record of records) {
    const open = record.id === selectedHistoryId;
    const item = document.createElement("div");
    item.className = `history-item${open ? " is-active" : ""}`;
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "history-item-toggle";
    const head = document.createElement("div");
    head.className = "history-item-head";
    const tag = document.createElement("strong");
    tag.textContent = record.tag || msg("na");
    const status = document.createElement("span");
    status.className = `pill${record.hasLocal && record.ok === false ? " warn" : ""}`;
    status.textContent = record.hasLocal
      ? record.dryRun
        ? msg("historyDry")
        : record.ok
          ? msg("historyOk")
          : msg("historyFail")
      : msg("historyGithub");
    head.append(tag, status);
    const info = document.createElement("div");
    info.className = "history-item-info";
    const kind = record.hasLocal
      ? record.kind === "resume"
        ? msg("historyKindResume")
        : msg("historyKindRelease")
      : "";
    const who = record.author ? record.author : "";
    info.textContent = [record.repoName, formatWhen(record.at), kind, who].filter(Boolean).join(" · ");
    toggle.append(head, info);
    toggle.addEventListener("click", () => {
      selectedHistoryId = open ? "" : record.id;
      renderHistory();
    });
    item.appendChild(toggle);
    if (open) item.appendChild(historyDetail(record));
    historyList.appendChild(item);
  }
}

function historyDetail(record) {
  const detail = document.createElement("div");
  detail.className = "history-item-detail";
  const meta = document.createElement("div");
  meta.className = "history-meta";
  meta.appendChild(metaRow(msg("historyRepo"), record.repoName));
  meta.appendChild(metaRow(msg("historyWhen"), formatWhen(record.at)));
  if (record.author) meta.appendChild(metaRow(msg("historyAuthor"), record.author));
  if (record.hasLocal) {
    meta.appendChild(
      metaRow(
        msg("historyStatus"),
        record.dryRun ? msg("historyDry") : record.ok ? msg("historyOk") : msg("historyFail"),
        record.ok === false
      )
    );
    meta.appendChild(metaRow(msg("historyOrigin"), joinBranches(record.originBranches)));
    meta.appendChild(metaRow(msg("historyTarget"), joinBranches(record.targetBranches)));
  }
  detail.appendChild(meta);
  const notes = document.createElement("div");
  renderNotesPreview(notes, record.githubBody || "", {
    notes: msg("historyNotes"),
    empty: msg("historyNoNotes"),
    markdown: msg("historyKindMarkdown"),
    html: msg("historyKindHtml"),
    text: msg("historyKindText"),
    json: msg("historyKindJson"),
  });
  detail.appendChild(notes);
  if (record.githubUrl) {
    const link = document.createElement("button");
    link.type = "button";
    link.className = "secondary history-link";
    link.textContent = msg("historyOpenGithub");
    link.addEventListener("click", (event) => {
      event.stopPropagation();
      vscode.postMessage({ type: "openUrl", url: record.githubUrl });
    });
    detail.appendChild(link);
  }
  if (record.hasLocal && record.logs && record.logs.length) {
    const log = document.createElement("div");
    log.className = "log-view";
    for (const line of record.logs) {
      log.appendChild(logItem(line.level, line.message));
    }
    detail.appendChild(log);
  }
  return detail;
}

function metaRow(label, value, warn) {
  const row = document.createElement("div");
  row.className = "history-meta-row";
  const name = document.createElement("span");
  name.textContent = label;
  const val = document.createElement("strong");
  val.className = warn ? "is-warn" : "";
  val.textContent = value;
  row.append(name, val);
  return row;
}

function joinBranches(values) {
  return values && values.length ? values.join(", ") : msg("na");
}

function formatWhen(at) {
  try {
    return new Date(at).toLocaleString(locale);
  } catch {
    return String(at);
  }
}

function clearLog() {
  logEl.innerHTML = "";
}

function logItem(level, message) {
  const item = document.createElement("div");
  item.className = `log-item log-${level}`;
  const mark = document.createElement("span");
  mark.className = "log-mark";
  mark.textContent = level === "ok" ? "✓" : level === "error" ? "✕" : level === "warn" ? "!" : "→";
  const body = document.createElement("div");
  body.className = "log-body";
  const lines = String(message || "").split("\n");
  const title = document.createElement("div");
  title.className = "log-title";
  title.textContent = lines[0] || "";
  body.appendChild(title);
  if (lines.length > 1) {
    const extra = document.createElement("pre");
    extra.className = "log-detail";
    extra.textContent = lines.slice(1).join("\n");
    body.appendChild(extra);
  }
  item.append(mark, body);
  return item;
}

function appendLog(level, message) {
  logEl.appendChild(logItem(level, message));
  logEl.scrollTop = logEl.scrollHeight;
}

function setRunning(value, mode) {
  running = value;
  runningMode = value ? mode || "" : "";
  updateActionButtons();
}

function updateActionButtons() {
  const busy = running || loadBusy;
  const hasRepo = Boolean(repoSelect.value) && lastRepoState && !lastRepoState.error;
  startBtn.disabled = busy || releaseDone || mergeFailed || !hasRepo;
  resumeBtn.disabled = busy || !mergeFailed || !hasRepo;
  generateNotesBtn.disabled = busy || generatingNotes || !hasRepo;
  generateNotesBtn.textContent = generatingNotes ? msg("generatingNotes") : msg("generateNotes");
  startBtn.textContent = running && runningMode === "start" ? msg("running") : msg("startRelease");
  resumeBtn.textContent = running && runningMode === "resume" ? msg("resumeMergeRunning") : msg("resumeMergeTag");
}

vscode.postMessage({ type: "ready" });
