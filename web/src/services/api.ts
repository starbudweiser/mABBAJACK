/**
 * Unified API Client for mABBAJACK
 * Direct bridge between React frontend and macOS backend (Node.js + AppleScript / pbpaste)
 */

export function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    // Dev (Vite 5173) ou file:// → backend sur le port 3000.
    // Servi par le serveur Node (quel que soit son port, ex. application autonome) → même origine.
    if (window.location.protocol === 'file:') {
      return 'http://localhost:3000';
    }
    if (window.location.port === '5173') {
      return 'http://localhost:3000';
    }
  }
  return '';
}

export async function pickNativeFolder(
  title: string,
  defaultPath?: string
): Promise<{ cancelled: boolean; path: string | null; error?: string }> {
  try {
    const controller = new AbortController();
    // Allow up to 2 minutes for user to browse and pick folder in Finder
    const timeout = setTimeout(() => controller.abort(), 120000);

    const res = await fetch(`${getApiBaseUrl()}/api/system/pick-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, defaultPath }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      return {
        cancelled: !!data.cancelled,
        path: data.path || null,
        error: data.error,
      };
    }
    return { cancelled: false, path: null, error: `HTTP ${res.status}` };
  } catch (err: any) {
    return { cancelled: false, path: null, error: err?.message || 'Network error' };
  }
}

export async function pickNativeFile(
  title: string
): Promise<{ cancelled: boolean; path: string | null; error?: string }> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);

    const res = await fetch(`${getApiBaseUrl()}/api/system/pick-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      return {
        cancelled: !!data.cancelled,
        path: data.path || null,
        error: data.error,
      };
    }
    return { cancelled: false, path: null, error: `HTTP ${res.status}` };
  } catch (err: any) {
    return { cancelled: false, path: null, error: err?.message || 'Network error' };
  }
}

export async function getNativeClipboard(): Promise<string> {
  // 1. Try browser clipboard first
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.readText) {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        return text.trim();
      }
    }
  } catch {
    // Blocked by browser security / permissions
  }

  // 2. Fetch directly from macOS pbpaste via backend
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const res = await fetch(`${getApiBaseUrl()}/api/system/clipboard`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const data = await res.json();
      if (data.text && typeof data.text === 'string' && data.text.trim()) {
        return data.text.trim();
      }
    }
  } catch {
    // Backend offline or timeout
  }

  return '';
}

export async function openFolderInFinder(targetPath: string): Promise<boolean> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/system/open-folder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: targetPath }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchModlistOptions(filePath: string): Promise<import('../types/wabbajack').ModlistOptions> {
  const res = await fetch(`${getApiBaseUrl()}/api/wabbajack/options`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

/** Chemin réel d'un .wabbajack déposé, retrouvé par le serveur (nom + taille) ; null si introuvable. */
export async function locateWabbajack(name: string, size: number): Promise<string | null> {
  try {
    const res = await fetch(`${getApiBaseUrl()}/api/wabbajack/locate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, size }),
    });
    if (!res.ok) return null;
    return (await res.json()).path || null;
  } catch {
    return null;
  }
}

/**
 * Envoie un .wabbajack au serveur avec suivi de progression (fetch ne sait pas suivre l'envoi).
 * onUploadProgress(sent, total) : octets envoyés ; onUploadDone() : envoi terminé, analyse en cours.
 */
export function uploadWabbajack<T>(
  file: File,
  onUploadProgress: (sent: number, total: number) => void,
  onUploadDone: () => void,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${getApiBaseUrl()}/api/wabbajack/inspect-upload`);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onUploadProgress(e.loaded, e.total); };
    xhr.upload.onload = () => onUploadDone();
    xhr.onerror = () => reject(new Error('Connexion au serveur interrompue'));
    xhr.onabort = () => reject(new Error('Envoi annulé'));
    xhr.onload = () => {
      const body = xhr.response as (T & { error?: string }) | null;
      if (xhr.status >= 200 && xhr.status < 300 && body) resolve(body);
      else reject(new Error(body?.error || `HTTP ${xhr.status}`));
    };
    const form = new FormData();
    form.append('wabbajack', file, file.name);
    xhr.send(form);
  });
}

export interface ScanProgress {
  phase: 'list' | 'match';
  done: number;
  total: number;
}

export interface ScanResult {
  archives: import('../types/wabbajack').ModlistArchive[];
  readyCount: number;
  missingCount: number;
  totalScanned: number;
  /** archives dont un fichier de même nom existe mais avec une taille différente (incomplet / autre version) */
  sizeMismatches?: number;
  gameFiles?: { total: number; found: number; dirs: string[] };
}

/**
 * Scanne le dossier de téléchargement avec progression (réponse NDJSON : une ligne JSON par événement).
 * Lève une erreur si le serveur répond en erreur ou si le flux se termine sans résultat.
 */
export async function scanDownloads(
  body: { downloadsPath: string; gamePath?: string; archives: unknown[] },
  onProgress: (p: ScanProgress) => void,
  signal?: AbortSignal,
): Promise<ScanResult> {
  const res = await fetch(`${getApiBaseUrl()}/api/wabbajack/verify-downloads?stream=1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({} as { error?: string }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: ScanResult | null = null;

  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let evt: { type: string; error?: string } & Partial<ScanProgress> & Partial<ScanResult>;
    try { evt = JSON.parse(line); } catch { return; }
    if (evt.type === 'progress') onProgress({ phase: evt.phase as ScanProgress['phase'], done: evt.done ?? 0, total: evt.total ?? 0 });
    else if (evt.type === 'error') throw new Error(evt.error || 'Scan impossible');
    else if (evt.type === 'result') result = evt as ScanResult;
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      handleLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  handleLine(buffer);
  if (!result) throw new Error('Scan interrompu');
  return result;
}
