import * as fs from "fs";
import * as path from "path";

export const MT_DIR = ".mtdeploy";
export const MT_CONFIG = ".mtconfig";
export const MT_HISTORY = ".mthistory";

export interface HeaderTools {
  reuseRelease: boolean;
  dryRun: boolean;
  deleteMerged: boolean;
  deleteRelease: boolean;
}

export const DEFAULT_HEADER_TOOLS: HeaderTools = {
  reuseRelease: false,
  dryRun: true,
  deleteMerged: true,
  deleteRelease: true,
};

export const DEFAULT_TARGET_BRANCHES = ["develop", "unstable", "staging", "production"];

export interface MtDeployFile {
  sourceBranch?: string;
  targetBranches?: string[];
  reuseRelease?: boolean;
  dryRun?: boolean;
  deleteMerged?: boolean;
  deleteRelease?: boolean;
}

export function mtDir(repoPath: string): string {
  return path.join(repoPath, MT_DIR);
}

export function mtConfigPath(repoPath: string): string {
  return path.join(mtDir(repoPath), MT_CONFIG);
}

export function mtHistoryPath(repoPath: string): string {
  return path.join(mtDir(repoPath), MT_HISTORY);
}

export function defaultMtConfig(): MtDeployFile {
  return {
    sourceBranch: "develop",
    targetBranches: [...DEFAULT_TARGET_BRANCHES],
    ...DEFAULT_HEADER_TOOLS,
  };
}

export function ensureMtDeploy(repoPath: string): MtDeployFile {
  const legacy = migrateLegacyConfig(repoPath);
  const dir = mtDir(repoPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  migrateLegacyHistory(repoPath);
  ensureFolderIgnored(repoPath);
  const existing = readMtConfig(repoPath);
  const config = normalizeConfig(existing || legacy || defaultMtConfig());
  if (!existing) {
    writeMtConfig(repoPath, config);
  }
  if (!fs.existsSync(mtHistoryPath(repoPath))) {
    fs.writeFileSync(mtHistoryPath(repoPath), `${JSON.stringify({ version: 1, records: [] }, null, 2)}\n`, "utf8");
  }
  return config;
}

export function loadMtDeploy(repoPath: string): MtDeployFile {
  return ensureMtDeploy(repoPath);
}

export function toolsFromConfig(file: MtDeployFile): HeaderTools {
  return {
    reuseRelease: file.reuseRelease === true,
    dryRun: file.dryRun !== false,
    deleteMerged: file.deleteMerged !== false,
    deleteRelease: file.deleteRelease !== false,
  };
}

export function saveMtTools(repoPath: string, tools: HeaderTools): void {
  const current = ensureMtDeploy(repoPath);
  writeMtConfig(repoPath, {
    ...current,
    reuseRelease: tools.reuseRelease === true,
    dryRun: tools.dryRun === true,
    deleteMerged: tools.deleteMerged === true,
    deleteRelease: tools.deleteRelease === true,
  });
}

export function writeMtConfig(repoPath: string, config: MtDeployFile): void {
  const dir = mtDir(repoPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(mtConfigPath(repoPath), `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, "utf8");
}

function readMtConfig(repoPath: string): MtDeployFile | undefined {
  return parseConfigFile(mtConfigPath(repoPath));
}

function normalizeConfig(raw: MtDeployFile): MtDeployFile {
  const defaults = defaultMtConfig();
  const targetBranches = Array.isArray(raw.targetBranches)
    ? raw.targetBranches.map((item) => String(item).trim()).filter(Boolean)
    : [...DEFAULT_TARGET_BRANCHES];
  return {
    sourceBranch: typeof raw.sourceBranch === "string" && raw.sourceBranch.trim() ? raw.sourceBranch.trim() : defaults.sourceBranch,
    targetBranches: targetBranches.length ? targetBranches : [...DEFAULT_TARGET_BRANCHES],
    reuseRelease: raw.reuseRelease ?? defaults.reuseRelease,
    dryRun: raw.dryRun ?? defaults.dryRun,
    deleteMerged: raw.deleteMerged ?? defaults.deleteMerged,
    deleteRelease: raw.deleteRelease ?? defaults.deleteRelease,
  };
}

function parseConfigFile(filePath: string): MtDeployFile | undefined {
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return undefined;
    }
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    const sourceBranch = typeof parsed.sourceBranch === "string" ? parsed.sourceBranch.trim() : undefined;
    const targetBranches = Array.isArray(parsed.targetBranches)
      ? parsed.targetBranches.map((item) => String(item).trim()).filter(Boolean)
      : undefined;
    return {
      sourceBranch,
      targetBranches,
      reuseRelease: typeof parsed.reuseRelease === "boolean" ? parsed.reuseRelease : undefined,
      dryRun: typeof parsed.dryRun === "boolean" ? parsed.dryRun : undefined,
      deleteMerged: typeof parsed.deleteMerged === "boolean" ? parsed.deleteMerged : undefined,
      deleteRelease: typeof parsed.deleteRelease === "boolean" ? parsed.deleteRelease : undefined,
    };
  } catch {
    return undefined;
  }
}

function migrateLegacyConfig(repoPath: string): MtDeployFile | undefined {
  const legacyPath = path.join(repoPath, MT_DIR);
  try {
    if (!fs.existsSync(legacyPath) || !fs.statSync(legacyPath).isFile()) {
      return undefined;
    }
    const parsed = parseConfigFile(legacyPath);
    fs.unlinkSync(legacyPath);
    return parsed;
  } catch {
    return undefined;
  }
}

function migrateLegacyHistory(repoPath: string): void {
  const oldPath = path.join(repoPath, MT_HISTORY);
  const nextPath = mtHistoryPath(repoPath);
  try {
    if (!fs.existsSync(oldPath) || !fs.statSync(oldPath).isFile()) {
      return;
    }
    if (!fs.existsSync(nextPath)) {
      fs.copyFileSync(oldPath, nextPath);
    }
    fs.unlinkSync(oldPath);
  } catch {
    // keep the old file if the move fails
  }
}

function ensureFolderIgnored(repoPath: string): void {
  const gitignore = path.join(repoPath, ".gitignore");
  const accepted = new Set([MT_DIR, `/${MT_DIR}`, `${MT_DIR}/`, `/${MT_DIR}/`]);
  try {
    if (!fs.existsSync(gitignore)) {
      fs.writeFileSync(gitignore, `${MT_DIR}\n`, "utf8");
      return;
    }
    const text = fs.readFileSync(gitignore, "utf8");
    const already = text.split(/\r?\n/).some((row) => accepted.has(row.trim()));
    if (already) {
      return;
    }
    fs.appendFileSync(gitignore, text.endsWith("\n") ? `${MT_DIR}\n` : `\n${MT_DIR}\n`, "utf8");
  } catch {
    // ignore
  }
}
