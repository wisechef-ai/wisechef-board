import { exec as execCb } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { exec, compareSemver } from '../lib/exec.js';
import { logActivity } from '../lib/fileStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..', '..');

export async function getBoardVersion(req, res) {
  const result = {};
  try {
    const tag = await exec(`git -C "${projectRoot}" describe --tags --abbrev=0`);
    result.current = tag.replace(/^v/, '');
  } catch (e) {
    result.current = null;
  }
  try {
    const resp = await fetch('https://api.github.com/repos/wisechef-ai/wisechef-board/tags?per_page=1');
    const tags = await resp.json();
    if (tags.length > 0) {
      result.latest = tags[0].name.replace(/^v/, '');
    } else {
      result.latest = null;
    }
  } catch (e) {
    result.latest = null;
  }
  if (result.current && result.latest) {
    result.outdated = compareSemver(result.current, result.latest) < 0;
  } else {
    result.outdated = null;
  }
  res.json(result);
}

export async function updateBoard(req, res) {
  try {
    await exec(`git -C "${projectRoot}" fetch --tags`);
    const latestTag = await exec(`git -C "${projectRoot}" tag -l 'v*' --sort=-v:refname | head -n1`);
    if (!latestTag) throw new Error('No tags found');
    await exec(`git -C "${projectRoot}" checkout ${latestTag}`);
    await exec(`npm install --production=false --prefix "${projectRoot}"`);
    await exec(`npm run build --prefix "${projectRoot}"`);
    const version = latestTag.replace(/^v/, '');
    logActivity('dashboard', 'wisechef_board_updated', { version });
    res.json({ success: true, version });
    // Restart service after response is sent
    setTimeout(() => {
      execCb('sudo systemctl restart wisechef-board', (err) => {
        if (err) console.error('Failed to restart wisechef-board:', err.message);
      });
    }, 500);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
