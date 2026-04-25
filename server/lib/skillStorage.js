import { Client } from 'minio';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

// --- Config ---
const SKILL_CONFIG_DIR = process.env.SKILL_CONFIG_DIR || path.join(process.env.HOME, '.config/skills');
const ENV_FILE = path.join(SKILL_CONFIG_DIR, 'minio.env');

let minioClient = null;
let bucketName = 'recipes-skills';

function loadEnv() {
  try {
    const content = fs.readFileSync(ENV_FILE, 'utf-8');
    const env = {};
    for (const line of content.split('\n')) {
      const m = line.match(/^(\w+)=(.*)$/);
      if (m) env[m[1]] = m[2];
    }
    return env;
  } catch {
    return null;
  }
}

function getMinioClient() {
  if (minioClient) return minioClient;
  const env = loadEnv();
  if (!env) throw new Error('MinIO config not found at ' + ENV_FILE);
  minioClient = new Client({
    endPoint: env.MINIO_ENDPOINT || '127.0.0.1',
    port: parseInt(env.MINIO_PORT || '9000', 10),
    useSSL: env.MINIO_USE_SSL === 'true',
    accessKey: env.MINIO_ACCESS_KEY,
    secretKey: env.MINIO_SECRET_KEY,
  });
  bucketName = env.MINIO_BUCKET || 'recipes-skills';
  return minioClient;
}

// --- Key Loading ---
function loadSigningKey() {
  const keyPath = path.join(SKILL_CONFIG_DIR, 'signing.pem');
  return fs.readFileSync(keyPath, 'utf-8');
}

function loadPublicKey() {
  const pubPath = path.join(SKILL_CONFIG_DIR, 'signing.pub.pem');
  return fs.readFileSync(pubPath, 'utf-8');
}

// --- Tarball Operations ---

/**
 * Upload a skill tarball to S3 and sign it.
 * @param {string} slug - Skill directory name (used as key prefix)
 * @param {string} version - Semver version string
 * @param {Buffer} tarballBuffer - The .tar.gz content
 * @returns {{ s3Key, signature, size, sha256 }}
 */
export async function uploadSkillTarball(slug, version, tarballBuffer) {
  const mc = getMinioClient();
  const s3Key = `${slug}/${version}.tar.gz`;

  // Compute SHA-256 before upload
  const sha256 = crypto.createHash('sha256').update(tarballBuffer).digest('hex');

  // Upload to MinIO
  await mc.putObject(bucketName, s3Key, tarballBuffer, tarballBuffer.length, {
    'Content-Type': 'application/gzip',
    'x-amz-meta-sha256': sha256,
    'x-amz-meta-version': version,
  });

  // Sign the hash with ed25519
  const privateKeyPem = loadSigningKey();
  const sig = crypto.sign(null, Buffer.from(sha256, 'hex'), privateKeyPem);

  // Upload signature alongside tarball
  const sigKey = `${slug}/${version}.sig`;
  await mc.putObject(bucketName, sigKey, sig, sig.length, {
    'Content-Type': 'application/octet-stream',
  });

  return { s3Key, signature: sig.toString('base64'), size: tarballBuffer.length, sha256 };
}

/**
 * Generate a presigned URL for downloading a skill tarball.
 * @param {string} slug
 * @param {string} version
 * @param {number} expirySeconds - Default 300 (5 min)
 * @returns {Promise<string>}
 */
export async function getPresignedUrl(slug, version, expirySeconds = 300) {
  const mc = getMinioClient();
  const s3Key = `${slug}/${version}.tar.gz`;
  return mc.presignedGetObject(bucketName, s3Key, expirySeconds);
}

/**
 * Get the signature for a specific skill version.
 * @param {string} slug
 * @param {string} version
 * @returns {Promise<string>} base64-encoded signature
 */
export async function getSignature(slug, version) {
  const mc = getMinioClient();
  const sigKey = `${slug}/${version}.sig`;
  const stream = await mc.getObject(bucketName, sigKey);
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    stream.on('error', reject);
  });
}

/**
 * List all skill versions stored in S3.
 * @returns {Promise<Array<{slug, version, size, lastModified}>>}
 */
export async function listStoredSkills() {
  const mc = getMinioClient();
  const skills = new Map();
  return new Promise((resolve, reject) => {
    const stream = mc.listObjects(bucketName, '', true);
    stream.on('data', (obj) => {
      // Parse "slug/version.tar.gz" or "slug/version.sig"
      if (obj.name.endsWith('.tar.gz')) {
        const parts = obj.name.split('/');
        const version = parts[parts.length - 1].replace('.tar.gz', '');
        const slug = parts.slice(0, -1).join('/');
        const key = `${slug}@${version}`;
        skills.set(key, { slug, version, size: obj.size, lastModified: obj.lastModified });
      }
    });
    stream.on('end', () => resolve(Array.from(skills.values())));
    stream.on('error', reject);
  });
}

/**
 * Verify a skill tarball's ed25519 signature.
 * @param {Buffer} tarballBuffer
 * @param {string} signatureBase64
 * @returns {boolean}
 */
export function verifySignature(tarballBuffer, signatureBase64) {
  const pubKeyPem = loadPublicKey();
  const sha256 = crypto.createHash('sha256').update(tarballBuffer).digest();
  const sig = Buffer.from(signatureBase64, 'base64');
  return crypto.verify(null, sha256, pubKeyPem, sig);
}

/**
 * Package a skill directory into a tar.gz buffer.
 * @param {string} skillPath - Absolute path to the skill directory
 * @returns {Promise<Buffer>}
 */
export async function packageSkillDir(skillPath) {
  const { execFile } = await import('child_process');
  const util = await import('util');
  const execFileAsync = util.promisify(execFile);

  // Use tar to create a gzipped archive in memory
  const { stdout } = await execFileAsync('tar', ['-czf', '-', '-C', path.dirname(skillPath), path.basename(skillPath)], {
    maxBuffer: 50 * 1024 * 1024,
    encoding: 'buffer',
  });
  return stdout;
}

/**
 * Health check — verify MinIO is reachable.
 * @returns {Promise<{ok: boolean, buckets: string[]}>}
 */
export async function healthCheck() {
  try {
    const mc = getMinioClient();
    const buckets = await mc.listBuckets();
    return { ok: true, buckets: buckets.map(b => b.name) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
