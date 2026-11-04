/**
 * Moteur Mac commun : version de Bottled Shaders. La 1.0.26 (03/11/2026) est la première à apporter le
 * ciel nocturne, les aurores, les éclairs procéduraux et les corrections des masques de lune : une
 * version locale plus ancienne est « à mettre à jour ».
 *
 * Interface :
 *  - BOTTLED_MIN_VERSION                              « 1.0.26 »
 *  - compareVersions(a, b): number                    <0, 0, >0 ; comparaison numérique par segment
 *  - bottledStatus(report, known?): IBottledStatus    état de Bottled Shaders dans le dossier du jeu
 *
 * Version locale : celle que l'appelant connaît (métadonnées du mod, nom du fichier Nexus) sinon celle
 * inscrite dans CommunityShaders.dll. Sans l'une ni l'autre : « unknown », jamais une estimation.
 */
import type { IShadersReport } from "./dxmtChecks";
import { type IMacText, macText } from "./macTexts";

export const BOTTLED_MIN_VERSION = "1.0.26";

/** « v1.0.26-beta » → [1, 0, 26] ; undefined si aucun nombre */
function segments(version: string): number[] | undefined {
  const match = /\d+(?:\.\d+)*/.exec(version);
  return match === null ? undefined : match[0].split(".").map(Number);
}

/** <0 si a est plus ancienne que b ; une version illisible est plus ancienne que toute autre */
export function compareVersions(a: string, b: string): number {
  const left = segments(a);
  const right = segments(b);
  if (left === undefined || right === undefined) {
    return left === right ? 0 : left === undefined ? -1 : 1;
  }
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export type BottledState =
  /** pas de Community Shaders du tout */
  | "absent"
  /** la version d'origine de Community Shaders, pas Bottled Shaders */
  | "stock"
  /** Bottled Shaders, à jour */
  | "ok"
  /** Bottled Shaders, plus ancien que BOTTLED_MIN_VERSION : à mettre à jour */
  | "outdated"
  /** Bottled Shaders, version illisible */
  | "unknown";

export interface IBottledStatus {
  state: BottledState;
  minimum: string;
  version?: string;
  /** d'où vient la version : l'appelant, ou la DLL */
  source?: "caller" | "dll";
  text: IMacText;
}

export function bottledStatus(report: IShadersReport | undefined, known?: string): IBottledStatus {
  const minimum = BOTTLED_MIN_VERSION;
  if (report === undefined)
    return { state: "absent", minimum, text: macText("mackit.bottled.absent") };
  if (!report.bottled) return { state: "stock", minimum, text: macText("mackit.bottled.stock") };

  const version = known ?? report.version;
  const source = known !== undefined ? "caller" : "dll";
  if (version === undefined || segments(version) === undefined) {
    return { state: "unknown", minimum, text: macText("mackit.bottled.unknown", { minimum }) };
  }
  if (compareVersions(version, minimum) < 0) {
    return {
      state: "outdated",
      minimum,
      version,
      source,
      text: macText("mackit.bottled.outdated", { version, minimum }),
    };
  }
  return { state: "ok", minimum, version, source, text: macText("mackit.bottled.ok", { version }) };
}
