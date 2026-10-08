import { GitError, GitRepo } from "./git";
import { Locale, t } from "./i18n";
import { bumpPackageFiles } from "./version";
import * as fs from "fs";
import * as path from "path";

export interface ReleaseInput {
  repoPath: string;
  version: string;
  mergeBranches: string[];
  targetBranches: string[];
  reuseReleaseBranch: boolean;
  dryRun: boolean;
  deleteMergedBranches: boolean;
  deleteReleaseBranch: boolean;
  locale: Locale;
}

export interface ReleaseLog {
  level: "info" | "ok" | "warn" | "error";
  message: string;
}

export interface ReleaseResult {
  ok: boolean;
  logs: ReleaseLog[];
  releaseBranch: string;
  tag: string;
  productionBranch: string;
  conflict?: ConflictInfo;
}

export interface ResumeTagInput {
  repoPath: string;
  version: string;
  targetBranches: string[];
  dryRun: boolean;
  locale: Locale;
}

export interface ConflictInfo {
  branch: string;
  files: string[];
  tag: string;
}

type Logger = (level: ReleaseLog["level"], message: string) => void;

export async function runRelease(input: ReleaseInput, onLog?: Logger): Promise<ReleaseResult> {
  const logs: ReleaseLog[] = [];
  const log: Logger = (level, message) => {
    logs.push({ level, message });
    onLog?.(level, message);
  };

  const version = input.version.trim();
  const releaseBranch = `release/${version}`;
  const tag = version;
  const git = new GitRepo(input.repoPath);
  const locale = input.locale;

  try {
    if (!version) {
      throw new Error(t(locale, "enterReleaseNumber"));
    }

    log("info", input.dryRun ? t(locale, "dryRunMode") : t(locale, "startingRelease", { version }));
    log("info", `repository: ${input.repoPath}`);

    if (!input.dryRun && (await git.isDirty())) {
      throw new Error(t(locale, "dirtyWorkingTree"));
    }

    await step(input.dryRun, log, "git fetch --all --prune", () => git.fetch());

    const source = await git.sourceBranch();
    const production = await git.productionBranch();
    log("info", t(locale, "sourceBranch", { name: source }));
    log("info", t(locale, "productionBranch", { name: production }));

    if (!(await git.hasBranch(source))) {
      throw new Error(t(locale, "branchNotFound", { name: source }));
    }
    if (!(await git.hasBranch(production))) {
      throw new Error(t(locale, "branchNotFound", { name: production }));
    }

    const releaseExists = await git.hasBranch(releaseBranch);
    if (releaseExists && !input.reuseReleaseBranch) {
      throw new Error(t(locale, "releaseExists", { name: releaseBranch }));
    }

    await step(input.dryRun, log, `git checkout ${source} && git pull`, async () => {
      await git.checkout(source);
      await git.pull();
    });

    if (releaseExists && input.reuseReleaseBranch) {
      await step(input.dryRun, log, `git checkout ${releaseBranch}`, () => git.checkout(releaseBranch));
    } else {
      await step(input.dryRun, log, `git checkout -B ${releaseBranch} ${source}`, () =>
        git.checkoutNew(releaseBranch, source)
      );
    }

    if (!input.dryRun) {
      const files = bumpPackageFiles(input.repoPath, version);
      log("ok", t(locale, "versionBumped", { version, files: files.join(", ") }));
      if (!files.includes("package-lock.json")) {
        log("info", t(locale, "noPackageLock"));
      }
      await git.add(files);
      if (await git.isDirty()) {
        await git.commit(`chore: bump version to ${version}`);
        log("ok", t(locale, "committedVersion", { version }));
      } else {
        log("info", t(locale, "versionUnchanged"));
      }
    } else {
      const lock = fs.existsSync(path.join(input.repoPath, "package-lock.json"));
      log("info", t(locale, lock ? "dryRunBoth" : "dryRunPkgOnly", { version }));
    }

    for (const branch of unique(input.mergeBranches)) {
      if (branch === releaseBranch) {
        continue;
      }
      await step(input.dryRun, log, `git merge ${branch} --no-ff`, () =>
        git.merge(branch, `Merge branch '${branch}' into ${releaseBranch}`)
      );
    }

    await step(input.dryRun, log, `git push -u origin ${releaseBranch}`, () => git.push(releaseBranch));

    await step(input.dryRun, log, `git checkout ${production} && git pull`, async () => {
      await git.checkout(production);
      await git.pull();
    });
    await step(input.dryRun, log, `git merge ${releaseBranch} --no-ff`, () =>
      git.merge(releaseBranch, `Merge branch '${releaseBranch}'`)
    );
    await step(input.dryRun, log, `git push origin ${production}`, () => git.push(production));

    if (await git.hasTag(tag)) {
      log("warn", t(locale, "tagExists", { tag }));
    } else {
      await step(input.dryRun, log, `git tag ${tag}`, () => git.tag(tag));
    }
    await step(input.dryRun, log, "git push origin --tags", () => git.pushTags());

    for (const branch of unique(input.targetBranches)) {
      if (branch === production || branch === releaseBranch) {
        continue;
      }
      await step(input.dryRun, log, `git checkout ${branch} && git pull && git merge ${tag} --no-ff && git push`, async () => {
        await git.checkout(branch);
        await git.pull();
        await git.merge(tag, `Merge tag '${tag}' into ${branch}`);
        await git.push(branch);
      });
    }

    await step(input.dryRun, log, `git checkout ${production}`, () => git.checkout(production));

    if (input.deleteMergedBranches) {
      const protectedBranches = new Set([
        source,
        production,
        releaseBranch,
        "develop",
        "dev",
        "main",
        "master",
        "unstable",
        "staging",
      ]);
      for (const branch of unique(input.mergeBranches)) {
        if (protectedBranches.has(branch)) {
          log("warn", t(locale, "notDeletingProtected", { name: branch }));
          continue;
        }
        await step(input.dryRun, log, `git push origin --delete ${branch} && git branch -D ${branch}`, async () => {
          try {
            await git.deleteRemoteBranch(branch);
          } catch (error) {
            log("warn", t(locale, "remoteError", { name: branch, error: formatError(error) }));
          }
          try {
            await git.deleteLocalBranch(branch);
          } catch (error) {
            log("warn", t(locale, "localError", { name: branch, error: formatError(error) }));
          }
        });
      }
    }

    if (input.deleteReleaseBranch) {
      await step(input.dryRun, log, `git push origin --delete ${releaseBranch} && git branch -D ${releaseBranch}`, async () => {
        try {
          await git.deleteRemoteBranch(releaseBranch);
        } catch (error) {
          log("warn", t(locale, "remoteError", { name: releaseBranch, error: formatError(error) }));
        }
        try {
          await git.deleteLocalBranch(releaseBranch);
        } catch (error) {
          log("warn", t(locale, "localError", { name: releaseBranch, error: formatError(error) }));
        }
      });
    }

    log("ok", t(locale, "releaseDone", { version }));
    return { ok: true, logs, releaseBranch, tag, productionBranch: production };
  } catch (error) {
    const message = formatError(error);
    log("error", message);
    const conflict = await detectConflict(git, tag, error);
    if (conflict) {
      log("warn", t(locale, "conflictLog", { branch: conflict.branch, files: conflict.files.join(", ") || "-" }));
    }
    return { ok: false, logs, releaseBranch, tag, productionBranch: "main", conflict };
  }
}

export async function runResumeTagMerge(input: ResumeTagInput, onLog?: Logger): Promise<ReleaseResult> {
  const logs: ReleaseLog[] = [];
  const log: Logger = (level, message) => {
    logs.push({ level, message });
    onLog?.(level, message);
  };

  const version = input.version.trim();
  const tag = version;
  const git = new GitRepo(input.repoPath);
  const locale = input.locale;
  const targets = unique(input.targetBranches);

  try {
    if (!version) {
      throw new Error(t(locale, "enterReleaseNumber"));
    }
    if (!targets.length) {
      throw new Error(t(locale, "noTargetBranches"));
    }

    log("info", input.dryRun ? t(locale, "dryRunMode") : t(locale, "resumingTag", { tag }));
    log("info", `repository: ${input.repoPath}`);

    await step(input.dryRun, log, "git fetch --all --prune", () => git.fetch());

    if (!input.dryRun && !(await git.hasTag(tag))) {
      throw new Error(t(locale, "tagNotFound", { tag }));
    }

    const current = await git.currentBranch().catch(() => "");
    if (!input.dryRun && (await git.inMerge())) {
      const files = await git.conflictedFiles();
      if (files.length) {
        const conflict = { branch: current || targets[0], files, tag };
        log("warn", t(locale, "conflictLog", { branch: conflict.branch, files: files.join(", ") }));
        return { ok: false, logs, releaseBranch: `release/${version}`, tag, productionBranch: current || "main", conflict };
      }
      await step(false, log, `git commit -m "Merge tag '${tag}'"`, () =>
        git.commit(`Merge tag '${tag}' into ${current}`)
      );
      await step(false, log, `git push origin ${current}`, () => git.push(current));
    } else if (!input.dryRun && (await git.isDirty())) {
      const files = await git.conflictedFiles();
      if (files.length) {
        const conflict = { branch: current || targets[0], files, tag };
        log("warn", t(locale, "conflictLog", { branch: conflict.branch, files: files.join(", ") }));
        return { ok: false, logs, releaseBranch: `release/${version}`, tag, productionBranch: current || "main", conflict };
      }
      throw new Error(t(locale, "dirtyWorkingTree"));
    }

    for (const branch of targets) {
      const command = `git checkout ${branch} && git pull && git merge ${tag} --no-ff && git push`;
      if (input.dryRun) {
        log("info", `[dry-run] ${command}`);
        continue;
      }
      log("info", command);
      try {
        await git.checkout(branch);
        await git.pull();
        const afterPull = await git.conflictedFiles();
        if (afterPull.length) {
          const conflict = { branch, files: afterPull, tag };
          log("warn", t(locale, "conflictLog", { branch, files: afterPull.join(", ") }));
          return { ok: false, logs, releaseBranch: `release/${version}`, tag, productionBranch: branch, conflict };
        }
        if (await git.inMerge()) {
          await git.commit(`Merge tag '${tag}' into ${branch}`);
        } else {
          await git.merge(tag, `Merge tag '${tag}' into ${branch}`);
        }
        await git.push(branch);
        log("ok", `ok · ${command}`);
      } catch (error) {
        const conflict = await detectConflict(git, tag, error);
        if (conflict) {
          conflict.branch = branch;
          log("error", formatError(error));
          log("warn", t(locale, "conflictLog", { branch, files: conflict.files.join(", ") || "-" }));
          return { ok: false, logs, releaseBranch: `release/${version}`, tag, productionBranch: branch, conflict };
        }
        throw error;
      }
    }

    log("ok", t(locale, "resumeMergeDone", { tag }));
    return { ok: true, logs, releaseBranch: `release/${version}`, tag, productionBranch: targets[0] };
  } catch (error) {
    const message = formatError(error);
    log("error", message);
    const conflict = await detectConflict(git, tag, error);
    if (conflict) {
      log("warn", t(locale, "conflictLog", { branch: conflict.branch, files: conflict.files.join(", ") || "-" }));
    }
    return { ok: false, logs, releaseBranch: `release/${version}`, tag, productionBranch: "main", conflict };
  }
}

async function step(dryRun: boolean, log: Logger, command: string, run: () => Promise<unknown>): Promise<void> {
  if (dryRun) {
    log("info", `[dry-run] ${command}`);
    return;
  }
  log("info", command);
  await run();
  log("ok", `ok · ${command}`);
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formatError(error: unknown): string {
  if (error instanceof GitError) {
    const detail = error.stderr.trim() || error.message;
    return `${error.command}\n${detail}`;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function isConflictText(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("conflict") || lower.includes("unmerged") || lower.includes("fix them") || lower.includes("fix conflicts");
}

async function detectConflict(git: GitRepo, tag: string, error: unknown): Promise<ConflictInfo | undefined> {
  const extra = error as { conflictFiles?: string[]; conflictBranch?: string };
  const files = extra.conflictFiles?.length ? extra.conflictFiles : await git.conflictedFiles();
  const text = formatError(error);
  if (!files.length && !isConflictText(text) && extra.conflictFiles === undefined) {
    return undefined;
  }
  const branch = extra.conflictBranch || (await git.currentBranch().catch(() => ""));
  return { branch, files, tag };
}
