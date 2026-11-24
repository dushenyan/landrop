import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { config } from './config.js';
import {
  createAsset, findAssetByNameAndDevice, nextVersionNo, insertVersion,
  upsertBlob, recordTransfer, getAsset, getVersion, setAssetKind,
} from './db.js';
import { sniffMime, kindOf, makeThumb } from './media.js';

export async function ingestUpload(upload) {
  const tmpPath = upload.storage?.path;
  if (!tmpPath || !fs.existsSync(tmpPath)) {
    throw new Error('上传的临时文件不存在');
  }

  const meta = upload.metadata || {};
  const originalName = decodeMeta(meta.filename) || '未命名文件';
  const sourceDevice = decodeMeta(meta.device) || 'unknown';
  const deviceId = decodeMeta(meta.deviceId) || sourceDevice;
  const recipientsRaw = decodeMeta(meta.recipients) || 'ALL';
  const rawMime = decodeMeta(meta.filetype) || decodeMeta(meta.type) || decodeMeta(meta.mime) || '';

  const result = await ingestPath({
    filePath: tmpPath,
    originalName,
    sourceDevice,
    deviceId,
    recipientsRaw,
    declaredMime: rawMime,
  });

  const targets = recipientsRaw === 'ALL' ? ['ALL'] : recipientsRaw.split(',').map((s) => s.trim()).filter(Boolean);
  for (const to of targets) {
    recordTransfer(crypto.randomUUID(), result.version.id, deviceId, to);
  }

  try { fs.unlinkSync(tmpPath); } catch { /* 忽略 */ }

  return { version: result.version, assetId: result.assetId, asset: result.asset, targets };
}

// 共用路径；assetId 存在时挂到已有资产（编辑/替换），否则按设备+文件名归档。
export async function ingestPath({
  filePath, originalName, sourceDevice, deviceId, recipientsRaw = 'ALL', declaredMime = '', assetId = null,
}) {
  if (!filePath || !fs.existsSync(filePath)) throw new Error('文件不存在');

  const sha256 = await hashFile(filePath);
  const size = fs.statSync(filePath).size;
  const mime = sniffMime(filePath, normalizeMime(declaredMime));
  const kind = kindOf(mime);

  const blobPath = blobTargetPath(sha256);
  if (!fs.existsSync(blobPath)) {
    fs.mkdirSync(path.dirname(blobPath), { recursive: true });
    const tmp = path.join(path.dirname(blobPath), `.${crypto.randomUUID()}.tmp`);
    try {
      await pipeline(fs.createReadStream(filePath), fs.createWriteStream(tmp));
      fs.chmodSync(tmp, 0o644);
      try {
        fs.linkSync(tmp, blobPath);
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  upsertBlob(sha256, size);

  const mediaInfo = await makeThumb(blobPath, sha256, mime);
  const now = new Date().toISOString();
  const ownerId = deviceId || sourceDevice || 'unknown';
  let asset = assetId ? getAsset(assetId) : findAssetByNameAndDevice(originalName, ownerId);
  if (!asset) {
    if (assetId) throw new Error('资产不存在或已删除');
    asset = createAsset(`${ownerId}:${crypto.randomUUID()}`, originalName, kind, now);
  }

  const prev = getVersion(asset.current_version_id);
  const versionId = insertVersion({
    asset_id: asset.id,
    version_no: nextVersionNo(asset.id),
    prev_version_id: prev ? prev.id : null,
    blob_sha256: sha256,
    original_name: originalName || asset.friendly_name,
    mime,
    size,
    source_device: sourceDevice || prev?.source_device || 'unknown',
    uploaded_at: now,
    width: mediaInfo.width,
    height: mediaInfo.height,
    duration_sec: mediaInfo.duration,
    meta_json: { recipients: recipientsRaw, originalMime: normalizeMime(declaredMime) || null },
  });
  setAssetKind(asset.id, kind);
  return { version: getVersion(versionId), assetId: asset.id, asset, kind };
}

// 文本编辑：内容已在内存中，写临时文件后走同一套 CAS / 版本逻辑。
export async function ingestBuffer({ assetId, buffer, originalName, sourceDevice, mime }) {
  await fs.promises.mkdir(config.uploadDir, { recursive: true });
  const tmp = path.join(config.uploadDir, `.edit-${crypto.randomUUID()}`);
  try {
    await fs.promises.writeFile(tmp, buffer);
    return await ingestPath({
      filePath: tmp,
      originalName,
      sourceDevice,
      deviceId: sourceDevice,
      declaredMime: mime,
      assetId,
    });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

function decodeMeta(value) {
  return value || '';
}

function normalizeMime(value) {
  const candidate = String(value || '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(candidate)
    ? candidate
    : 'application/octet-stream';
}

function blobTargetPath(sha256) {
  const prefix = sha256.slice(0, 2);
  const rest = sha256.slice(2);
  return path.join(config.blobsDir, prefix, rest);
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

export { blobTargetPath };
