import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { config } from './config.js';
import { saveThumb } from './db.js';

const execFileAsync = promisify(execFile);

// 按文件头嗅探真实类型，不信任客户端给的 MIME
const MAGIC = [
  { mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/gif', test: (b) => b.subarray(0, 6).toString('ascii') === 'GIF89a' || b.subarray(0, 6).toString('ascii') === 'GIF87a' },
  { mime: 'image/webp', test: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' },
  { mime: 'image/heic', test: (b) => b.subarray(4, 12).toString('ascii').includes('heic') || b.subarray(4, 12).toString('ascii').includes('heix') },
  { mime: 'video/quicktime', test: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp' && b.subarray(8, 12).toString('ascii') === 'qt  ' },
  { mime: 'video/mp4', test: (b) => b.subarray(4, 8).toString('ascii') === 'ftyp' },
  { mime: 'video/webm', test: (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) },
  { mime: 'application/pdf', test: (b) => b.subarray(0, 5).toString('ascii') === '%PDF-' },
  { mime: 'application/zip', test: (b) => b[0] === 0x50 && b[1] === 0x4b },
];

export function sniffMime(filePath, fallback = 'application/octet-stream') {
  // 只读文件头；finally 保证任何异常路径都不泄漏 fd。
  const head = Buffer.alloc(64);
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, head, 0, head.length, 0);
  } catch {
    return fallback;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  for (const entry of MAGIC) {
    if (entry.test(head)) return entry.mime;
  }
  return fallback;
}

export function kindOf(mime) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('text/')) return 'text';
  return 'file';
}

// 图片缩略图：自动按 EXIF 转正，输出 JPEG
async function imageThumb(src, sha256) {
  const meta = await sharp(src, { failOn: 'none' }).metadata();
  // metadata().autoOrient 才是按 EXIF 转正后的尺寸；meta.width/height 是原始尺寸。
  const w = meta.autoOrient?.width ?? meta.width;
  const h = meta.autoOrient?.height ?? meta.height;
  const outRel = path.join('thumbs', sha256, '320.jpg');
  const outAbs = path.join(config.dataDir, outRel);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  await sharp(src, { failOn: 'none' })
    .rotate() // 无参数 = 按 EXIF 自动转正
    .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 70 })
    .toFile(outAbs);
  saveThumb(sha256, 'small', outRel, w, h, 'image/jpeg');
  return { width: w, height: h };
}

// 视频首帧：用系统 ffmpeg，失败则忽略，不阻断主流程
async function videoThumb(src, sha256, mime) {
  const outRel = path.join('thumbs', sha256, 'frame.jpg');
  const outAbs = path.join(config.dataDir, outRel);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  try {
    await execFileAsync('ffmpeg', [
      '-y', '-ss', '1', '-i', src, '-frames:v', '1',
      '-vf', 'scale=320:-2', '-q:v', '5', outAbs,
    ], { timeout: 15000 });
    saveThumb(sha256, 'frame', outRel, 320, null, 'image/jpeg');
  } catch {
    // ffmpeg 失败就当没有封面
  }
  let duration = null;
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', src,
    ], { timeout: 10000 });
    const d = Number(stdout.trim());
    if (Number.isFinite(d)) duration = d;
  } catch {
    // 取不到时长也无妨
  }
  return { duration };
}

// 生成缩略图，返回媒体元数据补充字段
export async function makeThumb(src, sha256, mime) {
  try {
    if (mime.startsWith('image/')) {
      const dim = await imageThumb(src, sha256);
      return { ...dim };
    }
    if (mime.startsWith('video/')) {
      const info = await videoThumb(src, sha256, mime);
      return info;
    }
  } catch (err) {
    console.warn('[thumb] 生成失败:', err.message);
  }
  return {};
}
