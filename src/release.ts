import { GitError, GitRepo } from "./git";
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

  try {
    if (!version) {
      throw new Error("inserisci un numero di release");
    }

    log("info", input.dryRun ? "modalità dry-run: nessun write sul repository" : `avvio release ${version}`);
    log("info", `repository: ${input.repoPath}`);

    if (!input.dryRun && (await git.isDirty())) {
      throw new Error("working tree sporco: committa o stasha le modifiche prima di partire");
    }

    await step(input.dryRun, log, "git fetch --all --prune", () => git.fetch());

    const source = await git.sourceBranch();
    const production = await git.productionBranch();
    log("info", `branch di partenza: ${source}`);
    log("info", `branch di produzione: ${production}`);

    if (!(await git.hasBranch(source))) {
      throw new Error(`branch ${source} non trovato`);
    }
    if (!(await git.hasBranch(production))) {
      throw new Error(`branch ${production} non trovato`);
    }

    const releaseExists = await git.hasBranch(releaseBranch);
    if (releaseExists && !input.reuseReleaseBranch) {
      throw new Error(`${releaseBranch} esiste già. Abilita "riusa branch release" per continuare su quello`);
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
      log("ok", `versione aggiornata a ${version} in ${files.join(", ")}`);
      if (!files.includes("package-lock.json")) {
        log("info", "package-lock.json assente: lascio yarn/pnpm lock invariati");
      }
      await git.add(files);
      if (await git.isDirty()) {
        await git.commit(`chore: bump version to ${version}`);
        log("ok", `commit versione ${version}`);
      } else {
        log("info", "versione già allineata, nessun commit");
      }
    } else {
      const lock = fs.existsSync(path.join(input.repoPath, "package-lock.json"));
      log("info", lock
        ? `[dry-run] aggiornerei package.json e package-lock.json a ${version}`
        : `[dry-run] aggiornerei solo package.json a ${version} (niente package-lock.json)`);
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
      log("warn", `tag ${tag} già presente, non lo ricreo`);
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
          log("warn", `non cancello ${branch}: branch protetto`);
          continue;
        }
        await step(input.dryRun, log, `git push origin --delete ${branch} && git branch -D ${branch}`, async () => {
          try {
            await git.deleteRemoteBranch(branch);
          } catch (error) {
            log("warn", `remoto ${branch}: ${formatError(error)}`);
          }
          try {
            await git.deleteLocalBranch(branch);
          } catch (error) {
            log("warn", `locale ${branch}: ${formatError(error)}`);
          }
        });
      }
    }

    if (input.deleteReleaseBranch) {
      await step(input.dryRun, log, `git push origin --delete ${releaseBranch} && git branch -D ${releaseBranch}`, async () => {
        try {
          await git.deleteRemoteBranch(releaseBranch);
        } catch (error) {
          log("warn", `remoto ${releaseBranch}: ${formatError(error)}`);
        }
        try {
          await git.deleteLocalBranch(releaseBranch);
        } catch (error) {
          log("warn", `locale ${releaseBranch}: ${formatError(error)}`);
        }
      });
    }

    log("ok", `release ${version} completata`);
    return { ok: true, logs, releaseBranch, tag, productionBranch: production };
  } catch (error) {
    const message = formatError(error);
    log("error", message);
    return { ok: false, logs, releaseBranch, tag, productionBranch: "main" };
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
