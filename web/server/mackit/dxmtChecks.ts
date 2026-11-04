/**
 * mORTEX (macOS) : bilan d'une bouteille CrossOver pour le rendu moderne de Skyrim SE sous DXMT
 * (Community Shaders « Bottled », presets ENB par le pont mDLSS). Voir l'Atelier DXMT.
 *
 * Interface :
 *  - runDxmtChecks(bottlePath, gamePath): Promise<IDxmtCheck[]>   les cinq contrôles
 *  - fixDisplayTweaks(gamePath): Promise<void>                     SSE Display Tweaks optimisé pour DXMT
 *  - useDxmt(bottlePath): Promise<void>                             moteur graphique de la bouteille sur DXMT
 *
 * Contrôles :
 *  - engine : moteur graphique de la bouteille (CX_GRAPHICS_BACKEND de cxbottle.conf) ; seul
 *    DXMT offre le niveau Direct3D 11 qu'exige Bottled Shaders
 *  - bridge : pont de mDLSS (d3d11.dll à la racine du jeu). Indispensable à DLSS : Streamline
 *    transmet ses textures en void*, que le nvngx.dll de DXMT refuse (0xBAD00005, écran noir) ;
 *    le pont les lui repasse en ID3D11Resource*. Il imite aussi l'ENB SDK pour les presets ENB.
 *    « warning » quand Bottled Shaders est installé sans lui, « na » sans Bottled
 *  - displayTweaks : réglages de SSE Display Tweaks pour DXMT (voir DISPLAY_TWEAKS) ; SwapEffect
 *    est obligatoire (seul flip_discard crée la swap chain, sinon 0x80070057 et écran noir), les
 *    autres sont des optimisations
 *  - bottledDuplicates : Terrain Helper et Inverse Square Lighting autonomes, déjà intégrés à
 *    Bottled Shaders, qui font planter le jeu, et EVLaS, pour lequel Bottled coupe tous ses effets
 *    (« Incompatible DLL … EVLaS.dll ») ; « na » sans Bottled Shaders
 *  - csBuild : quel Community Shaders est déployé : Bottled Shaders (préparé pour CrossOver) ou la
 *    version d'origine, qu'une collection peut apporter avec des modules plus récents qu'elle ne sait
 *    pas lire (« requires a newer version of community shaders ») : des centaines de shaders échouent
 *    alors, sans que le journal le dise au niveau de détail par défaut
 *  - shaders : Community Shaders compile-t-il ses shaders ? Lit son journal (le dernier lancement du
 *    jeu) et regarde quel compilateur HLSL la bouteille utilise : celui de Wine refuse le mot-clé
 *    `namespace` des sources d'origine (« unexpected KW_NAMESPACE »)
 */
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { setBottleEnv } from "./bottleHealth";
import { applyChanges, loadIniFile, planChanges } from "./iniEdit";

export type DxmtCheckId =
  | "engine"
  | "bridge"
  | "displayTweaks"
  | "bottledDuplicates"
  | "csBuild"
  | "shaders";
export type DxmtCheckStatus = "ok" | "warning" | "error" | "na";

export interface IDxmtCheck {
  id: DxmtCheckId;
  status: DxmtCheckStatus;
  /** ce qui a été trouvé : moteur, valeur de SwapEffect, DLL en double */
  found?: string;
  /** contrôle « shaders » : ce que le journal et la bouteille ont montré */
  shaders?: IShadersReport;
}

export interface IShadersReport {
  /** version de CommunityShaders.dll, « 1.2.1 » */
  version?: string;
  /** la DLL est celle de Bottled Shaders (elle porte son nom), pas la version d'origine */
  bottled: boolean;
  /** modules que cette version est trop ancienne pour charger, d'après le journal */
  outdatedFeatures: string[];
  /** le jeu a déjà été lancé et le journal de Community Shaders existe */
  logged: boolean;
  /** shaders dont la compilation a échoué au dernier lancement */
  failures: number;
  /** première raison donnée par le compilateur, « syntax error, unexpected KW_NAMESPACE » */
  reason?: string;
  /** « wine » : d3dcompiler_47 intégré à Wine (180 Ko) ; « native » : celui de Microsoft */
  compiler?: "wine" | "native";
}

/** signature écrite par le pont ENB de mDLSS (son fichier journal) */
const BRIDGE_MARKER = "mDLSS_enb_bridge.log";
const PLUGINS_DIR = ["Data", "SKSE", "Plugins"];
const DISPLAY_TWEAKS_INI = "SSEDisplayTweaks.ini";

/**
 * Réglages [Render] validés sous DXMT (système « commun » de mDLSS) :
 *  - SwapEffect : obligatoire
 *  - SwapBufferCount : triple tampon, images plus régulières
 *  - VideoMemorySizeMb : DXMT signale mal la mémoire vidéo, que l'Apple Silicon partage avec la
 *    mémoire vive ; la moitié de la mémoire, plafonnée à 16 Go comme dans le système de référence
 */
export function displayTweaksTargets(totalMemory = os.totalmem()): Record<string, string> {
  const videoMb = Math.min(16384, Math.floor(totalMemory / 2 / 1024 / 1024 / 1024) * 1024);
  return { SwapEffect: "flip_discard", SwapBufferCount: "3", VideoMemorySizeMb: String(videoMb) };
}

const settingLine = (key: string) => new RegExp(`^(\\s*${key}\\s*=\\s*)([^\\s;#]*)(.*)$`, "im");

const readText = (file: string) => readFile(file, "utf8").catch(() => undefined);

export async function graphicsBackend(bottlePath: string): Promise<string | undefined> {
  const conf = await readText(path.join(bottlePath, "cxbottle.conf"));
  return conf?.match(/"CX_GRAPHICS_BACKEND"\s*=\s*"([^"]*)"/)?.[1]?.toLowerCase();
}

export async function hasEnbBridge(gamePath: string): Promise<boolean> {
  const dll = await readFile(path.join(gamePath, "d3d11.dll")).catch(() => undefined);
  return dll !== undefined && dll.includes(BRIDGE_MARKER);
}

/**
 * Pose le pont de mDLSS (`source`) à côté de SkyrimSE.exe. Un autre d3d11.dll (ENBSeries) est
 * gardé à part et revient avec l'annulation.
 */
export async function installBridge(
  gamePath: string,
  source: string,
): Promise<() => Promise<void>> {
  const target = path.join(gamePath, "d3d11.dll");
  const before = await readFile(target).catch(() => undefined);
  await writeFile(target, await readFile(source));
  return async () => {
    if (before === undefined) {
      await rm(target, { force: true });
    } else {
      await writeFile(target, before);
    }
  };
}

/** valeurs actuelles des réglages visés ("" si absent), undefined sans SSE Display Tweaks */
export async function displayTweaksSettings(
  gamePath: string,
): Promise<Record<string, string> | undefined> {
  const ini = await readText(path.join(gamePath, ...PLUGINS_DIR, DISPLAY_TWEAKS_INI));
  if (ini === undefined) return undefined;
  return Object.fromEntries(
    Object.keys(displayTweaksTargets()).map((key) => [
      key,
      ini.match(settingLine(key))?.[2]?.toLowerCase() ?? "",
    ]),
  );
}

/** Bottled Shaders inscrit son nom dans sa DLL, la version d'origine non */
export function isBottledDll(dll: Buffer): boolean {
  return dll.includes("Bottled");
}

/** DLL autonomes en double avec Bottled Shaders, undefined si Bottled n'est pas installé */
export async function bottledDuplicates(gamePath: string): Promise<string[] | undefined> {
  const plugins = path.join(gamePath, ...PLUGINS_DIR);
  const files = await readdir(plugins).catch(() => [] as string[]);
  const dll = files.find((file) => /^communityshaders\.dll$/i.test(file));
  if (dll === undefined) return undefined;
  const content = await readFile(path.join(plugins, dll)).catch(() => undefined);
  if (content === undefined || !isBottledDll(content)) return undefined;
  return files.filter((file) => /^(terrain.?helper|inverse.?square.*|evlas)\.dll$/i.test(file));
}

/** « 1.2.1.0 » → « 1.2.1 » : la version inscrite dans les ressources d'une DLL Windows */
export function dllFileVersion(dll: Buffer): string | undefined {
  const at = dll.indexOf(Buffer.from("FileVersion", "utf16le"));
  if (at < 0) return undefined;
  const text = dll.subarray(at, at + 120).toString("utf16le");
  const version = text.match(/\d+(?:\.\d+){1,3}/)?.[0];
  return version?.replace(/(\.0)+$/, "");
}

/** les shaders refusés par le compilateur au dernier lancement, d'après CommunityShaders.log */
export function parseShadersLog(text: string): {
  failures: number;
  reason?: string;
  outdatedFeatures: string[];
} {
  const failures = text.match(/Shader compilation failed/g)?.length ?? 0;
  const reason = text.match(/\.hlsl[^\s:]*:\d+:\d+:\s*(?:[EW]\d+:\s*)?(.+)/)?.[1]?.trim();
  const outdatedFeatures = [
    ...text.matchAll(/\] (\S+) [\d-]+ requires a newer version of community shaders/gi),
  ].map((match) => match[1]);
  return { failures, reason, outdatedFeatures };
}

/** Bottled Shaders (versions récentes) écrit BottledShaders.log, la version d'origine CommunityShaders.log */
export const SHADERS_LOG_NAMES = ["BottledShaders.log", "CommunityShaders.log"];

/**
 * Le journal est dans les Documents de la bouteille, selon la boutique du jeu. Les deux noms de
 * journal peuvent coexister (ancienne version puis Bottled) : le plus récemment écrit est celui du
 * dernier lancement du jeu.
 */
async function shadersLog(bottlePath: string): Promise<string | undefined> {
  const users = path.join(bottlePath, "drive_c", "users");
  const names = await readdir(users).catch(() => [] as string[]);
  let latest: { time: number; file: string } | undefined;
  for (const user of names) {
    for (const game of ["Skyrim Special Edition", "Skyrim Special Edition GOG"]) {
      for (const name of SHADERS_LOG_NAMES) {
        const file = path.join(users, user, "Documents", "My Games", game, "SKSE", name);
        const info = await stat(file).catch(() => undefined);
        if (info !== undefined && (latest === undefined || info.mtimeMs > latest.time)) {
          latest = { time: info.mtimeMs, file };
        }
      }
    }
  }
  return latest === undefined ? undefined : readText(latest.file);
}

/** Wine range son d3dcompiler_47 de 180 Ko dans system32 ; celui de Microsoft en fait plus de 4 Mo */
async function hlslCompiler(bottlePath: string): Promise<"wine" | "native" | undefined> {
  const file = path.join(bottlePath, "drive_c", "windows", "system32", "d3dcompiler_47.dll");
  const info = await stat(file).catch(() => undefined);
  if (info === undefined) return undefined;
  return info.size < 1_000_000 ? "wine" : "native";
}

/** undefined sans Community Shaders ; sans bouteille, ni journal ni compilateur */
export async function shadersReport(
  bottlePath: string | undefined,
  gamePath: string,
): Promise<IShadersReport | undefined> {
  const dll = await readFile(path.join(gamePath, ...PLUGINS_DIR, "CommunityShaders.dll")).catch(
    () => undefined,
  );
  if (dll === undefined) return undefined;
  const [log, compiler] =
    bottlePath === undefined
      ? [undefined, undefined]
      : await Promise.all([shadersLog(bottlePath), hlslCompiler(bottlePath)]);
  return {
    version: dllFileVersion(dll),
    bottled: isBottledDll(dll),
    logged: log !== undefined,
    ...parseShadersLog(log ?? ""),
    compiler,
  };
}

function shadersCheck(report: IShadersReport | undefined): IDxmtCheck {
  if (report === undefined) return { id: "shaders", status: "na" };
  return {
    id: "shaders",
    // sans journal on ne sait rien : jamais « ok » pour un jeu qui n'a pas encore tourné ; des
    // modules trop récents font échouer la compilation sans que le journal l'écrive
    status: !report.logged
      ? "na"
      : report.failures > 0 || report.outdatedFeatures.length > 0
        ? "error"
        : "ok",
    shaders: report,
  };
}

/** Bottled Shaders attendu sous CrossOver ; la version d'origine est trop ancienne pour des modules
    plus récents, ce qui est une erreur, et sinon déconseillée */
function csBuildCheck(report: IShadersReport | undefined): IDxmtCheck {
  if (report === undefined) return { id: "csBuild", status: "na" };
  return {
    id: "csBuild",
    status: report.outdatedFeatures.length > 0 ? "error" : report.bottled ? "ok" : "warning",
    found: report.outdatedFeatures.join(", "),
    shaders: report,
  };
}

/** `bottlePath` absent (jeu lancé hors d'une bouteille) : le moteur graphique est « na », sans journal de shaders */
export async function runDxmtChecks(
  bottlePath: string | undefined,
  gamePath: string,
): Promise<IDxmtCheck[]> {
  const [engine, bridge, tweaks, duplicates, shaders] = await Promise.all([
    bottlePath === undefined ? undefined : graphicsBackend(bottlePath),
    hasEnbBridge(gamePath),
    displayTweaksSettings(gamePath),
    bottledDuplicates(gamePath),
    shadersReport(bottlePath, gamePath),
  ]);
  return [
    bottlePath === undefined
      ? { id: "engine", status: "na" }
      : { id: "engine", status: engine === "dxmt" ? "ok" : "error", found: engine ?? "" },
    { id: "bridge", status: bridge ? "ok" : duplicates === undefined ? "na" : "warning" },
    displayTweaksCheck(tweaks),
    {
      id: "bottledDuplicates",
      status: duplicates === undefined ? "na" : duplicates.length > 0 ? "error" : "ok",
      found: duplicates?.join(", ") ?? "",
    },
    csBuildCheck(shaders),
    shadersCheck(shaders),
  ];
}

function displayTweaksCheck(tweaks: Record<string, string> | undefined): IDxmtCheck {
  if (tweaks === undefined) return { id: "displayTweaks", status: "na" };
  const targets = displayTweaksTargets();
  const off = Object.keys(targets).filter((key) => tweaks[key] !== targets[key].toLowerCase());
  return {
    id: "displayTweaks",
    status: off.includes("SwapEffect") ? "error" : off.length > 0 ? "warning" : "ok",
    found: off.map((key) => `${key} = ${tweaks[key] || "?"}`).join(", "),
  };
}

/**
 * Réglages de SSE Display Tweaks pour un Mac Silicon (M1 Max et au-delà) : image régulière à 60 i/s
 * (physique de Havok alignée dessus), VSync, et les trois réglages DXMT ci-dessus. Les autres
 * lignes et commentaires du fichier restent tels quels.
 */
export function macDisplayTweaks(totalMemory = os.totalmem()) {
  return [
    ...Object.entries(displayTweaksTargets(totalMemory)).map(([key, value]) => ({
      section: "Render",
      key,
      value,
    })),
    { section: "Render", key: "EnableVSync", value: "true" },
    { section: "Render", key: "VSyncPresentInterval", value: "1" },
    { section: "Render", key: "FramerateLimit", value: "60" },
    { section: "HAVOK", key: "MaximumFramerate", value: "60" },
  ];
}

export const displayTweaksPath = (gamePath: string) =>
  path.join(gamePath, ...PLUGINS_DIR, DISPLAY_TWEAKS_INI);

/** SSE Display Tweaks est-il installé (son INI existe dans le dossier du jeu) ? */
export async function hasDisplayTweaks(gamePath: string): Promise<boolean> {
  return (await readText(displayTweaksPath(gamePath))) !== undefined;
}

/** Applique macDisplayTweaks ; rend la fonction qui remet le fichier tel qu'il était */
export async function applyMacDisplayTweaks(gamePath: string): Promise<() => Promise<void>> {
  const target = displayTweaksPath(gamePath);
  const before = await readFile(target);
  const file = await loadIniFile("ini", target);
  if (file.exists === false) throw new Error(`${DISPLAY_TWEAKS_INI} introuvable`);
  await applyChanges(planChanges([file], macDisplayTweaks(), { insertAt: "start" }));
  return async () => {
    await writeFile(target, before);
  };
}

export async function fixDisplayTweaks(gamePath: string): Promise<void> {
  const file = await loadIniFile("ini", path.join(gamePath, ...PLUGINS_DIR, DISPLAY_TWEAKS_INI));
  if (file.exists === false) throw new Error(`${DISPLAY_TWEAKS_INI} introuvable`);
  const changes = Object.entries(displayTweaksTargets()).map(([key, value]) => ({
    section: "Render",
    key,
    value,
  }));
  // les clés absentes s'ajoutent sous [Render] ; l'écriture traverse le lien : la copie du dossier
  // de préparation suit
  await applyChanges(planChanges([file], changes, { insertAt: "start" }));
}

/**
 * Passe la bouteille sur DXMT (CX_GRAPHICS_BACKEND de cxbottle.conf). CrossOver relit ce réglage
 * au démarrage de la bouteille : il vaut dès le prochain lancement du jeu.
 */
export async function useDxmt(bottlePath: string): Promise<void> {
  const file = path.join(bottlePath, "cxbottle.conf");
  const conf = await readFile(file, "utf8").catch(() => "");
  await writeFile(file, setBottleEnv(conf, "CX_GRAPHICS_BACKEND", "dxmt"));
}
