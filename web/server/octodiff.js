// ──────────────────────────────────────────────────────────
// OctoDiff — application des patchs delta Wabbajack (PatchedFromArchive)
// Format (Octodiff, little-endian) :
//   "OCTODELTA" · version (0x01) · nom d'algo (string .NET, longueur 7-bit)
//   · longueur du hash (int32) · hash du fichier de base · ">>>"
//   puis commandes : 0x60 Copy(int64 offset, int64 length)
//                    0x80 Data(int64 length, bytes)
// ──────────────────────────────────────────────────────────
import crypto from 'crypto';

const MAGIC = Buffer.from('OCTODELTA', 'ascii');
const END_META = Buffer.from('>>>', 'ascii');
const CMD_COPY = 0x60;
const CMD_DATA = 0x80;

function readInt64(buf, pos) {
  const v = buf.readBigInt64LE(pos);
  if (v < 0n || v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('OctoDiff : entier hors limites');
  return Number(v);
}

/** Lit l'en-tête du delta. @returns {{ algo:string, hash:Buffer, bodyStart:number }} */
export function readOctoDiffHeader(delta) {
  if (!Buffer.isBuffer(delta) || delta.length < MAGIC.length + 8) throw new Error('OctoDiff : delta vide ou tronqué');
  if (!delta.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('OctoDiff : signature OCTODELTA absente');
  let pos = MAGIC.length;
  const version = delta[pos++];
  if (version !== 0x01) throw new Error(`OctoDiff : version ${version} non supportée`);
  // Chaîne .NET BinaryWriter : longueur encodée sur 7 bits
  let len = 0, shift = 0, b;
  do {
    if (pos >= delta.length) throw new Error('OctoDiff : en-tête tronqué');
    b = delta[pos++];
    len |= (b & 0x7f) << shift;
    shift += 7;
  } while (b & 0x80);
  const algo = delta.toString('utf8', pos, pos + len);
  pos += len;
  const hashLen = delta.readInt32LE(pos); pos += 4;
  if (hashLen < 0 || pos + hashLen + END_META.length > delta.length) throw new Error('OctoDiff : hash invalide');
  const hash = delta.subarray(pos, pos + hashLen); pos += hashLen;
  if (!delta.subarray(pos, pos + END_META.length).equals(END_META)) throw new Error('OctoDiff : fin de métadonnées absente');
  pos += END_META.length;
  return { algo, hash, bodyStart: pos };
}

/**
 * Le hash de l'en-tête est celui du fichier RÉSULTAT attendu.
 * @returns {boolean|null} true = buf est déjà le résultat, false = différent, null = algo non vérifiable
 */
export function octoDiffResultMatches(buf, delta) {
  const { algo, hash } = readOctoDiffHeader(delta);
  if (!/^sha1$/i.test(algo)) return null;
  return crypto.createHash('sha1').update(buf).digest().equals(hash);
}

/**
 * Applique un delta OctoDiff à un fichier de base.
 * @param {Buffer} basis
 * @param {Buffer} delta
 * @returns {Buffer}
 */
export function applyOctoDiff(basis, delta) {
  const { bodyStart } = readOctoDiffHeader(delta);
  const chunks = [];
  let total = 0;
  let pos = bodyStart;
  while (pos < delta.length) {
    const cmd = delta[pos++];
    if (cmd === CMD_COPY) {
      if (pos + 16 > delta.length) throw new Error('OctoDiff : commande Copy tronquée');
      const start = readInt64(delta, pos); pos += 8;
      const length = readInt64(delta, pos); pos += 8;
      if (start + length > basis.length) throw new Error('OctoDiff : Copy hors du fichier de base');
      chunks.push(basis.subarray(start, start + length));
      total += length;
    } else if (cmd === CMD_DATA) {
      if (pos + 8 > delta.length) throw new Error('OctoDiff : commande Data tronquée');
      const length = readInt64(delta, pos); pos += 8;
      if (pos + length > delta.length) throw new Error('OctoDiff : données tronquées');
      chunks.push(delta.subarray(pos, pos + length));
      pos += length;
      total += length;
    } else {
      throw new Error(`OctoDiff : commande inconnue 0x${cmd.toString(16)}`);
    }
  }
  return Buffer.concat(chunks, total);
}

/**
 * Produit le fichier final d'une directive PatchedFromArchive.
 * - base déjà identique au résultat (ex. masters déjà nettoyés) → base telle quelle
 * - sinon application du delta, vérifiée par SHA1 quand c'est possible
 * - échec (base d'une autre version) → base telle quelle, statut 'fallback'
 * @returns {{ data:Buffer, status:'already'|'patched'|'fallback', reason?:string }}
 */
export function patchFile(basis, delta) {
  try {
    if (octoDiffResultMatches(basis, delta) === true) return { data: basis, status: 'already' };
    const out = applyOctoDiff(basis, delta);
    if (octoDiffResultMatches(out, delta) === false) return { data: basis, status: 'fallback', reason: 'hash' };
    return { data: out, status: 'patched' };
  } catch (err) {
    return { data: basis, status: 'fallback', reason: String(err?.message || err) };
  }
}
