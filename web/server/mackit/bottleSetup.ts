/**
 * mORTEX (macOS) : prépare une bouteille CrossOver pour Skyrim, sur le Mac de l'utilisateur.
 *
 * Rien n'est livré avec l'appli : la bouteille est créée par le CrossOver de l'utilisateur, et Steam,
 * VC++ et .NET sont téléchargés depuis les sites de Valve et de Microsoft, après son accord.
 *
 * Interface :
 *  - setupSteps(options): SetupStep[]                       étapes dans l'ordre
 *  - stepDownloads(step): IDownloadFile[]                   fichiers dont l'étape a besoin
 *  - stepCommands(step, context): IBottleLaunch[]           commandes de l'étape, à lancer dans l'ordre
 *  - runBottleSetup(options, onStep, tools?)                exécute le tout
 *  - installDotnetRuntime(bottlePath)                       .NET 8 Desktop dans une bouteille existante
 *  - steamPath(bottleDir)                                   Steam.exe dans la bouteille
 *  - openSteam(bottleDir?)                                  ouvre Steam dans la bouteille préparée
 *  - checkDestination(dir)                                  le disque peut-il accueillir la bouteille ?
 */
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rm, statfs, symlink } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { IBottleLaunch } from "./bottlesCore";
import { addBottleRoot, crossoverBinDir, crossoverBottleDir, runInBottle } from "./bottlesCore";

export const SETUP_BOTTLE = "Skyrim-mORTEX";

export type SetupStep = "bottle" | "vcredist" | "dotnet8" | "netfx48" | "steam";
export type StepStatus = "running" | "done";

export interface IBottleSetupOptions {
  /** .NET Framework 4.8, pour les anciens outils comme Nemesis ou FNIS. */
  netfx48: boolean;
  /** Dossier choisi par l'utilisateur ; par défaut celui de CrossOver. */
  bottleDir?: string;
}

/** Bouteille, Steam, Skyrim et quelques mods. */
export const MIN_FREE_BYTES = 30 * 1024 ** 3;

export interface IDownloadFile {
  name: string;
  url: string;
}

export interface ISetupContext {
  /** Dossier `bin` de CrossOver. */
  bin: string;
  /** Dossier des bouteilles (CX_BOTTLE_PATH). */
  bottleDir: string;
  /** Dossier des fichiers téléchargés. */
  downloads: string;
  /** Nom de la bouteille ; par défaut celle que prépare l'assistant. */
  bottle?: string;
}

/** `mayFail` : une clé déjà retirée par un essai précédent n'empêche pas de continuer. */
export interface ISetupCommand extends IBottleLaunch {
  mayFail?: boolean;
}

export interface ISetupTools {
  run: (command: ISetupCommand) => Promise<void>;
  download: (file: IDownloadFile, dir: string) => Promise<void>;
  /** Rend visible dans CrossOver une bouteille créée ailleurs que dans son dossier. */
  link: (target: string, linkPath: string) => Promise<void>;
}

const DOWNLOADS: Partial<Record<SetupStep, IDownloadFile[]>> = {
  vcredist: [
    { name: "vc_redist.x64.exe", url: "https://aka.ms/vs/17/release/vc_redist.x64.exe" },
    { name: "vc_redist.x86.exe", url: "https://aka.ms/vs/17/release/vc_redist.x86.exe" },
  ],
  dotnet8: [
    {
      name: "windowsdesktop-runtime-8-win-x64.exe",
      url: "https://aka.ms/dotnet/8.0/windowsdesktop-runtime-win-x64.exe",
    },
  ],
  netfx48: [{ name: "ndp48.exe", url: "https://go.microsoft.com/fwlink/?linkid=2088631" }],
  steam: [
    {
      name: "SteamSetup.exe",
      url: "https://cdn.cloudflare.steamstatic.com/client/installer/SteamSetup.exe",
    },
  ],
};

const SILENT = ["/install", "/quiet", "/norestart"];
const NDP_V4 = "Software\\Microsoft\\NET Framework Setup\\NDP\\v4";
const NDP_V4_32 = "Software\\Wow6432Node\\Microsoft\\NET Framework Setup\\NDP\\v4";
const OVERRIDES_KEY = "HKCU\\Software\\Wine\\DllOverrides";
const MAC_DRIVER_KEY = "HKCU\\Software\\Wine\\Mac Driver";

export function setupSteps(options: IBottleSetupOptions): SetupStep[] {
  return [
    "bottle",
    "vcredist",
    "dotnet8",
    ...(options.netfx48 ? ["netfx48" as const] : []),
    "steam",
  ];
}

export const stepDownloads = (step: SetupStep): IDownloadFile[] => DOWNLOADS[step] ?? [];

export function stepCommands(step: SetupStep, context: ISetupContext): ISetupCommand[] {
  const env = { CX_BOTTLE_PATH: context.bottleDir };
  const wine = (...args: string[]): ISetupCommand => ({
    executable: path.join(context.bin, "wine"),
    args: ["--bottle", context.bottle ?? SETUP_BOTTLE, ...args],
    env,
  });
  const installer = (name: string, ...args: string[]) =>
    wine(path.join(context.downloads, name), ...args);

  switch (step) {
    case "bottle":
      return [
        {
          executable: path.join(context.bin, "cxbottle"),
          args: [
            "--bottle",
            SETUP_BOTTLE,
            "--create",
            "--template",
            "win10_64",
            "--param",
            "EnvironmentVariables:CX_GRAPHICS_BACKEND=d3dmetal",
            "--param",
            "EnvironmentVariables:WINEMSYNC=1",
          ],
          env,
        },
        wine("reg", "add", MAC_DRIVER_KEY, "/v", "RetinaMode", "/t", "REG_SZ", "/d", "y", "/f"),
      ];
    case "vcredist":
      return [installer("vc_redist.x64.exe", ...SILENT), installer("vc_redist.x86.exe", ...SILENT)];
    case "dotnet8":
      return [installer("windowsdesktop-runtime-8-win-x64.exe", ...SILENT)];
    case "netfx48":
      // Wine déclare un faux .NET 4.8, et Windows 10 est censé l'inclure : sans ces deux détours,
      // l'installeur répond « déjà installé » et ne fait rien.
      return [
        wine("reg", "add", OVERRIDES_KEY, "/v", "mscoree", "/t", "REG_SZ", "/d", "native", "/f"),
        { ...wine("reg", "delete", `HKLM\\${NDP_V4}`, "/f"), mayFail: true },
        { ...wine("reg", "delete", `HKLM\\${NDP_V4_32}`, "/f"), mayFail: true },
        wine("winecfg", "/v", "win7"),
        installer("ndp48.exe", "/q", "/norestart"),
        wine("winecfg", "/v", "win10"),
      ];
    case "steam":
      return [installer("SteamSetup.exe", "/S")];
  }
}

export const steamPath = (bottleDir: string) =>
  path.join(bottleDir, SETUP_BOTTLE, "drive_c", "Program Files (x86)", "Steam", "Steam.exe");

export function openSteam(bottleDir: string = crossoverBottleDir()): void {
  const command = runInBottle(steamPath(bottleDir));
  if (command === undefined) {
    throw new Error("The prepared bottle was not found");
  }
  spawn(command.executable, command.args, {
    env: { ...process.env, ...command.env },
    detached: true,
    stdio: "ignore",
  }).unref();
}

export type DestinationIssue = "format" | "space";

/** Wine a besoin de liens symboliques et de droits Unix : ni exFAT, ni FAT, ni partage réseau. */
export async function checkDestination(dir: string): Promise<DestinationIssue | undefined> {
  const output = (command: string, args: string[]) =>
    new Promise<string>((resolve) =>
      execFile(command, args, { timeout: 15_000 }, (_err, stdout) => resolve(stdout)),
    );
  // diskutil ne connaît que les points de montage, pas leurs sous-dossiers
  const mountPoint = /%\s+(\/.*)$/m.exec(await output("df", ["-P", dir]))?.[1] ?? dir;
  const info = await output("diskutil", ["info", mountPoint]);
  const format = /Type \(Bundle\):\s+(\S+)/.exec(info)?.[1];
  if (format === undefined || !["apfs", "hfs"].includes(format)) return "format";
  const space = await statfs(dir);
  return space.bavail * space.bsize < MIN_FREE_BYTES ? "space" : undefined;
}

const defaultTools: ISetupTools = {
  link: (target, linkPath) => symlink(target, linkPath),
  run: (command) =>
    new Promise((resolve, reject) =>
      execFile(
        command.executable,
        command.args,
        { env: { ...process.env, ...command.env }, timeout: 10 * 60_000 },
        (err) => {
          // 3010 et 1641 : installé, un redémarrage de Windows est demandé (sans objet ici)
          const code = (err as { code?: unknown } | null)?.code;
          return err && !command.mayFail && code !== 3010 && code !== 1641
            ? reject(err)
            : resolve();
        },
      ),
    ),
  download: (file, dir) =>
    new Promise((resolve, reject) =>
      execFile(
        "curl",
        [
          "--fail",
          "--location",
          "--silent",
          "--show-error",
          "-o",
          path.join(dir, file.name),
          file.url,
        ],
        { timeout: 10 * 60_000 },
        (err) => (err ? reject(err) : resolve()),
      ),
    ),
};

/** Une bouteille déjà créée est réutilisée : on peut relancer après une coupure de réseau. */
export async function runBottleSetup(
  options: IBottleSetupOptions,
  onStep: (step: SetupStep, status: StepStatus) => void,
  tools: ISetupTools = defaultTools,
): Promise<void> {
  const bin = crossoverBinDir();
  if (bin === undefined) {
    throw new Error("CrossOver is not installed");
  }
  const crossoverDir = crossoverBottleDir();
  const bottleDir = options.bottleDir ?? crossoverDir;
  if (bottleDir !== crossoverDir) {
    await mkdir(bottleDir, { recursive: true });
    addBottleRoot(bottleDir);
  }
  // Toujours le même dossier : ce qu'une appli quittée en cours de route a laissé part au nouvel essai.
  const downloads = path.join(os.tmpdir(), "mortex-bottle-setup");
  await rm(downloads, { recursive: true, force: true });
  await mkdir(downloads, { recursive: true });
  const context: ISetupContext = { bin, bottleDir, downloads };
  try {
    for (const step of setupSteps(options)) {
      onStep(step, "running");
      for (const file of stepDownloads(step)) {
        await tools.download(file, downloads);
      }
      const exists = existsSync(path.join(bottleDir, SETUP_BOTTLE, "cxbottle.conf"));
      const commands = stepCommands(step, context);
      for (const command of step === "bottle" && exists ? commands.slice(1) : commands) {
        await tools.run(command);
      }
      if (step === "bottle" && bottleDir !== crossoverDir) {
        await mkdir(crossoverDir, { recursive: true });
        await tools
          .link(path.join(bottleDir, SETUP_BOTTLE), path.join(crossoverDir, SETUP_BOTTLE))
          .catch(() => undefined); // lien déjà là, ou bouteille simplement absente de CrossOver
      }
      onStep(step, "done");
    }
  } finally {
    await rm(downloads, { recursive: true, force: true });
  }
}

/**
 * Installe le .NET 8 Desktop de Microsoft dans une bouteille qui existe déjà (pas forcément celle de
 * l'assistant) : téléchargé depuis microsoft.com sur le Mac de l'utilisateur, jamais livré.
 */
export async function installDotnetRuntime(
  bottlePath: string,
  tools: ISetupTools = defaultTools,
): Promise<void> {
  const bin = crossoverBinDir();
  if (bin === undefined) throw new Error("CrossOver is not installed");
  const downloads = path.join(os.tmpdir(), "mortex-dotnet-setup");
  await rm(downloads, { recursive: true, force: true });
  await mkdir(downloads, { recursive: true });
  const context: ISetupContext = {
    bin,
    bottleDir: path.dirname(bottlePath),
    downloads,
    bottle: path.basename(bottlePath),
  };
  try {
    for (const file of stepDownloads("dotnet8")) await tools.download(file, downloads);
    for (const command of stepCommands("dotnet8", context)) await tools.run(command);
  } finally {
    await rm(downloads, { recursive: true, force: true });
  }
}
