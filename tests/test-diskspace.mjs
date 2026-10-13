import assert from 'node:assert/strict';
import os from 'node:os';
import { checkDiskSpace, fmtBytes, volumeInfo } from '../web/server/diskspace.js';

const dir = os.tmpdir();
const v = volumeInfo(dir);
assert.ok(v && v.free > 0, 'volumeInfo tmp');
assert.equal(volumeInfo('/nonexistent/a/b/c')?.free > 0, true, 'ancêtre existant');

assert.equal(checkDiskSpace({ downloadDir: dir, destDir: dir, downloadBytes: 1, installBytes: 1 }).level, 'ok');
assert.equal(checkDiskSpace({ downloadDir: dir, destDir: dir, downloadBytes: v.free * 2, installBytes: 0 }).level, 'error');
assert.equal(checkDiskSpace({ downloadDir: dir, destDir: dir, downloadBytes: Math.floor(v.free * 1.05), installBytes: 0 }).level, 'warn');
assert.equal(fmtBytes(2 * 1024 ** 3), '2.0 GB');
assert.equal(fmtBytes(5 * 1024 ** 2), '5 MB');
console.log('diskspace OK');
