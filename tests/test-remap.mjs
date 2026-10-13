// Test : remplacement des magic strings (RemappedInlineFile)
import assert from 'node:assert/strict';
import { remapMagicStrings, toWinPath } from '../web/server/remap.js';

assert.equal(toWinPath('/Volumes/SKYRIM/Authoria'), 'Z:\\Volumes\\SKYRIM\\Authoria');
assert.equal(toWinPath('/a/b/'), 'Z:\\a\\b');
assert.equal(toWinPath('C:/x/y'), 'C:\\x\\y');

const roots = { mo2: '/Volumes/SKYRIM/Authoria', game: '/Games/Skyrim', download: '/DL' };

let r = remapMagicStrings('{"Source": "{--||MO2_PATH_MAGIC_DOUBLE_BACK||--}", "D": "{--||MO2_PATH_MAGIC_DOUBLE_BACK||--}\\\\downloads"}', roots);
assert.equal(r.data.toString(), '{"Source": "Z:\\\\Volumes\\\\SKYRIM\\\\Authoria", "D": "Z:\\\\Volumes\\\\SKYRIM\\\\Authoria\\\\downloads"}');
assert.equal(r.replaced, 2);
assert.doesNotThrow(() => JSON.parse(r.data.toString()));

r = remapMagicStrings('a={--||MO2_PATH_MAGIC_BACK||--}\\mods', roots);
assert.equal(r.data.toString(), 'a=Z:\\Volumes\\SKYRIM\\Authoria\\mods');

r = remapMagicStrings('a={--||GAME_PATH_MAGIC_FORWARD||--}/Data', roots);
assert.equal(r.data.toString(), 'a=Z:/Games/Skyrim/Data');

r = remapMagicStrings('x={--||DOWNLOAD_PATH_MAGIC_BACK||--}', { mo2: '/m' });
assert.equal(r.unresolved, 1);
assert.equal(r.data.toString(), 'x={--||DOWNLOAD_PATH_MAGIC_BACK||--}');

const bin = Buffer.from([0, 1, 2, 3, 255]);
assert.deepEqual(remapMagicStrings(bin, roots).data, bin);

console.log('remap OK');
