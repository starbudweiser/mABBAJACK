/**
 * mORTEX (macOS) : overrides DLL automatiques. Les mods déposent à la racine du jeu des DLL de
 * substitution (d3d11 et dxgi d'ENB, dinput8, version, d3dx9_42 d'Engine Fixes…) que Wine ignore
 * tant que la bouteille préfère sa version intégrée. mORTEX pose l'override « native,builtin »
 * qui manque, et retire ceux qu'il a posés quand la DLL quitte le jeu.
 *
 * Interface :
 *  - proxyDlls(gamePath): Promise<string[]>                 DLL de substitution présentes (sans .dll)
 *  - planOverrides(present, current, ours): IOverridePlan    overrides à poser et à retirer
 *  - syncDllOverrides(bottle, gamePath, run?): Promise<IOverridePlan>   applique le plan
 *  - addDllOverrides / removeDllOverrides(bottle, dlls, run?)              pose ou retire ceux-là seulement
 *
 * Écriture : un fichier .reg passé à `regedit /S` dans la bouteille (wineserver tient le registre,
 * user.reg ne s'édite pas à la main). Les overrides posés par mORTEX sont notés dans
 * <bouteille>/mortex-dll-overrides.json, pour ne retirer que ceux-là.
 */
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

import { type IBottle, type IBottleLaunch, readRegString, wineCommand } from "./bottlesCore";

/** DLL que Wine fournit lui-même et que des mods remplacent à la racine du jeu */
export const PROXY_DLLS = [
  "d3d9",
  "d3d10",
  "d3d10_1",
  "d3d11",
  "d3d12",
  "dxgi",
  "dinput",
  "dinput8",
  "version",
  "winhttp",
  "winmm",
  "wininet",
  "dsound",
  "xinput1_3",
  "xinput1_4",
  "xinput9_1_0",
  "d3dx9_42",
  "d3dx9_43",
  "d3dcompiler_46",
  "d3dcompiler_47",
  "x3daudio1_7",
  "xaudio2_7",
];

export const OVERRIDES_KEY = "Software\\Wine\\DllOverrides";
const NATIVE = "native,builtin";
const STATE_FILE = "mortex-dll-overrides.json";

export interface IOverridePlan {
  add: string[];
  remove: string[];
}

export async function proxyDlls(gamePath: string): Promise<string[]> {
  const files = await readdir(gamePath).catch(() => [] as string[]);
  return files
    .map((file) => /^(.+)\.dll$/i.exec(file)?.[1]?.toLowerCase())
    .filter((name): name is string => name !== undefined && PROXY_DLLS.includes(name));
}

/** « native », « n,b », « native,builtin » : Wine charge d'abord la DLL du jeu */
export const prefersNative = (value: string | undefined) =>
  value !== undefined && /^\s*n/i.test(value);

/**
 * À poser : DLL présentes sans override natif, que mORTEX n'a pas déjà posé (user.reg n'est
 * réécrit par wineserver qu'un peu plus tard). À retirer : celles posées par mORTEX dont la DLL
 * n'est plus là.
 */
export function planOverrides(
  present: string[],
  current: (dll: string) => string | undefined,
  ours: string[],
): IOverridePlan {
  return {
    add: present.filter((dll) => !ours.includes(dll) && !prefersNative(current(dll))),
    remove: ours.filter((dll) => !present.includes(dll)),
  };
}

export function regFile(plan: IOverridePlan): string {
  const lines = [
    ...plan.add.map((dll) => `"${dll}"="${NATIVE}"`),
    ...plan.remove.map((dll) => `"${dll}"=-`),
  ];
  return `REGEDIT4\r\n\r\n[HKEY_CURRENT_USER\\${OVERRIDES_KEY}]\r\n${lines.join("\r\n")}\r\n`;
}

export type WineRunner = (command: IBottleLaunch) => Promise<void>;

const runWine: WineRunner = (command) =>
  new Promise((resolve, reject) =>
    execFile(
      command.executable,
      command.args,
      { env: { ...process.env, ...command.env }, timeout: 120_000 },
      (err) => (err ? reject(err) : resolve()),
    ),
  );

export async function readOurs(bottle: IBottle): Promise<string[]> {
  try {
    const state = JSON.parse(await readFile(path.join(bottle.path, STATE_FILE), "utf8"));
    return Array.isArray(state.added) ? state.added : [];
  } catch {
    return [];
  }
}

/** Passe le plan à regedit dans la bouteille, par un fichier .reg temporaire. */
async function applyRegPlan(bottle: IBottle, plan: IOverridePlan, run: WineRunner): Promise<void> {
  const temp = path.join(bottle.path, "drive_c", "windows", "temp");
  const file = path.join(temp, "mortex-dll-overrides.reg");
  await mkdir(temp, { recursive: true });
  await writeFile(file, regFile(plan), "latin1");
  try {
    await run(
      wineCommand(bottle, ["regedit", "/S", "C:\\windows\\temp\\mortex-dll-overrides.reg"]),
    );
  } finally {
    await rm(file, { force: true });
  }
}

const writeOurs = (bottle: IBottle, added: string[]) =>
  writeFile(path.join(bottle.path, STATE_FILE), JSON.stringify({ added }, null, 2));

export async function syncDllOverrides(
  bottle: IBottle,
  gamePath: string,
  run: WineRunner = runWine,
): Promise<IOverridePlan> {
  const ours = await readOurs(bottle);
  const plan = planOverrides(
    await proxyDlls(gamePath),
    (dll) => readRegString(bottle, "HKEY_CURRENT_USER", OVERRIDES_KEY, dll),
    ours,
  );
  if (plan.add.length === 0 && plan.remove.length === 0) return plan;

  await applyRegPlan(bottle, plan, run);
  await writeOurs(bottle, [...ours.filter((dll) => !plan.remove.includes(dll)), ...plan.add]);
  return plan;
}

/** Pose l'override « native,builtin » de ces DLL, et les note comme posés par nous. */
export async function addDllOverrides(
  bottle: IBottle,
  dlls: string[],
  run: WineRunner = runWine,
): Promise<void> {
  if (dlls.length === 0) return;
  const ours = await readOurs(bottle);
  await applyRegPlan(bottle, { add: dlls, remove: [] }, run);
  await writeOurs(bottle, [...ours, ...dlls.filter((dll) => !ours.includes(dll))]);
}

/** Retire l'override de ces DLL (annulation d'addDllOverrides), et les oublie de notre état. */
export async function removeDllOverrides(
  bottle: IBottle,
  dlls: string[],
  run: WineRunner = runWine,
): Promise<void> {
  if (dlls.length === 0) return;
  const ours = await readOurs(bottle);
  await applyRegPlan(bottle, { add: [], remove: dlls }, run);
  await writeOurs(
    bottle,
    ours.filter((dll) => !dlls.includes(dll)),
  );
}
