/**
 * Moteur Mac commun (mORTEX, mABBAJACK, mO2FLATTENER) : bouteilles Wine (CrossOver, Wine brut).
 * Source unique : _tools/shared/mackit/src, recopiée par _tools/sync_shared.sh. Pur : ne dépend ni de
 * l'interface, ni du journal, ni du dossier de données de l'appli (voir configureBottles).
 *
 * Interface :
 *  - configureBottles({ statePath?, log? })         injecte le fichier d'état et le journal (muet par défaut)
 *  - listBottles(): IBottle[]                       énumération (CrossOver, $WINEPREFIX, ~/.wine, roots de bottles.json)
 *  - bottleForPath(p): IBottle | undefined          bouteille contenant un chemin hôte
 *  - winPathToHost(bottle, "C:\\x") / hostToWinPath un chemin Windows <-> hôte
 *  - readRegString(bottle, hive, key, value)        lit system.reg / user.reg
 *  - runInBottle(exe, args, env?)                   {executable, args, env} pour lancer un .exe dans sa bouteille
 *  - wineCommand(bottle, args)                      {executable, args, env} pour un outil Wine (reg, regedit…)
 *  - crossoverBottleDir() / crossoverBinDir()        où CrossOver range ses bouteilles et ses outils
 *  - addBottleRoot(dir)                              ajoute un dossier de bouteilles à bottles.json
 *
 * État : bottles.json  { roots?: string[], activeBottle?: string, exclusive?: boolean, userDir?: string }
 * (mORTEX : <userData>/bottles.json, injecté par bottles.ts ; sans configuration :
 * ~/Library/Application Support/mackit/bottles.json)
 * `exclusive` + `activeBottle` : ne voir que cette bouteille (essais de dev)
 * `userDir` (drive_c/users/<u>) est écrit par mORTEX et lu par son processus principal
 * (main/src/macos/bottlePaths.ts) pour rediriger documents et localAppData.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type BottleKind = "crossover" | "wine";

export interface IBottle {
  path: string;
  name: string;
  kind: BottleKind;
  /** drive_c/users/<user> */
  userDir: string;
}

export interface IBottleLaunch {
  executable: string;
  args: string[];
  env: Record<string, string>;
}

export interface IBottlesState {
  roots?: string[];
  activeBottle?: string;
  exclusive?: boolean;
  userDir?: string;
}

/** Journal facultatif du moteur ; même forme que `log` de mORTEX. */
export type BottlesLog = (level: "debug" | "warn", message: string, metadata?: unknown) => void;

export interface IBottlesConfig {
  /** Fichier d'état (bottles.json), évalué à chaque accès. */
  statePath?: () => string;
  log?: BottlesLog;
}

const CX_APPS = ["/Applications/CrossOver.app", "/Applications/CrossOver Preview.app"];

let stateFile: () => string = () =>
  path.join(os.homedir(), "Library/Application Support/mackit/bottles.json");
let journal: BottlesLog = () => {};

/** Branche le fichier d'état et le journal de l'appli ; sans appel, état dans mackit et journal muet. */
export function configureBottles(config: IBottlesConfig): void {
  if (config.statePath !== undefined) stateFile = config.statePath;
  if (config.log !== undefined) journal = config.log;
}

/** CrossOver Preview si la bouteille est marquée Preview=1, sinon CrossOver. */
function cxBin(bottle: IBottle): string {
  let preview = false;
  try {
    preview = /^"Preview"\s*=\s*"1"/m.test(
      fs.readFileSync(path.join(bottle.path, "cxbottle.conf"), "utf8"),
    );
  } catch {
    /* pas de cxbottle.conf */
  }
  const app = preview ? CX_APPS[1] : CX_APPS[0];
  return path.join(
    fs.existsSync(app) ? app : (CX_APPS.find(fs.existsSync) ?? CX_APPS[0]),
    "Contents/SharedSupport/CrossOver/bin",
  );
}

export function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isNonEmptyDir(p: string): boolean {
  try {
    return fs.readdirSync(p).length > 0;
  } catch {
    return false;
  }
}

function isBottleDir(p: string): boolean {
  return isDir(path.join(p, "drive_c")) && fs.existsSync(path.join(p, "system.reg"));
}

export function readState(): IBottlesState {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), "utf8")) as IBottlesState;
  } catch {
    return {};
  }
}

export function writeState(patch: IBottlesState): void {
  try {
    const next = { ...readState(), ...patch };
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(next, null, 2));
  } catch (err) {
    journal("warn", "could not write bottles.json", { err });
  }
}

function run(cmd: string, args: string[]): string | undefined {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    return undefined;
  }
}

function crossoverRoots(): string[] {
  const roots = [path.join(os.homedir(), "Library/Application Support/CrossOver/Bottles")];
  const custom = run("defaults", ["read", "com.codeweavers.CrossOver", "BottleDir"]);
  if (custom) roots.push(custom);
  return roots;
}

/** Dossier où CrossOver range ses bouteilles : celui de ses préférences, sinon celui par défaut. */
export function crossoverBottleDir(): string {
  return crossoverRoots().at(-1) as string;
}

/** Dossier `bin` de CrossOver ; la version stable d'abord, undefined s'il n'est pas installé. */
export function crossoverBinDir(): string | undefined {
  const app = CX_APPS.find((candidate) => fs.existsSync(candidate));
  return app && path.join(app, "Contents/SharedSupport/CrossOver/bin");
}

/** Ajoute un dossier de bouteilles à ceux que l'appli parcourt. */
export function addBottleRoot(dir: string): void {
  const roots = readState().roots ?? [];
  if (!roots.includes(dir)) writeState({ roots: [...roots, dir] });
}

function pickUser(bottle: string): string {
  const usersDir = path.join(bottle, "drive_c/users");
  let users: string[] = [];
  try {
    users = fs.readdirSync(usersDir).filter((u) => u !== "Public" && isDir(path.join(usersDir, u)));
  } catch {
    /* pas de users */
  }
  const withGames = users.find((u) => isDir(path.join(usersDir, u, "Documents/My Games")));
  const chosen = withGames ?? users.find((u) => u === "crossover") ?? users[0] ?? "crossover";
  return path.join(usersDir, chosen);
}

function kindOf(bottle: string): BottleKind {
  if (fs.existsSync(path.join(bottle, "cxbottle.conf"))) return "crossover";
  return "wine";
}

export function listBottles(): IBottle[] {
  const state = readState();
  const seen = new Set<string>();
  const result: IBottle[] = [];
  const add = (p: string) => {
    const real = path.resolve(p);
    if (seen.has(real) || !isBottleDir(real)) return false;
    seen.add(real);
    result.push({
      path: real,
      name: path.basename(real),
      kind: kindOf(real),
      userDir: pickUser(real),
    });
    return true;
  };
  const scanRoot = (root: string) => {
    if (add(root)) return;
    try {
      for (const e of fs.readdirSync(root)) add(path.join(root, e));
    } catch {
      /* racine absente */
    }
  };
  [
    ...(state.roots ?? []),
    ...crossoverRoots(),
    ...(process.env.WINEPREFIX ? [process.env.WINEPREFIX] : []),
    path.join(os.homedir(), ".wine"),
  ].forEach(scanRoot);
  if (state.activeBottle && state.exclusive) {
    return result.filter((b) => b.path === state.activeBottle);
  }
  if (state.activeBottle) {
    result.sort((a, b) => +(b.path === state.activeBottle) - +(a.path === state.activeBottle));
  }
  return result;
}

export function bottleForPath(p: string, bottles: IBottle[] = listBottles()): IBottle | undefined {
  const real = path.resolve(p);
  return bottles.find((b) => real === b.path || real.startsWith(b.path + path.sep));
}

/** "C:\\Games\\X" -> "<bottle>/drive_c/Games/X" ; "Z:\\a" -> "/a" */
export function winPathToHost(bottle: IBottle, winPath: string): string {
  const m = /^([A-Za-z]):[\\/]*(.*)$/.exec(winPath);
  if (!m) return winPath.replace(/\\/g, "/");
  const letter = m[1].toLowerCase();
  const rest = m[2].replace(/\\/g, "/");
  if (letter === "c") return path.join(bottle.path, "drive_c", rest);
  let root: string | undefined;
  try {
    const link = path.join(bottle.path, "dosdevices", `${letter}:`);
    root = path.resolve(path.dirname(link), fs.readlinkSync(link));
  } catch {
    root = letter === "z" ? "/" : undefined;
  }
  return root === undefined ? winPath : path.join(root, rest);
}

export function hostToWinPath(bottle: IBottle, hostPath: string): string {
  const cDrive = path.join(bottle.path, "drive_c") + path.sep;
  if (hostPath.startsWith(cDrive))
    return "C:\\" + hostPath.slice(cDrive.length).replace(/\//g, "\\");
  return "Z:" + hostPath.replace(/\//g, "\\");
}

function unescapeReg(s: string): string {
  return s.replace(/\\(["\\])/g, "$1");
}

/** Valeur REG_SZ d'une clé de system.reg (HKLM) ou user.reg (HKCU). */
export function readRegString(
  bottle: IBottle,
  hive: string,
  key: string,
  value: string,
): string | undefined {
  const file =
    hive === "HKEY_LOCAL_MACHINE"
      ? "system.reg"
      : hive === "HKEY_CURRENT_USER"
        ? "user.reg"
        : undefined;
  if (file === undefined) return undefined;
  let text: string;
  try {
    text = fs.readFileSync(path.join(bottle.path, file), "latin1");
  } catch {
    return undefined;
  }
  const header = "[" + key.replace(/\\/g, "\\\\").toLowerCase() + "]";
  const wanted = `"${value.replace(/\\/g, "\\\\")}"=`.toLowerCase();
  let inKey = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("[")) {
      const end = line.lastIndexOf("]");
      inKey = line.slice(0, end + 1).toLowerCase() === header;
    } else if (inKey && line.toLowerCase().startsWith(wanted)) {
      const m = /^"(.*)"\s*$/.exec(line.slice(wanted.length).trim());
      return m ? unescapeReg(m[1]) : undefined;
    }
  }
  return undefined;
}

/** Commande pour lancer `exe` (chemin hôte) dans sa bouteille ; undefined si hors bouteille. */
export function runInBottle(
  exe: string,
  args: string[] = [],
  cwd?: string,
): IBottleLaunch | undefined {
  const bottle = bottleForPath(exe);
  if (bottle === undefined) return undefined;
  switch (bottle.kind) {
    case "crossover":
      return {
        executable: path.join(cxBin(bottle), "cxstart"),
        args: ["--bottle", bottle.name, ...(cwd ? ["--workdir", cwd] : []), exe, ...args],
        env: { CX_BOTTLE_PATH: path.dirname(bottle.path) },
      };
    default:
      return {
        executable: "wine64",
        args: ["start", "/unix", exe, ...args],
        env: { WINEPREFIX: bottle.path },
      };
  }
}

/**
 * Environnement d'un processus wine : celui de l'appli, plus `extra`. Python (3.7+) pose LC_CTYPE=C.UTF-8 dans
 * son environnement quand la session n'a pas de langue (appli lancée du Finder) et les processus qu'il lance
 * l'héritent ; wine en déduit « en-US » et réécrit la langue et les noms de polices de la bouteille (vérifié sur
 * une vraie bouteille : fr-FR devenait en-US après un simple `regedit`). On retire cette valeur de secours.
 */
export function wineEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env = { ...process.env, ...extra };
  if (env.LC_CTYPE === "C.UTF-8") delete env.LC_CTYPE;
  return env;
}

/** Commande pour lancer un outil de Wine (`regedit`, `reg`…) dans la bouteille, en attendant sa fin. */
export function wineCommand(bottle: IBottle, args: string[]): IBottleLaunch {
  switch (bottle.kind) {
    case "crossover":
      return {
        executable: path.join(cxBin(bottle), "wine"),
        args: ["--bottle", bottle.name, ...args],
        env: { CX_BOTTLE_PATH: path.dirname(bottle.path) },
      };
    default:
      return { executable: "wine64", args, env: { WINEPREFIX: bottle.path } };
  }
}
