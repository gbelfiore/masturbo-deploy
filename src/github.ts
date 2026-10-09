import * as vscode from "vscode";
import { GitRepo } from "./git";
import { DeployLogLine, DeployRecord, loadHistory, writeHistoryFile } from "./persist";

const META_RE = /<!--\s*masturbo:({[\s\S]*?})\s*-->/;

export interface MasTurboMeta {
  v: 1;
  kind?: "release" | "resume";
  origin?: string[];
  targets?: string[];
  ok?: boolean;
  author?: string;
}

export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

export interface GitHubRelease {
  id: number;
  tag: string;
  name: string;
  body: string;
  htmlUrl: string;
  publishedAt: number;
  draft: boolean;
  author?: string;
  meta?: MasTurboMeta;
}

export interface HistoryViewRecord {
  id: string;
  tag: string;
  at: number;
  repoName: string;
  githubUrl?: string;
  githubTitle?: string;
  githubBody?: string;
  author?: string;
  hasLocal: boolean;
  originBranches?: string[];
  targetBranches?: string[];
  dryRun?: boolean;
  ok?: boolean;
  kind?: "release" | "resume";
  logs?: DeployLogLine[];
  conflictBranch?: string;
  conflictFiles?: string[];
}

type GitHubReleaseJson = {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string | null;
  created_at: string;
  draft: boolean;
  author?: { login?: string; name?: string | null };
};

export function parseGithubRemote(url: string): GitHubRepoRef | undefined {
  const raw = url.trim().replace(/\.git$/i, "");
  const patterns = [
    /^git@github\.com:([^/]+)\/(.+)$/i,
    /^ssh:\/\/git@github\.com\/([^/]+)\/(.+)$/i,
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/(.+)$/i,
    /^git:\/\/github\.com\/([^/]+)\/(.+)$/i,
  ];
  for (const re of patterns) {
    const match = raw.match(re);
    if (match) {
      return { owner: match[1], repo: match[2].replace(/\/+$/, "") };
    }
  }
  return undefined;
}

export async function getOriginGithubRepo(repoPath: string): Promise<GitHubRepoRef | undefined> {
  const url = await new GitRepo(repoPath).originUrl();
  return url ? parseGithubRemote(url) : undefined;
}

export function normTag(tag: string): string {
  return tag.replace(/^v/i, "").trim();
}

export function stripMasTurboMeta(body: string): string {
  return String(body || "").replace(META_RE, "").trim();
}

export async function listGithubReleases(repo: GitHubRepoRef): Promise<GitHubRelease[]> {
  let token = await githubToken(false);
  let response = await githubRequest(`/repos/${repo.owner}/${repo.repo}/releases?per_page=100`, token);
  if ((response.status === 401 || response.status === 404) && !token) {
    token = await githubToken(true);
    response = await githubRequest(`/repos/${repo.owner}/${repo.repo}/releases?per_page=100`, token);
  }
  if (!response.ok) {
    throw new Error(await githubError(response));
  }
  const rows = (await response.json()) as GitHubReleaseJson[];
  return rows.filter((row) => !row.draft).map(toGithubRelease);
}

export async function createGithubRelease(
  repo: GitHubRepoRef,
  tag: string,
  notes: string,
  meta?: Omit<MasTurboMeta, "v">
): Promise<{ htmlUrl: string; existed: boolean; author?: string }> {
  const token = await githubToken(true);
  if (!token) {
    throw new Error("github auth missing");
  }
  const author = meta?.author || (await githubUserName(token));
  const existing = await findReleaseByTag(repo, tag, token);
  if (existing) {
    return { htmlUrl: existing.htmlUrl, existed: true, author: existing.author || author };
  }
  const body = withMasTurboMeta(notes, { v: 1, ...meta, author });
  const response = await githubRequest(`/repos/${repo.owner}/${repo.repo}/releases`, token, {
    method: "POST",
    body: JSON.stringify({
      tag_name: tag,
      name: tag,
      body,
      draft: false,
      prerelease: false,
    }),
  });
  if (response.status === 422) {
    const again = await findReleaseByTag(repo, tag, token);
    if (again) {
      return { htmlUrl: again.htmlUrl, existed: true, author: again.author || author };
    }
  }
  if (!response.ok) {
    throw new Error(await githubError(response));
  }
  const created = toGithubRelease((await response.json()) as GitHubReleaseJson);
  return { htmlUrl: created.htmlUrl, existed: false, author: created.author || author };
}

export async function generateGithubReleaseNotes(
  repo: GitHubRepoRef,
  tag: string,
  previousTag?: string
): Promise<string> {
  const token = await githubToken(true);
  if (!token) {
    throw new Error("github auth missing");
  }
  const payload: Record<string, string> = { tag_name: tag };
  if (previousTag) {
    payload.previous_tag_name = previousTag;
  }
  const response = await githubRequest(`/repos/${repo.owner}/${repo.repo}/releases/generate-notes`, token, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(await githubError(response));
  }
  const data = (await response.json()) as { body?: string };
  return stripMasTurboMeta(data.body || "").trim();
}

export function syncGithubIntoHistory(
  context: vscode.ExtensionContext,
  repoPath: string,
  repoName: string,
  releases: GitHubRelease[]
): DeployRecord[] {
  const byTag = new Map<string, DeployRecord>();
  for (const record of loadHistory(context, repoPath)) {
    const key = normTag(record.tag);
    const current = byTag.get(key);
    if (!current || richer(record, current)) {
      byTag.set(key, record);
    }
  }
  for (const release of releases) {
    const key = normTag(release.tag);
    const incoming = recordFromGithub(release, repoPath, repoName);
    const existing = byTag.get(key);
    byTag.set(key, existing ? mergeRecords(existing, incoming) : incoming);
  }
  const next = [...byTag.values()].sort((a, b) => (b.at || 0) - (a.at || 0));
  writeHistoryFile(repoPath, next);
  return next;
}

export function mergeGithubHistory(
  releases: GitHubRelease[],
  local: DeployRecord[],
  repoName: string
): HistoryViewRecord[] {
  return releases.map((release) => {
    const localMatch = latestLocal(local, release.tag);
    const notes = stripMasTurboMeta(localMatch?.githubBody || release.body);
    const extras = hasExtras(localMatch);
    const record: HistoryViewRecord = {
      id: `gh-${release.id}`,
      tag: release.tag,
      at: localMatch?.at || release.publishedAt,
      repoName: localMatch?.repoName || repoName,
      githubUrl: localMatch?.githubUrl || release.htmlUrl,
      githubTitle: localMatch?.githubTitle || release.name,
      githubBody: notes,
      author: localMatch?.author || release.author || release.meta?.author,
      hasLocal: extras,
    };
    if (!extras || !localMatch) {
      return record;
    }
    return {
      ...record,
      originBranches: localMatch.originBranches,
      targetBranches: localMatch.targetBranches,
      dryRun: localMatch.dryRun,
      ok: localMatch.ok,
      kind: localMatch.kind,
      logs: localMatch.logs,
      conflictBranch: localMatch.conflictBranch,
      conflictFiles: localMatch.conflictFiles,
    };
  });
}

function toGithubRelease(row: GitHubReleaseJson): GitHubRelease {
  const body = row.body || "";
  const meta = parseMasTurboMeta(body);
  return {
    id: row.id,
    tag: row.tag_name,
    name: row.name || row.tag_name,
    body,
    htmlUrl: row.html_url,
    publishedAt: Date.parse(row.published_at || row.created_at) || Date.now(),
    draft: row.draft,
    author: meta?.author || row.author?.name || row.author?.login,
    meta,
  };
}

function parseMasTurboMeta(body: string): MasTurboMeta | undefined {
  const match = body.match(META_RE);
  if (!match) {
    return undefined;
  }
  try {
    return JSON.parse(match[1]) as MasTurboMeta;
  } catch {
    return undefined;
  }
}

function withMasTurboMeta(notes: string, meta: MasTurboMeta): string {
  const clean = stripMasTurboMeta(notes);
  const block = `<!-- masturbo:${JSON.stringify(meta)} -->`;
  return clean ? `${clean}\n\n${block}` : block;
}

function recordFromGithub(release: GitHubRelease, repoPath: string, repoName: string): DeployRecord {
  const meta = release.meta;
  return {
    id: `gh-${release.id}`,
    at: release.publishedAt,
    kind: meta?.kind || "release",
    repoName,
    repoPath,
    tag: release.tag,
    originBranches: meta?.origin || [],
    targetBranches: meta?.targets || [],
    dryRun: false,
    ok: meta?.ok !== false,
    logs: [],
    githubUrl: release.htmlUrl,
    author: meta?.author || release.author,
    githubTitle: release.name,
    githubBody: stripMasTurboMeta(release.body),
  };
}

function mergeRecords(local: DeployRecord, incoming: DeployRecord): DeployRecord {
  return {
    ...local,
    githubUrl: local.githubUrl || incoming.githubUrl,
    author: local.author || incoming.author,
    githubTitle: local.githubTitle || incoming.githubTitle,
    githubBody: local.githubBody || incoming.githubBody,
    originBranches: local.originBranches?.length ? local.originBranches : incoming.originBranches,
    targetBranches: local.targetBranches?.length ? local.targetBranches : incoming.targetBranches,
  };
}

function richer(a: DeployRecord, b: DeployRecord): boolean {
  return score(a) > score(b);
}

function score(record: DeployRecord): number {
  return (
    (record.logs?.length || 0) * 3 +
    (record.originBranches?.length || 0) +
    (record.targetBranches?.length || 0) +
    (record.author ? 1 : 0) +
    (record.githubUrl ? 1 : 0)
  );
}

function hasExtras(record?: DeployRecord): boolean {
  if (!record) {
    return false;
  }
  return Boolean(record.originBranches?.length || record.targetBranches?.length || record.logs?.length);
}

function latestLocal(local: DeployRecord[], tag: string): DeployRecord | undefined {
  const wanted = normTag(tag);
  const matches = local.filter((record) => normTag(record.tag) === wanted && !record.dryRun);
  return matches.find((record) => record.ok) || matches[0];
}

async function findReleaseByTag(
  repo: GitHubRepoRef,
  tag: string,
  token: string
): Promise<GitHubRelease | undefined> {
  const tags = [...new Set([tag, `v${normTag(tag)}`, normTag(tag)])];
  for (const name of tags) {
    const response = await githubRequest(
      `/repos/${repo.owner}/${repo.repo}/releases/tags/${encodeURIComponent(name)}`,
      token
    );
    if (response.status === 404) {
      continue;
    }
    if (!response.ok) {
      throw new Error(await githubError(response));
    }
    return toGithubRelease((await response.json()) as GitHubReleaseJson);
  }
  return undefined;
}

async function githubUserName(token: string): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession("github", ["repo"], { silent: true });
    const response = await githubRequest("/user", token);
    if (response.ok) {
      const user = (await response.json()) as { name?: string | null; login?: string };
      return user.name?.trim() || user.login || session?.account.label;
    }
    return session?.account.label;
  } catch {
    return undefined;
  }
}

async function githubToken(interactive: boolean): Promise<string | undefined> {
  try {
    const session = await vscode.authentication.getSession("github", ["repo"], {
      createIfNone: interactive,
      silent: !interactive,
    });
    return session?.accessToken;
  } catch {
    return undefined;
  }
}

async function githubRequest(pathname: string, token: string | undefined, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "MasTurboDeploy",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (init?.body) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(`https://api.github.com${pathname}`, { ...init, headers });
}

async function githubError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string };
    return body.message || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}
