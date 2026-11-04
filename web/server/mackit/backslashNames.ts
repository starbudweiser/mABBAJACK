/**
 * mORTEX (macOS) : des ZIP faits sous Windows écrivent leurs chemins avec des antislashs
 * (« Data\SKSE\Plugins\x.dll »). 7-Zip les extrait alors sous macOS comme UN fichier dont le nom
 * contient les antislashs ; l'installateur cherche « Data/SKSE/Plugins/x.dll », ne trouve rien et
 * le mod s'installe vide (ou presque), avec « l'installateur a tenté d'installer des fichiers qui ne
 * font pas partie de l'archive ». `unzip` (Info-ZIP) les convertit ; ici on fait de même.
 *
 * Interface :
 *  - fixBackslashNames(dir): Promise<number>   remet en dossiers les noms à antislashs sous `dir`,
 *                                              renvoie le nombre de fichiers déplacés
 */
import { mkdir, readdir, rename, rmdir } from "node:fs/promises";
import * as path from "node:path";

const BATCH = 64;

/** « Data\SKSE\x.dll » → ["Data", "SKSE", "x.dll"], sans segment vide ni « .. » */
function segments(name: string): string[] {
  return name.split("\\").filter((part) => part !== "" && part !== "." && part !== "..");
}

export async function fixBackslashNames(dir: string): Promise<number> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const made = new Set<string>();
  let moved = 0;

  const files = entries.filter((entry) => entry.name.includes("\\") && !entry.isDirectory());
  for (let from = 0; from < files.length; from += BATCH) {
    await Promise.all(
      files.slice(from, from + BATCH).map(async (entry) => {
        const parts = segments(entry.name);
        if (parts.length === 0) return;
        const target = path.join(dir, ...parts);
        const parent = path.dirname(target);
        if (!made.has(parent)) {
          await mkdir(parent, { recursive: true });
          made.add(parent);
        }
        await rename(path.join(dir, entry.name), target);
        moved += 1;
      }),
    );
  }

  // les entrées de dossier (« Data\ ») deviennent des dossiers vides inutiles : on les retire
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name.includes("\\")) {
      await rmdir(path.join(dir, entry.name)).catch(() => undefined);
    }
  }

  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.includes("\\")) {
      moved += await fixBackslashNames(path.join(dir, entry.name));
    }
  }
  return moved;
}
