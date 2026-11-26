// Pluriels : accord des marques « (s) », « (aux) », « /i » d'après le nombre qui les précède (Intl.PluralRules).
import assert from 'node:assert/strict';
const { fillText, pluralizeText, isPlural } = await import('../web/src/locales/plural.ts');

// 0 : singulier en français, pluriel ailleurs ; 1 : singulier ; 2 : pluriel
assert.equal(fillText('{n} fichier(s) original(aux)', { n: 0 }, 'fr'), '0 fichier original');
assert.equal(fillText('{n} fichier(s) original(aux)', { n: 1 }, 'fr'), '1 fichier original');
assert.equal(fillText('{n} fichier(s) original(aux)', { n: 2 }, 'fr'), '2 fichiers originaux');
assert.equal(fillText('{n} file(s)', { n: 0 }, 'en'), '0 files');
assert.equal(fillText('{n} file(s)', { n: 1 }, 'en'), '1 file');
assert.equal(fillText('{n} fix(es) undone', { n: 3 }, 'en'), '3 fixes undone');
assert.equal(fillText('{n} corrección(es) deshecha(s)', { n: 1 }, 'es'), '1 corrección deshecha');
assert.equal(fillText('{n} corrección(es) deshecha(s)', { n: 5 }, 'es'), '5 correcciones deshechas');
assert.equal(fillText('{n} correzione/i annullata/e', { n: 1 }, 'it'), '1 correzione annullata');
assert.equal(fillText('{n} correzione/i annullata/e', { n: 4 }, 'it'), '4 correzioni annullate');
assert.equal(fillText('{n} archivio/i', { n: 1 }, 'it'), '1 archivio');
// grands nombres : séparateur de milliers de la langue, accord sur la valeur
assert.equal(fillText('{n} archive(s)', { n: 2431 }, 'en'), '2,431 archives');
assert.equal(fillText('{n} archive(s)', { n: 1000 }, 'fr').replace(/\s/g, ' '), '1 000 archives');
// plusieurs nombres : chaque marque suit le nombre qui la précède
assert.equal(fillText('{a} nouvelle(s) ({size}), {r} plus utilisée(s)', { a: 1, size: '1,2 Go', r: 7 }, 'fr'), '1 nouvelle (1,2 Go), 7 plus utilisées');
// valeur absente : jamais « undefined »
assert.equal(fillText('Erreur : {msg}', {}, 'fr'), 'Erreur : ');
// texte déjà composé (journal du serveur)
assert.equal(pluralizeText('⚠ 1 fichier(s) absent(s) et 3 mod(s) désactivé(s)', 'fr'), '⚠ 1 fichier absent et 3 mods désactivés');
assert.equal(pluralizeText('BSA x > 2 Go : 1 fichier(s) placé(s)', 'fr'), 'BSA x > 2 Go : 1 fichier placé');
assert.equal(pluralizeText('1 284 archive(s)', 'fr'), '1 284 archives');
assert.equal(pluralizeText('Dossier Data/i et 2 fichier(s)', 'fr'), 'Dossier Data/i et 2 fichiers'); // « /i » n'est une marque qu'en italien
assert.equal(isPlural(0, 'fr'), false);
assert.equal(isPlural(0, 'en'), true);
console.log('test-plural : OK');
