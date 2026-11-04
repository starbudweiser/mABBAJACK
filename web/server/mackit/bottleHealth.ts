/**
 * mORTEX (macOS) : bilan de santé de la bouteille du jeu.
 *
 * Interface :
 *  - checkBottleHealth(bottle, gamePath): Promise<IHealthCheck[]>
 *  - enableMsync(bottle): Promise<void>                         WINEMSYNC=1 dans cxbottle.conf
 *  - parseMountType(mountOutput, mountPoint): string | undefined
 *  - setBottleEnv(conf, name, value): string                    cxbottle.conf modifié
 *
 * Contrôles : version de CrossOver (ou Whisky), moteur graphique, MSync, Rosetta 2, système de
 * fichiers du jeu (APFS : liens et clones ; exFAT/FAT : pas de liens), place libre, overrides DLL
 * manquants pour les DLL de substitution du jeu. Le correctif des overrides est dans
 * dllOverrides.syncDllOverrides.
 */
import { execFile } from "node:child_process";
import { readFile, stat, statfs, writeFile } from "node:fs/promises";
import * as path from "node:path";

import type { IBottle } from "./bottlesCore";
import { readRegString } from "./bottlesCore";
import { planOverrides, proxyDlls } from "./dllOverrides";
import { graphicsBackend } from "./dxmtChecks";

export type HealthCheckId =
  | "runtime"
  | "engine"
  | "msync"
  | "rosetta"
  | "filesystem"
  | "space"
  | "overrides";

export type HealthStatus = "ok" | "warning" | "error" | "info";

export interface IHealthCheck {
  id: HealthCheckId;
  status: HealthStatus;
  /** valeur affichée (version, moteur, système de fichiers, place libre, DLL…) */
  value: string;
  /** un correctif existe */
  fixable?: boolean;
}

const GB = 1024 ** 3;
const ROSETTA = "/Library/Apple/usr/share/rosetta/rosetta";
const CROSSOVER = "/Applications/CrossOver.app/Contents/Info.plist";

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve) =>
    execFile(cmd, args, { timeout: 10_000 }, (err, out) => resolve(err ? "" : out)),
  );

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

/** « /dev/disk9s1 on /Volumes/X (apfs, local, journaled) » → « apfs » */
export function parseMountType(mountOutput: string, mountPoint: string): string | undefined {
  for (const line of mountOutput.split("\n")) {
    const match = /^.+? on (.+) \(([^,)]+)/.exec(line);
    if (match?.[1] === mountPoint) return match[2].toLowerCase();
  }
  return undefined;
}

async function filesystemOf(p: string): Promise<string | undefined> {
  const df = await run("/bin/df", ["-P", p]);
  const mountPoint = /\s(\/.*)$/m.exec(df.trim().split("\n").pop() ?? "")?.[1];
  if (mountPoint === undefined) return undefined;
  return parseMountType(await run("/sbin/mount", []), mountPoint);
}

async function runtimeVersion(bottle: IBottle): Promise<string> {
  if (bottle.kind !== "crossover") return bottle.kind === "whisky" ? "Whisky" : "Wine";
  const plist = await readFile(CROSSOVER, "utf8").catch(() => "");
  const version = /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(
    plist,
  )?.[1];
  return version !== undefined ? `CrossOver ${version}` : "CrossOver";
}

const readConf = (bottle: IBottle) =>
  readFile(path.join(bottle.path, "cxbottle.conf"), "utf8").catch(() => "");

/** valeur d'une variable de [EnvironmentVariables] (ligne non commentée) */
export function bottleEnv(conf: string, name: string): string | undefined {
  return new RegExp(`^\\s*"${name}"\\s*=\\s*"([^"]*)"`, "m").exec(conf)?.[1];
}

/** cxbottle.conf avec la variable posée dans [EnvironmentVariables] */
export function setBottleEnv(conf: string, name: string, value: string): string {
  const line = `"${name}" = "${value}"`;
  const existing = new RegExp(`^\\s*;*\\s*"${name}"\\s*=.*$`, "m");
  if (existing.test(conf)) return conf.replace(existing, line);
  if (/^\[EnvironmentVariables\]\s*$/m.test(conf)) {
    return conf.replace(/^(\[EnvironmentVariables\]\s*)$/m, `$1\n${line}`);
  }
  return `${conf.trimEnd()}\n\n[EnvironmentVariables]\n${line}\n`;
}

export async function enableMsync(bottle: IBottle): Promise<void> {
  const file = path.join(bottle.path, "cxbottle.conf");
  await writeFile(file, setBottleEnv(await readFile(file, "utf8"), "WINEMSYNC", "1"));
}

export async function checkBottleHealth(
  bottle: IBottle,
  gamePath: string,
): Promise<IHealthCheck[]> {
  const [runtime, engine, conf, rosetta, fsType, space, dlls] = await Promise.all([
    runtimeVersion(bottle),
    graphicsBackend(bottle.path),
    readConf(bottle),
    exists(ROSETTA),
    filesystemOf(gamePath),
    statfs(gamePath).catch(() => undefined),
    proxyDlls(gamePath),
  ]);

  const msync = bottleEnv(conf, "WINEMSYNC") === "1";
  const free = space !== undefined ? (space.bavail * space.bsize) / GB : undefined;
  const missing = planOverrides(
    dlls,
    (dll) => readRegString(bottle, "HKEY_CURRENT_USER", "Software\\Wine\\DllOverrides", dll),
    [],
  ).add;

  return [
    { id: "runtime", status: "info", value: runtime },
    {
      id: "engine",
      status: engine === undefined ? "warning" : "info",
      value: engine?.toUpperCase() ?? "",
    },
    {
      id: "msync",
      status: bottle.kind !== "crossover" ? "info" : msync ? "ok" : "warning",
      value: msync ? "on" : "off",
      fixable: bottle.kind === "crossover" && !msync,
    },
    { id: "rosetta", status: rosetta ? "ok" : "error", value: rosetta ? "on" : "off" },
    {
      id: "filesystem",
      status: fsType === "apfs" ? "ok" : fsType === "hfs" ? "warning" : "error",
      value: fsType?.toUpperCase() ?? "",
    },
    {
      id: "space",
      status: free === undefined ? "warning" : free < 5 ? "error" : free < 20 ? "warning" : "ok",
      value: free !== undefined ? `${Math.floor(free)}` : "",
    },
    {
      id: "overrides",
      status: missing.length > 0 ? "warning" : "ok",
      value: missing.map((dll) => `${dll}.dll`).join(", "),
      fixable: missing.length > 0,
    },
  ];
}
