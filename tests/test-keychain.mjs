// Trousseau macOS : enregistrement, lecture, remplacement, suppression (service de test dédié).
import assert from 'node:assert/strict';

process.env.MABBAJACK_KEYCHAIN_SERVICE = `mABBAJACK test ${process.pid}`;
const { readKey, saveKey, deleteKey, isValidKeyFormat } = await import('../web/server/keychain.js');

try {
  assert.equal(isValidKeyFormat('abcDEF123+/=--xyz'), true);
  assert.equal(isValidKeyFormat('short'), false);
  assert.equal(isValidKeyFormat('key with space'), false);
  assert.equal(isValidKeyFormat('key"; rm -rf /'), false);
  await assert.rejects(saveKey('bad key"'));

  assert.equal(await readKey(), '');
  await saveKey('FirstKey1234--abc');
  assert.equal(await readKey(), 'FirstKey1234--abc');
  await saveKey('SecondKey+/=5678');
  assert.equal(await readKey(), 'SecondKey+/=5678');
  await deleteKey();
  assert.equal(await readKey(), '');
  await deleteKey(); // déjà supprimée : pas d'erreur
} finally {
  await deleteKey();
}
console.log('OK keychain');
