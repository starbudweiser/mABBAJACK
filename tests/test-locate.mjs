import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTempPath, locateWabbajack } from '../web/server/locate.js';
import { listDownloadDir } from '../web/server/archivecheck.js';

// Copies temporaires : jamais un dossier de travail
const up = path.join(os.tmpdir(), 'mabbajack-uploads', 'X.wabbajack');
assert.equal(isTempPath(up), true);
assert.equal(isTempPath('/var/folders/rx/abc/T/mabbajack-uploads/X.wabbajack'), true);
assert.equal(isTempPath('/Volumes/LaCie 6To/LISTS/X.wabbajack'), false);
assert.equal(listDownloadDir(up), null);

// Recherche par nom + taille (hors dossiers temporaires)
const here = path.dirname(fileURLToPath(import.meta.url));
const fx = path.join(here, '.locate-fixture');
try {
  fs.mkdirSync(path.join(fx, 'LISTS', 'MINI'), { recursive: true });
  fs.mkdirSync(path.join(fx, 'AUTRE'), { recursive: true });
  fs.writeFileSync(path.join(fx, 'AUTRE', 'Mini Liste.wabbajack'), 'xx');      // même nom, autre taille
  fs.writeFileSync(path.join(fx, 'LISTS', 'MINI', 'Mini Liste.wabbajack'), 'xyz');
  assert.equal(await locateWabbajack('Mini Liste.wabbajack', 3, { roots: [fx] }), path.join(fx, 'LISTS', 'MINI', 'Mini Liste.wabbajack'));
  assert.equal(await locateWabbajack('Mini Liste.wabbajack', 99, { roots: [fx] }), null);
  assert.equal(await locateWabbajack('pas-un-wabbajack.zip', 3, { roots: [fx] }), null);
} finally {
  fs.rmSync(fx, { recursive: true, force: true });
}
console.log('locate OK');
