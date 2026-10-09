import * as fs from "fs";
import * as path from "path";

export function readPackageVersion(repoRoot: string): string | undefined {
  const pkgPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return undefined;
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: unknown };
  return typeof pkg.version === "string" && pkg.version.trim() ? pkg.version.trim() : undefined;
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) {
      return da - db;
    }
  }
  return 0;
}

export function latestVersion(...values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .sort(compareVersions)
    .at(-1);
}

export function bumpPackageFiles(repoRoot: string, version: string): string[] {
  const pkgPath = path.join(repoRoot, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return [];
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  pkg.version = version;
  fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  const updated = ["package.json"];

  const lockPath = path.join(repoRoot, "package-lock.json");
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
      version?: string;
      packages?: Record<string, { version?: string }>;
    };
    lock.version = version;
    if (lock.packages && lock.packages[""]) {
      lock.packages[""].version = version;
    }
    fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    updated.push("package-lock.json");
  }

  return updated;
}

function parseVersion(value: string): number[] {
  return value
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part.replace(/[^\d].*$/, ""), 10) || 0);
}
