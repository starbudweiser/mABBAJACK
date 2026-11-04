/**
 * Moteur Mac commun (mORTEX, mABBAJACK, mO2FLATTENER) : la simulation. `plan` dit ce que l'adaptation
 * au Mac ferait d'un dossier de jeu (et de sa bouteille), sans rien écrire : les contrôles, les
 * correctifs prévus, les fichiers écartés avec leur raison, ce qui n'est pas fait et pourquoi.
 * Source unique : _tools/shared/mackit/src, recopiée par _tools/sync_shared.sh. Pur : aucune
 * dépendance à l'interface ; journal facultatif ; textes sous forme de clés (macTexts).
 *
 * Interface :
 *  - plan(gamePath, bottle?, options?): Promise<IMacPlan>
 *
 * Correctifs (dans l'ordre où apply les passe) :
 *  - engine         bottle CrossOver sur DXMT (cxbottle.conf)
 *  - bridge         pont mDLSS (d3d11.dll à la racine du jeu) + DLSS dans les réglages de Bottled
 *  - displayTweaks  SSEDisplayTweaks.ini pour DXMT (SwapEffect, SwapBufferCount, VideoMemorySizeMb)
 *  - duplicates     DLL en double avec Bottled (Terrain Helper, Inverse Square Lighting, EVLaS) écartées
 *  - compiler       compilateur HLSL de Microsoft à la place de celui de Wine (d3dcompiler_47.dll)
 *  - overrides      overrides DLL « native,builtin » des DLL de substitution du jeu (registre)
 * Ce qui demande un autre mod (Bottled Shaders absent ou ancien, SSE Display Tweaks absent) n'est pas
 * un correctif : `bottled` le dit, et les contrôles restent dans `checks`.
 *
 * Le plan se rejoue tel quel (apply) et se transmet en JSON : il garde l'empreinte de chaque fichier
 * au moment de la simulation, et apply refuse d'écrire par-dessus un fichier qui a changé depuis.
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { type IBottledStatus, bottledStatus } from "./bottledVersion";
import { type IHealthCheck, checkBottleHealth, setBottleEnv } from "./bottleHealth";
import { type BottlesLog, type IBottle, readRegString } from "./bottlesCore";
import { OVERRIDES_KEY, planOverrides, proxyDlls, readOurs } from "./dllOverrides";
import {
  type DxmtCheckId,
  type IDxmtCheck,
  bottledDuplicates,
  displayTweaksPath,
  displayTweaksTargets,
  runDxmtChecks,
} from "./dxmtChecks";
import { nativeCompilerSource } from "./hlslCompiler";
import { type IIniPlan, type IPlannedChange, loadIniFile, planChanges } from "./iniEdit";
import { fileHash } from "./macManifest";
import { type IMacText, type MacTextKey, macText } from "./macTexts";

/** Les correctifs, dans l'ordre où apply les passe. */
export const MAC_FIX_IDS = [
  "engine",
  "bridge",
  "displayTweaks",
  "duplicates",
  "compiler",
  "overrides",
] as const;

export type MacFixId = (typeof MAC_FIX_IDS)[number];

/** Une action du plan. Les opérations sur fichier gardent l'empreinte vue à la simulation. */
export type MacOperation =
  | { kind: "write"; file: string; baseHash: string | null; content: string }
  | { kind: "copy"; file: string; baseHash: string | null; source: string; sourceHash: string }
  | { kind: "ini"; file: string; baseHash: string | null; plan: IIniPlan }
  | { kind: "remove"; file: string; baseHash: string | null; reason: IMacText }
  | { kind: "overrides"; bottle: IBottle; dlls: string[] };

export interface IPlannedFix {
  id: MacFixId;
  title: IMacText;
  detail: IMacText;
  /** contrôle qui motive le correctif */
  check?: DxmtCheckId;
  /** fichiers touchés, chemins absolus (pour l'affichage) */
  files: string[];
  /** lignes d'INI qui changent (correctif displayTweaks) */
  changes?: IPlannedChange[];
  ops: MacOperation[];
}

/** correctif qu'on ne fait pas, avec la raison */
export interface ISkippedFix {
  id: MacFixId;
  reason: IMacText;
}

/** fichier du jeu écarté (retiré du dossier, gardé dans _MAC_BACKUP) avec sa raison */
export interface IDiscardedFile {
  file: string;
  fix: MacFixId;
  reason: IMacText;
}

export interface IMacPlan {
  version: 1;
  gamePath: string;
  bottle?: IBottle;
  checks: IDxmtCheck[];
  /** santé de la bouteille ; vide sans bouteille */
  health: IHealthCheck[];
  bottled: IBottledStatus;
  fixes: IPlannedFix[];
  skipped: ISkippedFix[];
  discarded: IDiscardedFile[];
}

export interface IPlanOptions {
  /** d3d11.dll du pont mDLSS, fourni par l'appli ; sans lui le correctif « bridge » est écarté */
  bridgeSource?: string;
  /** version de Bottled Shaders que l'appelant connaît (métadonnées du mod) ; sinon celle de la DLL */
  bottledVersion?: string;
  log?: BottlesLog;
}

interface IContext {
  gamePath: string;
  bottle?: IBottle;
  checks: Map<DxmtCheckId, IDxmtCheck>;
  options: IPlanOptions;
}

type Decision = { fix: IPlannedFix } | { skipped: ISkippedFix } | undefined;

// le pont mDLSS ne sert qu'avec le moteur DXMT et les DLL forcées de la bouteille : sans bouteille, jamais de pont
const BOTTLE_ONLY: MacFixId[] = ["engine", "bridge", "compiler", "overrides"];

const pluginsDir = (gamePath: string) => path.join(gamePath, "Data", "SKSE", "Plugins");
/** réglages de Bottled Shaders, où DLSS se choisit */
const bottledSettings = (gamePath: string) =>
  path.join(pluginsDir(gamePath), "CommunityShaders", "SettingsUser.json");
const DLSS_UPSCALE_METHOD = 3;

const textOf = (file: string) => readFile(file, "utf8").catch(() => undefined);

const skip = (id: MacFixId, key: MacTextKey): Decision => ({
  skipped: { id, reason: macText(key) },
});

async function planEngine(ctx: IContext): Promise<Decision> {
  const { bottle } = ctx;
  if (bottle === undefined) return undefined;
  const check = ctx.checks.get("engine");
  if (check?.status !== "error") return undefined;
  if (bottle.kind !== "crossover") return skip("engine", "mackit.skip.notCrossover");
  const file = path.join(bottle.path, "cxbottle.conf");
  const conf = (await textOf(file)) ?? "";
  return {
    fix: {
      id: "engine",
      title: macText("mackit.fix.engine.title"),
      detail: macText("mackit.fix.engine.detail", { engine: (check.found || "?").toUpperCase() }),
      check: "engine",
      files: [file],
      ops: [
        {
          kind: "write",
          file,
          baseHash: await fileHash(file),
          content: setBottleEnv(conf, "CX_GRAPHICS_BACKEND", "dxmt"),
        },
      ],
    },
  };
}

/** DLSS dans les réglages de Bottled, s'ils existent et ne l'ont pas déjà */
async function dlssOperation(gamePath: string): Promise<MacOperation | undefined> {
  const file = bottledSettings(gamePath);
  const text = await textOf(file);
  if (text === undefined) return undefined;
  try {
    const settings = JSON.parse(text);
    if (settings?.Upscaling?.upscaleMethod === DLSS_UPSCALE_METHOD) return undefined;
    settings.Upscaling = { ...settings.Upscaling, upscaleMethod: DLSS_UPSCALE_METHOD };
    return {
      kind: "write",
      file,
      baseHash: await fileHash(file),
      content: JSON.stringify(settings, null, 1) + "\n",
    };
  } catch {
    return undefined; // réglages illisibles : on n'y touche pas
  }
}

async function planBridge(ctx: IContext): Promise<Decision> {
  if (ctx.bottle === undefined) return undefined; // écarté par plan, avec la raison « aucune bouteille »
  if (ctx.checks.get("bridge")?.status !== "warning") return undefined;
  const { bridgeSource } = ctx.options;
  const sourceHash = bridgeSource === undefined ? null : await fileHash(bridgeSource);
  if (bridgeSource === undefined || sourceHash === null) {
    return skip("bridge", "mackit.skip.bridgeSourceMissing");
  }
  const file = path.join(ctx.gamePath, "d3d11.dll");
  const baseHash = await fileHash(file);
  const dlss = await dlssOperation(ctx.gamePath);
  const ops: MacOperation[] = [
    { kind: "copy", file, baseHash, source: bridgeSource, sourceHash },
    ...(dlss === undefined ? [] : [dlss]),
  ];
  return {
    fix: {
      id: "bridge",
      title: macText("mackit.fix.bridge.title"),
      // un autre d3d11.dll (ENBSeries) est gardé dans _MAC_BACKUP et revient avec l'annulation
      detail: macText(
        baseHash === null ? "mackit.fix.bridge.detail" : "mackit.fix.bridge.detailReplace",
      ),
      check: "bridge",
      files: ops.flatMap((op) => ("file" in op ? [op.file] : [])),
      ops,
    },
  };
}

async function planDisplayTweaks(ctx: IContext): Promise<Decision> {
  const status = ctx.checks.get("displayTweaks")?.status;
  if (status !== "error" && status !== "warning") return undefined;
  const file = displayTweaksPath(ctx.gamePath);
  const ini = await loadIniFile("ini", file);
  if (ini.exists === false) return undefined;
  const changes = Object.entries(displayTweaksTargets()).map(([key, value]) => ({
    section: "Render",
    key,
    value,
  }));
  const iniPlan = planChanges([ini], changes, { insertAt: "start" });
  if (iniPlan.changes.length === 0) return undefined;
  return {
    fix: {
      id: "displayTweaks",
      title: macText("mackit.fix.displayTweaks.title"),
      detail: macText("mackit.fix.displayTweaks.detail"),
      check: "displayTweaks",
      files: [file],
      changes: iniPlan.changes,
      ops: [{ kind: "ini", file, baseHash: await fileHash(file), plan: iniPlan }],
    },
  };
}

/** pourquoi Bottled Shaders écarte cette DLL */
function discardReason(dll: string): IMacText {
  if (/^terrain.?helper/i.test(dll)) return macText("mackit.discard.terrainHelper");
  if (/^inverse.?square/i.test(dll)) return macText("mackit.discard.inverseSquare");
  return macText("mackit.discard.evlas");
}

async function planDuplicates(ctx: IContext): Promise<Decision> {
  if (ctx.checks.get("bottledDuplicates")?.status !== "error") return undefined;
  const names = (await bottledDuplicates(ctx.gamePath)) ?? [];
  if (names.length === 0) return undefined;
  const ops: MacOperation[] = [];
  for (const name of names) {
    const file = path.join(pluginsDir(ctx.gamePath), name);
    ops.push({ kind: "remove", file, baseHash: await fileHash(file), reason: discardReason(name) });
  }
  return {
    fix: {
      id: "duplicates",
      title: macText("mackit.fix.duplicates.title"),
      detail: macText("mackit.fix.duplicates.detail", { dlls: names.join(", ") }),
      check: "bottledDuplicates",
      files: ops.flatMap((op) => ("file" in op ? [op.file] : [])),
      ops,
    },
  };
}

/** le compilateur de Wine ne compile pas Community Shaders ; celui de Microsoft vient avec .NET 8 */
async function planCompiler(ctx: IContext): Promise<Decision> {
  const { bottle } = ctx;
  const shaders = ctx.checks.get("shaders");
  if (bottle === undefined || shaders?.shaders?.compiler !== "wine") return undefined;
  if (shaders.status !== "error" && shaders.status !== "warning") return undefined;
  const source = await nativeCompilerSource(bottle.path);
  const sourceHash = source === undefined ? null : await fileHash(source);
  if (source === undefined || sourceHash === null)
    return skip("compiler", "mackit.skip.dotnetMissing");
  const file = path.join(bottle.path, "drive_c", "windows", "system32", "d3dcompiler_47.dll");
  return {
    fix: {
      id: "compiler",
      title: macText("mackit.fix.compiler.title"),
      detail: macText("mackit.fix.compiler.detail"),
      check: "shaders",
      files: [file],
      ops: [{ kind: "copy", file, baseHash: await fileHash(file), source, sourceHash }],
    },
  };
}

/** `willHaveBridge` : le pont posera d3d11.dll, qui aura donc besoin de son override */
async function planOverridesFix(ctx: IContext, willHaveBridge: boolean): Promise<Decision> {
  const { bottle } = ctx;
  if (bottle === undefined) return undefined;
  const present = new Set(await proxyDlls(ctx.gamePath));
  if (willHaveBridge) present.add("d3d11");
  const missing = planOverrides(
    [...present],
    (dll) => readRegString(bottle, "HKEY_CURRENT_USER", OVERRIDES_KEY, dll),
    await readOurs(bottle),
  ).add;
  if (missing.length === 0) return undefined;
  return {
    fix: {
      id: "overrides",
      title: macText("mackit.fix.overrides.title"),
      detail: macText("mackit.fix.overrides.detail", {
        dlls: missing.map((dll) => `${dll}.dll`).join(", "),
      }),
      files: [],
      ops: [{ kind: "overrides", bottle, dlls: missing }],
    },
  };
}

export async function plan(
  gamePath: string,
  bottle?: IBottle,
  options: IPlanOptions = {},
): Promise<IMacPlan> {
  const checks = await runDxmtChecks(bottle?.path, gamePath);
  const health = bottle === undefined ? [] : await checkBottleHealth(bottle, gamePath);
  const ctx: IContext = {
    gamePath,
    bottle,
    checks: new Map(checks.map((check) => [check.id, check])),
    options,
  };

  const decisions: Decision[] = [];
  for (const step of [planEngine, planBridge, planDisplayTweaks, planDuplicates, planCompiler]) {
    decisions.push(await step(ctx));
  }
  const willHaveBridge = decisions.some(
    (d) => d !== undefined && "fix" in d && d.fix.id === "bridge",
  );
  decisions.push(await planOverridesFix(ctx, willHaveBridge));

  const fixes = decisions.flatMap((d) => (d !== undefined && "fix" in d ? [d.fix] : []));
  const skipped = decisions.flatMap((d) => (d !== undefined && "skipped" in d ? [d.skipped] : []));
  if (bottle === undefined) {
    for (const id of BOTTLE_ONLY) skipped.push({ id, reason: macText("mackit.skip.noBottle") });
  }
  const discarded = fixes.flatMap((fix) =>
    fix.ops.flatMap((op) =>
      op.kind === "remove" ? [{ file: op.file, fix: fix.id, reason: op.reason }] : [],
    ),
  );

  const result: IMacPlan = {
    version: 1,
    gamePath,
    bottle,
    checks,
    health,
    bottled: bottledStatus(checks.find((c) => c.id === "shaders")?.shaders, options.bottledVersion),
    fixes,
    skipped,
    discarded,
  };
  options.log?.("debug", "mackit plan", {
    fixes: fixes.map((fix) => fix.id),
    skipped: skipped.map((s) => s.id),
  });
  return result;
}
