import { scanSkills } from '../lib/skills.js';
import {
  uploadSkillTarball,
  getPresignedUrl,
  getSignature,
  listStoredSkills,
  packageSkillDir,
  healthCheck,
} from '../lib/skillStorage.js';

/**
 * GET /api/skills/packages
 * List all skill tarballs stored in MinIO.
 */
export async function listPackages(req, res) {
  try {
    const packages = await listStoredSkills();
    res.json({ ok: true, packages });
  } catch (err) {
    console.error('[skills/packages]', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * GET /api/skills/:id/install?version=1.0.0
 * Returns a presigned S3 URL (5-min expiry) + ed25519 signature for the client to verify.
 */
export async function installSkill(req, res) {
  const { id } = req.params;
  const version = req.query.version || '1.0.0';

  try {
    const url = await getPresignedUrl(id, version, 300);
    const signature = await getSignature(id, version);
    res.json({
      ok: true,
      slug: id,
      version,
      url,          // presigned S3 URL, expires in 5 min
      signature,    // base64 ed25519 signature of SHA-256(tarball)
      algorithm: 'ed25519',
    });
  } catch (err) {
    console.error(`[skills/install] ${id}@${version}:`, err.message);
    res.status(404).json({ ok: false, error: `Skill ${id}@${version} not found in registry` });
  }
}

/**
 * POST /api/skills/:id/publish
 * Package a skill directory and upload to MinIO.
 * Body: { version: string }
 */
export async function publishSkill(req, res) {
  const { id } = req.params;
  const version = req.body?.version || '1.0.0';

  try {
    const all = scanSkills();
    const skill = all.find(s => s.id === id);
    if (!skill) return res.status(404).json({ ok: false, error: `Skill "${id}" not found on disk` });

    console.log(`[skills/publish] Packaging ${id}@${version} from ${skill.path}...`);
    const tarball = await packageSkillDir(skill.path);
    const result = await uploadSkillTarball(id, version, tarball);

    res.json({
      ok: true,
      slug: id,
      version,
      size: result.size,
      sha256: result.sha256,
      s3Key: result.s3Key,
    });
  } catch (err) {
    console.error(`[skills/publish] ${id}@${version}:`, err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * POST /api/skills/publish-all
 * Package and upload all scanned skills.
 * Body: { version: string }
 */
export async function publishAllSkills(req, res) {
  const version = req.body?.version || '1.0.0';

  try {
    const all = scanSkills();
    const results = [];

    for (const skill of all) {
      try {
        console.log(`[skills/publish-all] Packaging ${skill.id}@${version}...`);
        const tarball = await packageSkillDir(skill.path);
        const result = await uploadSkillTarball(skill.id, version, tarball);
        results.push({ slug: skill.id, version, ok: true, size: result.size, sha256: result.sha256 });
      } catch (err) {
        console.error(`[skills/publish-all] ${skill.id} failed:`, err.message);
        results.push({ slug: skill.id, version, ok: false, error: err.message });
      }
    }

    const succeeded = results.filter(r => r.ok).length;
    res.json({ ok: true, total: all.length, succeeded, failed: all.length - succeeded, results });
  } catch (err) {
    console.error('[skills/publish-all]:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
}

/**
 * GET /api/skills/storage/health
 * Health check for MinIO storage backend.
 */
export async function storageHealth(req, res) {
  const status = await healthCheck();
  res.json(status);
}
