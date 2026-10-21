// Version unique de l'appli : lue dans package.json (présent à côté de server/ dans les sources comme dans l'appli compilée).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
export const APP_VERSION = pkg.version;
/** En-têtes d'identification demandés par l'API Nexus Mods. */
export const NEXUS_APP_HEADERS = { 'Application-Name': 'mABBAJACK', 'Application-Version': APP_VERSION };
