import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(__dirname, '..');
const projectDir = path.resolve(serverDir, '..');

// 相对路径按项目根目录解析：子进程从 server/ 启动时，./data 否则会落到 server/data，
// 而且 Express sendFile 要求绝对路径。
const dataDir = path.resolve(process.env.LANDROP_DATA_DIR || path.join(projectDir, 'data'));

function positiveInt(value, fallback, label) {
  const n = Number(value ?? fallback);
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new Error(`${label} 必须是正整数，收到：${value}`);
  }
  return n;
}

export const config = {
  port: positiveInt(process.env.LANDROP_PORT, 6861, 'LANDROP_PORT'),
  host: '0.0.0.0',
  serverDir,
  projectDir,
  dataDir,
  uploadDir: path.join(dataDir, 'uploads'),
  blobsDir: path.join(dataDir, 'blobs', 'sha256'),
  thumbsDir: path.join(dataDir, 'thumbs'),
  dbPath: path.join(dataDir, 'media.db'),
  webDist: path.join(projectDir, 'web', 'dist'),
  // NaN 会让 tus 的大小限制静默失效，0/负数会让任何上传失败，启动时直接拒绝。
  maxFileSize: positiveInt(process.env.LANDROP_MAX_FILE, 10 * 1024 * 1024 * 1024, 'LANDROP_MAX_FILE'),
  // 配对链接前缀（内网 IP + 端口在启动时拼上）
  pairPath: '/p',
  pairTtlMs: 5 * 60 * 1000,
};

// 取一个可用的内网 IPv4。多网卡时优先 192.168 / 10 / 172 网段
export function lanIPv4() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const list of Object.values(interfaces)) {
    for (const iface of list || []) {
      if (iface.family === 'IPv4' && !iface.internal) candidates.push(iface.address);
    }
  }
  const preferred = candidates.find((ip) => /^192\.168\./.test(ip))
    || candidates.find((ip) => /^10\./.test(ip))
    || candidates.find((ip) => /^172\.(1[6-9]|2\d|3[01])\./.test(ip))
    || candidates[0];
  if (!preferred) {
    throw new Error('未检测到局域网 IPv4 地址，请检查网络连接');
  }
  return preferred;
}
