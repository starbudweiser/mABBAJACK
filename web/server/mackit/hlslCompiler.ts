/**
 * mORTEX (macOS) : le compilateur de shaders HLSL de la bouteille.
 *
 * Wine range dans system32 son propre d3dcompiler_47 (180 Ko), qui refuse ce que Community
 * Shaders écrit en HLSL (« unexpected KW_NAMESPACE »). Le compilateur de Microsoft, lui, le
 * compile : il est déjà sur le disque quand le .NET 8 Desktop de Microsoft est installé dans la
 * bouteille (D3DCompiler_47_cor3.dll, signé Microsoft). On le pose sous le nom attendu, en gardant
 * la copie de Wine pour pouvoir tout remettre.
 *
 * Interface :
 *  - nativeCompilerSource(bottlePath): Promise<string | undefined>   le compilateur de Microsoft
 *  - installNativeCompiler(bottlePath, source): Promise<undo>        le pose ; undo remet Wine
 */
import { copyFile, readdir, rename, rm, stat } from "node:fs/promises";
import * as path from "node:path";

/** en dessous, c'est le d3dcompiler_47 de Wine (180 Ko) ; celui de Microsoft dépasse 4 Mo */
export const NATIVE_MIN_BYTES = 1_000_000;

const system32 = (bottlePath: string) => path.join(bottlePath, "drive_c", "windows", "system32");
const target = (bottlePath: string) => path.join(system32(bottlePath), "d3dcompiler_47.dll");
const WINE_COPY = "d3dcompiler_47.dll.wine";

const sizeOf = (file: string) =>
  stat(file).then(
    (info) => info.size,
    () => undefined,
  );

/** compare « 8.0.9 » et « 8.0.10 » comme des nombres */
const byVersion = (lhs: string, rhs: string) =>
  lhs.localeCompare(rhs, undefined, { numeric: true });

export async function nativeCompilerSource(bottlePath: string): Promise<string | undefined> {
  const root = path.join(
    bottlePath,
    "drive_c",
    "Program Files",
    "dotnet",
    "shared",
    "Microsoft.WindowsDesktop.App",
  );
  const versions = (await readdir(root).catch(() => [] as string[])).sort(byVersion).reverse();
  for (const version of versions) {
    const file = path.join(root, version, "D3DCompiler_47_cor3.dll");
    if (((await sizeOf(file)) ?? 0) >= NATIVE_MIN_BYTES) return file;
  }
  return undefined;
}

export async function installNativeCompiler(
  bottlePath: string,
  source: string,
): Promise<() => Promise<void>> {
  const dll = target(bottlePath);
  const backup = path.join(system32(bottlePath), WINE_COPY);
  const current = await sizeOf(dll);
  // la copie de Wine n'est gardée qu'une fois : un second essai ne la remplace pas par la nôtre
  const keptWine = current !== undefined && current < NATIVE_MIN_BYTES;
  if (keptWine) await rename(dll, backup);
  await copyFile(source, dll);
  return async () => {
    if (keptWine) {
      await rm(dll, { force: true });
      await rename(backup, dll);
    }
  };
}
