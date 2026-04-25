#!/usr/bin/env node
// Client-side skill verification utility
// Usage: node verify-skill.js <tarball-path> <signature-base64> <public-key-base64>
// Or use programmatically:
//   import { verifySkillTarball } from './verify-skill.js';
//   const valid = await verifySkillTarball(tarballBuffer, signatureBase64, publicKeyBase64);

import crypto from 'crypto';
import fs from 'fs';

/**
 * Verify an ed25519 signature on a skill tarball.
 * @param {Buffer} tarballBuffer - The raw .tar.gz content
 * @param {string} signatureBase64 - Base64-encoded ed25519 signature
 * @param {string} publicKeyBase64 - Base64-encoded raw 32-byte ed25519 public key
 * @returns {boolean}
 */
export function verifySkillTarball(tarballBuffer, signatureBase64, publicKeyBase64) {
  const rawPub = Buffer.from(publicKeyBase64, 'base64');

  // Wrap raw ed25519 public key in SPKI DER structure
  // SPKI for ed25519: 30 2a 30 05 06 03 2b 65 70 03 21 00 <32 bytes>
  const spkiHeader = Buffer.from([
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70,
    0x03, 0x21, 0x00,
  ]);
  const spkiDer = Buffer.concat([spkiHeader, rawPub]);

  const pubKey = crypto.createPublicKey({
    key: spkiDer,
    format: 'der',
    type: 'spki',
  });

  // SHA-256 hash of the tarball (this is what was signed)
  const sha256 = crypto.createHash('sha256').update(tarballBuffer).digest();

  // Verify
  const sig = Buffer.from(signatureBase64, 'base64');
  return crypto.verify(null, sha256, pubKey, sig);
}

// CLI usage
if (process.argv[1] && process.argv[1].endsWith('verify-skill.js')) {
  const [,, tarballPath, signatureBase64, publicKeyBase64] = process.argv;
  if (!tarballPath || !signatureBase64 || !publicKeyBase64) {
    console.error('Usage: node verify-skill.js <tarball-path> <signature-base64> <public-key-base64>');
    process.exit(1);
  }
  const tarball = fs.readFileSync(tarballPath);
  const valid = verifySkillTarball(tarball, signatureBase64, publicKeyBase64);
  console.log(valid ? 'PASS: Signature is valid' : 'FAIL: Signature is INVALID');
  process.exit(valid ? 0 : 1);
}
