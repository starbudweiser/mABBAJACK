/**
 * mORTEX : lecture du journal du script extender (skse64.log et ses cousins) écrit au lancement du
 * jeu. Repère les plugins que le script extender a refusés et pourquoi.
 *
 * Interface :
 *  - parseScriptExtenderLog(text): IScriptExtenderReport
 *  - SCRIPT_EXTENDER_LOGS[gameId]   dossier de My Games, nom du script extender et du journal
 */

export type RefusalKind =
  | "address-library"
  | "runtime"
  | "extender-version"
  | "missing-dependency"
  | "not-a-plugin"
  | "other";

export interface IRefusedPlugin {
  plugin: string;
  kind: RefusalKind;
  /** raison telle que le script extender l'écrit */
  reason: string;
}

export interface IScriptExtenderReport {
  loaded: string[];
  refused: IRefusedPlugin[];
}

/** journal du script extender, dans Documents/My Games/<folder>/<name>/<log> */
export const SCRIPT_EXTENDER_LOGS: Record<string, { folder: string; name: string; log: string }> = {
  skyrimse: { folder: "Skyrim Special Edition", name: "SKSE", log: "skse64.log" },
  skyrimvr: { folder: "Skyrim VR", name: "SKSE", log: "sksevr.log" },
  fallout4: { folder: "Fallout4", name: "F4SE", log: "f4se.log" },
};

function kindOf(reason: string): RefusalKind {
  const text = reason.toLowerCase();
  if (text.includes("address library")) return "address-library";
  if (text.includes("runtime")) return "runtime";
  if (/(skse|f4se|script extender).*(too old|version)/.test(text)) return "extender-version";
  if (/error 126\b/.test(text)) return "missing-dependency";
  if (/error 193\b|does not appear to be/.test(text)) return "not-a-plugin";
  return "other";
}

export function parseScriptExtenderLog(text: string): IScriptExtenderReport {
  const loaded: string[] = [];
  const refused: IRefusedPlugin[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    let match = /^plugin (.+?\.dll) \(.*\) loaded correctly/i.exec(line);
    if (match) {
      loaded.push(match[1]);
      continue;
    }
    // « plugin X.dll (00000001 Nom 0000000A) disabled, address library needs to be updated 0 (handle 0) »
    match =
      /^plugin (.+?\.dll) \(.*\) (?:disabled|reported as incompatible[^,]*),?\s*(.*?)(?:\s+\d+\s+\(handle \d+\))?$/i.exec(
        line,
      );
    if (match) {
      const reason = match[2] || "disabled";
      refused.push({ plugin: match[1], kind: kindOf(reason), reason });
      continue;
    }
    // « couldn't load plugin C:\...\X.dll (Error 126) »
    match = /^couldn't load plugin (.+?\.dll)\s*(\(.*\))?/i.exec(line);
    if (match) {
      const plugin = match[1].split(/[\\/]/).pop() ?? match[1];
      const reason = match[2]?.replace(/^\(|\)$/g, "") ?? "couldn't load";
      refused.push({ plugin, kind: kindOf(reason), reason });
      continue;
    }
    match = /^plugin (.+?\.dll) does not appear to be an? \w+ plugin/i.exec(line);
    if (match) {
      refused.push({ plugin: match[1], kind: "not-a-plugin", reason: line });
    }
  }
  return { loaded, refused };
}
