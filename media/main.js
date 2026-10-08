const vscode = acquireVsCodeApi();

const repoSelect = document.getElementById("repo");
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
const logEl = document.getElementById("log");
const langSelect = document.getElementById("lang");

let running = false;
let runningMode = "";
let currentVersion = "";
let locale = "en";
let i18n = {};
let lastRepoState = null;

refreshBtn.addEventListener("click", () => vscode.postMessage({ type: "refresh" }));
repoSelect.addEventListener("change", () => {
  vscode.postMessage({ type: "selectRepo", path: repoSelect.value });
});
versionInput.addEventListener("input", () => updateHint(versionInput.value));
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
[reuse, dryRun, deleteMerged, deleteRelease].forEach((box) => {
  box.addEventListener("change", persistHeaderTools);
});

startBtn.addEventListener("click", () => {
  if (running) return;
  const version = versionInput.value.trim();
  if (!version) {
    appendLog("error", msg("enterVersion"));
    return;
  }
  vscode.postMessage({
    type: "start",
    repoPath: repoSelect.value,
    version,
    mergeBranches: checked(mergeBox),
    targetBranches: checked(targetBox),
    reuseReleaseBranch: reuse.checked,
    dryRun: dryRun.checked,
    deleteMergedBranches: deleteMerged.checked,
    deleteReleaseBranch: deleteRelease.checked,
  });
  setRunning(true, "start");
});

resumeBtn.addEventListener("click", () => {
  if (running) return;
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
  vscode.postMessage({
    type: "resumeTag",
    repoPath: repoSelect.value,
    version,
    targetBranches,
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
  if (data.type === "repoState") {
    lastRepoState = data;
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
      fromVersion.textContent = "—";
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
    fillChecks(mergeBox, data.branches, data.savedMerge || [], mergeSelected);
    fillChecks(targetBox, data.branches, data.savedTargets || defaultTargets(data.branches), targetSelected);
    filterChecks(mergeBox, "", mergeEmpty);
    filterChecks(targetBox, "", targetEmpty);
    return;
  }
  if (data.type === "log") {
    appendLog(data.level, data.message);
    return;
  }
  if (data.type === "done") {
    setRunning(false);
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
  if (lastRepoState) applyRepoPills(lastRepoState);
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
      persistSelection();
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
      persistSelection();
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
  return ["develop", "unstable", "staging"].filter((name) => branches.includes(name));
}

function applyHeaderTools(tools) {
  if (!tools) return;
  reuse.checked = Boolean(tools.reuseRelease);
  dryRun.checked = Boolean(tools.dryRun);
  deleteMerged.checked = Boolean(tools.deleteMerged);
  deleteRelease.checked = Boolean(tools.deleteRelease);
}

function persistHeaderTools() {
  vscode.postMessage({
    type: "saveHeaderTools",
    tools: {
      reuseRelease: reuse.checked,
      dryRun: dryRun.checked,
      deleteMerged: deleteMerged.checked,
      deleteRelease: deleteRelease.checked,
    },
  });
}

function persistSelection() {
  if (!repoSelect.value) return;
  vscode.postMessage({
    type: "saveSelection",
    repoPath: repoSelect.value,
    mergeBranches: checked(mergeBox),
    targetBranches: checked(targetBox),
  });
}

function appendLog(level, message) {
  const line = document.createElement("div");
  line.className = `log-${level}`;
  line.textContent = message;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setRunning(value, mode) {
  running = value;
  runningMode = value ? mode || "" : "";
  startBtn.disabled = value;
  resumeBtn.disabled = value;
  startBtn.textContent = value && runningMode === "start" ? msg("running") : msg("startRelease");
  resumeBtn.textContent = value && runningMode === "resume" ? msg("resumeMergeRunning") : msg("resumeMergeTag");
}

vscode.postMessage({ type: "ready" });
