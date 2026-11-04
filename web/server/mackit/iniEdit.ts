/**
 * mORTEX (macOS) : lecture et écriture ligne à ligne des INI de Skyrim SE (Éditeur de réglages).
 *
 * Interface :
 *  - loadIniFile / loadSkyrimIniFiles : lit les INI (octets conservés, fichier absent = vide)
 *  - readEffective(files)               valeur effective de chaque [section] clé et son fichier d'origine
 *  - planChanges(files, changes)        ce qui sera écrit, sans rien écrire
 *  - applyChanges(plan)                 écrit le plan, uniquement les lignes concernées
 *
 * Règles :
 *  - priorité du jeu : SkyrimCustom.ini > SkyrimPrefs.ini > Skyrim.ini
 *  - sections et clés se comparent sans tenir compte de la casse (comme GetPrivateProfileString) ;
 *    en cas de clé en double, la première l'emporte (c'est aussi la seule modifiée)
 *  - une valeur existante est modifiée dans le fichier qui la porte déjà ; une valeur nouvelle va dans
 *    SkyrimPrefs.ini pour les sections graphiques, sinon dans Skyrim.ini, jamais dans SkyrimCustom.ini
 *  - jamais de réécriture complète : commentaires (; et #), ordre, casse, BOM, fins de ligne (CRLF) et
 *    commentaires en fin de ligne restent tels quels ; une section absente est créée à la fin
 *  - le plan garde le texte d'origine : applyChanges refuse d'écrire si un fichier a changé depuis
 */
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";

export type IniRole = "custom" | "prefs" | "ini";

/** du plus prioritaire au moins prioritaire */
export const INI_PRIORITY: readonly IniRole[] = ["custom", "prefs", "ini"];

export const INI_FILE_NAMES: Record<IniRole, string> = {
  custom: "SkyrimCustom.ini",
  prefs: "SkyrimPrefs.ini",
  ini: "Skyrim.ini",
};

/** sections (en minuscules) dont une nouvelle valeur va dans SkyrimPrefs.ini */
export const GRAPHICS_SECTIONS: ReadonlySet<string> = new Set([
  "display",
  "decals",
  "imagespace",
  "lod",
  "grass",
  "terrainmanager",
  "water",
  "particles",
  "trees",
  "shadows",
]);

export interface IIniFile {
  role: IniRole;
  path: string;
  /** contenu décodé, BOM compris s'il y en a un */
  text: string;
  /** false si le fichier n'existe pas encore (texte vide, créé à l'écriture) */
  exists?: boolean;
  /** fichier qui n'est pas de l'UTF-8 valide : relu et réécrit octet pour octet en latin1 */
  latin1?: boolean;
}

export interface IChange {
  section: string;
  key: string;
  value: string;
}

export interface IShadowedValue {
  role: IniRole;
  path: string;
  value: string;
}

export interface IEffectiveSetting {
  section: string;
  key: string;
  value: string;
  role: IniRole;
  path: string;
  /** mêmes réglages dans des fichiers moins prioritaires, donc sans effet */
  shadowed: IShadowedValue[];
}

export interface IPlannedChange {
  path: string;
  role: IniRole;
  section: string;
  key: string;
  oldValue?: string;
  newValue: string;
  action: "modify" | "add";
  /** la section n'existait pas et sera créée à la fin du fichier */
  createsSection: boolean;
  /** numéro de ligne (à partir de 1) au moment de l'écriture, après les changements précédents */
  line: number;
  oldLine?: string;
  newLine: string;
}

type IEdit =
  | { type: "replace"; index: number; text: string }
  | { type: "insert"; index: number; lines: string[] };

export interface IIniFilePlan {
  path: string;
  role: IniRole;
  latin1?: boolean;
  /** texte d'origine, undefined si le fichier n'existait pas */
  base: string | undefined;
  edits: IEdit[];
}

export interface IIniPlan {
  changes: IPlannedChange[];
  files: IIniFilePlan[];
}

export interface IPlanOptions {
  /** où ajouter une clé nouvelle dans une section existante : à la fin (défaut) ou juste sous l'en-tête */
  insertAt?: "end" | "start";
}

/** identifiant d'un réglage, sans tenir compte de la casse */
export const settingId = (section: string, key: string) =>
  `${section.trim().toLowerCase()}\u0000${key.trim().toLowerCase()}`;

// --- lecture des fichiers ---------------------------------------------------------------------

export async function loadIniFile(role: IniRole, file: string): Promise<IIniFile> {
  const buffer = await readFile(file).catch(() => undefined);
  if (buffer === undefined) return { role, path: file, text: "", exists: false };
  try {
    // ignoreBOM : le BOM reste dans le texte, pour être réécrit tel quel
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(buffer);
    return { role, path: file, text, exists: true };
  } catch {
    return { role, path: file, text: buffer.toString("latin1"), exists: true, latin1: true };
  }
}

export const loadIniFiles = (paths: Partial<Record<IniRole, string>>): Promise<IIniFile[]> =>
  Promise.all(
    INI_PRIORITY.filter((role) => paths[role] !== undefined).map((role) =>
      loadIniFile(role, paths[role] as string),
    ),
  );

/** les trois INI de Skyrim SE dans le dossier « My Games/Skyrim Special Edition » */
export const loadSkyrimIniFiles = (dir: string): Promise<IIniFile[]> =>
  loadIniFiles(
    Object.fromEntries(INI_PRIORITY.map((role) => [role, path.join(dir, INI_FILE_NAMES[role])])),
  );

// --- analyse d'un fichier ---------------------------------------------------------------------

interface ILine {
  text: string;
  /** fin de ligne d'origine ("" pour une dernière ligne sans retour) */
  eol: string;
}

interface IParsed {
  bom: boolean;
  lines: ILine[];
  /** fin de ligne des lignes ajoutées : celle du fichier (CRLF si le fichier n'en a aucune) */
  eol: string;
}

interface IKeyLine {
  index: number;
  key: string;
  indent: string;
  sep: string;
  value: string;
  /** espaces et commentaire en fin de ligne, conservés tels quels */
  tail: string;
}

interface ISection {
  name: string;
  /** -1 pour les lignes d'avant le premier en-tête */
  headerIndex: number;
  keys: IKeyLine[];
}

const SECTION_RE = /^\s*\[([^\]]*)\]/;
const KEY_RE = /^(\s*)([^=;#[\s][^=]*?)(\s*=\s*)(.*)$/;

function parse(text: string): IParsed {
  const bom = text.startsWith("﻿");
  const body = bom ? text.slice(1) : text;
  const lines: ILine[] = [];
  let crlf = 0;
  let lf = 0;
  for (const m of body.matchAll(/([^\r\n]*)(\r\n|\n|\r)|([^\r\n]+)$/g)) {
    const eol = m[2] ?? "";
    if (eol === "\r\n") crlf++;
    else if (eol === "\n") lf++;
    lines.push({ text: m[1] ?? m[3], eol });
  }
  return { bom, lines, eol: lf > crlf ? "\n" : "\r\n" };
}

const serialize = (parsed: IParsed) =>
  (parsed.bom ? "﻿" : "") + parsed.lines.map((line) => line.text + line.eol).join("");

function parseKey(text: string, index: number): IKeyLine | undefined {
  const m = KEY_RE.exec(text);
  if (m === null) return undefined;
  const rest = m[4];
  const comment = rest.search(/(^|\s)[;#]/);
  const raw = comment < 0 ? rest : rest.slice(0, comment);
  return {
    index,
    key: m[2],
    indent: m[1],
    sep: m[3],
    value: raw.trim(),
    tail: rest.slice(raw.trimEnd().length),
  };
}

function scan(lines: ILine[]): ISection[] {
  const sections: ISection[] = [{ name: "", headerIndex: -1, keys: [] }];
  lines.forEach((line, index) => {
    const header = SECTION_RE.exec(line.text);
    if (header !== null) {
      sections.push({ name: header[1].trim(), headerIndex: index, keys: [] });
      return;
    }
    const key = parseKey(line.text, index);
    if (key !== undefined) sections[sections.length - 1].keys.push(key);
  });
  return sections;
}

/** premier [section] clé du fichier, comme le fait le jeu */
function locate(sections: ISection[], section: string, key: string) {
  const wanted = settingId(section, key);
  for (const sec of sections) {
    if (sec.headerIndex < 0) continue;
    const found = sec.keys.find((k) => settingId(sec.name, k.key) === wanted);
    if (found !== undefined) return { section: sec, key: found };
  }
  return undefined;
}

const byPriority = (files: IIniFile[]) =>
  [...files].sort((a, b) => INI_PRIORITY.indexOf(a.role) - INI_PRIORITY.indexOf(b.role));

// --- valeur effective -------------------------------------------------------------------------

export function readEffective(files: IIniFile[]): Map<string, IEffectiveSetting> {
  const result = new Map<string, IEffectiveSetting>();
  for (const file of byPriority(files)) {
    const seen = new Set<string>();
    for (const sec of scan(parse(file.text).lines)) {
      if (sec.headerIndex < 0) continue;
      for (const k of sec.keys) {
        const id = settingId(sec.name, k.key);
        if (seen.has(id)) continue; // clé en double : la première l'emporte
        seen.add(id);
        const current = result.get(id);
        if (current === undefined) {
          result.set(id, {
            section: sec.name,
            key: k.key,
            value: k.value,
            role: file.role,
            path: file.path,
            shadowed: [],
          });
        } else {
          current.shadowed.push({ role: file.role, path: file.path, value: k.value });
        }
      }
    }
  }
  return result;
}

// --- plan et écriture -------------------------------------------------------------------------

function applyEdits(parsed: IParsed, edits: IEdit[]): void {
  for (const edit of edits) {
    if (edit.type === "replace") {
      parsed.lines[edit.index].text = edit.text;
      continue;
    }
    const previous = parsed.lines[edit.index - 1];
    // ajout après une dernière ligne sans retour : elle en reçoit un, la nouvelle dernière n'en a pas
    const unterminated = edit.index === parsed.lines.length && previous?.eol === "";
    if (unterminated) previous.eol = parsed.eol;
    const added = edit.lines.map((text, i) => ({
      text,
      eol: unterminated && i === edit.lines.length - 1 ? "" : parsed.eol,
    }));
    parsed.lines.splice(edit.index, 0, ...added);
  }
}

/** « clé=valeur » ou « clé = valeur », selon la section puis le fichier */
function separatorStyle(sections: ISection[], section: ISection | undefined): string {
  const sample = section?.keys[0] ?? sections.find((s) => s.keys.length > 0)?.keys[0];
  return sample !== undefined && /\s=\s/.test(sample.sep) ? " = " : "=";
}

interface IWork {
  file: IIniFile;
  parsed: IParsed;
  edits: IEdit[];
}

export function planChanges(
  files: IIniFile[],
  changes: IChange[],
  options: IPlanOptions = {},
): IIniPlan {
  const effective = readEffective(files);
  const work = new Map<IniRole, IWork>();
  const planned: IPlannedChange[] = [];

  // deux changements pour le même réglage : le dernier compte
  const wanted = new Map<string, IChange>();
  for (const change of changes) wanted.set(settingId(change.section, change.key), change);

  for (const [id, change] of wanted) {
    const current = effective.get(id);
    if (current?.value === change.value) continue;

    const role: IniRole =
      current?.role ??
      (GRAPHICS_SECTIONS.has(change.section.trim().toLowerCase()) ? "prefs" : "ini");
    let w = work.get(role);
    if (w === undefined) {
      const file = files.find((f) => f.role === role);
      if (file === undefined) throw new Error(`Fichier ${INI_FILE_NAMES[role]} manquant`);
      w = { file, parsed: parse(file.text), edits: [] };
      work.set(role, w);
    }

    const sections = scan(w.parsed.lines);
    const found = locate(sections, change.section, change.key);
    const base = {
      path: w.file.path,
      role,
      section: change.section.trim(),
      key: change.key.trim(),
    };

    if (found !== undefined) {
      const { key } = found;
      const gap = key.tail !== "" && /^[;#]/.test(key.tail) ? " " : "";
      const newLine = `${key.indent}${key.key}${key.sep}${change.value}${gap}${key.tail}`;
      const oldLine = w.parsed.lines[key.index].text;
      const edit: IEdit = { type: "replace", index: key.index, text: newLine };
      applyEdits(w.parsed, [edit]);
      w.edits.push(edit);
      planned.push({
        ...base,
        key: key.key,
        oldValue: key.value,
        newValue: change.value,
        action: "modify",
        createsSection: false,
        line: key.index + 1,
        oldLine,
        newLine,
      });
      continue;
    }

    // clé nouvelle
    const section = sections.find(
      (s) => s.headerIndex >= 0 && s.name.toLowerCase() === base.section.toLowerCase(),
    );
    const newLine = `${base.key}${separatorStyle(sections, section)}${change.value}`;
    let edit: IEdit;
    let line: number;
    if (section !== undefined) {
      const last = section.keys[section.keys.length - 1];
      const index =
        options.insertAt === "start" || last === undefined
          ? section.headerIndex + 1
          : last.index + 1;
      edit = { type: "insert", index, lines: [newLine] };
      line = index + 1;
    } else {
      const index = w.parsed.lines.length;
      const needsGap = index > 0 && w.parsed.lines[index - 1].text.trim() !== "";
      edit = {
        type: "insert",
        index,
        lines: [...(needsGap ? [""] : []), `[${base.section}]`, newLine],
      };
      line = index + edit.lines.length;
    }
    applyEdits(w.parsed, [edit]);
    w.edits.push(edit);
    planned.push({
      ...base,
      newValue: change.value,
      action: "add",
      createsSection: section === undefined,
      line,
      newLine,
    });
  }

  return {
    changes: planned,
    files: [...work.values()].map(({ file, edits }) => ({
      path: file.path,
      role: file.role,
      latin1: file.latin1,
      base: file.exists === false ? undefined : file.text,
      edits,
    })),
  };
}

/**
 * Écrit le plan : relit chaque fichier, vérifie qu'il n'a pas changé depuis le plan, puis ne touche
 * qu'aux lignes prévues. Aucune écriture si un seul fichier a changé. Retourne les fichiers écrits.
 * L'écriture traverse les liens (dossier de préparation) : on ne remplace pas le fichier.
 */
export async function applyChanges(plan: IIniPlan): Promise<string[]> {
  const ready: Array<{ plan: IIniFilePlan; parsed: IParsed }> = [];
  for (const filePlan of plan.files) {
    const current = await loadIniFile(filePlan.role, filePlan.path);
    const now = current.exists === false ? undefined : current.text;
    if (now !== filePlan.base) {
      throw new Error(`${path.basename(filePlan.path)} a changé depuis l'aperçu : recommencez`);
    }
    const parsed = parse(current.text);
    applyEdits(parsed, filePlan.edits);
    ready.push({ plan: filePlan, parsed });
  }
  for (const { plan: filePlan, parsed } of ready) {
    await writeFile(
      filePlan.path,
      Buffer.from(serialize(parsed), filePlan.latin1 ? "latin1" : "utf8"),
    );
  }
  return ready.map(({ plan: filePlan }) => filePlan.path);
}
