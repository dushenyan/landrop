import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { Server as TusServer } from '@tus/server';
import { FileStore } from '@tus/file-store';
import Bonjour from 'bonjour-service';
import QRCode from 'qrcode';
import { config, lanIPv4 } from './config.js';
import {
  initDb, listAssets, listDeletedAssets, getAsset, listVersions, getVersion,
  touchDevice, listDevices, stats, getThumb, renameAsset,
  softDeleteAsset, restoreAsset, softDeleteVersion, restoreVersion,
} from './db.js';
import { ingestUpload, ingestPath, ingestBuffer, blobTargetPath } from './ingest.js';

initDb();
for (const dir of [config.uploadDir, config.blobsDir, config.thumbsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

function excerptOf(buffer) {
  return new TextDecoder().decode(buffer.subarray(0, 1024)).replace(/\s+/g, ' ').trim().slice(0, 140);
}

function excerptOfFile(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    return excerptOf(buf.subarray(0, bytes));
  } finally {
    fs.closeSync(fd);
  }
}

// 进程在 CAS 临时文件写入后被杀会留下 .*.tmp，启动时清理超过 1 小时的残余。
function cleanStaleBlobTemps() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const entry of fs.readdirSync(config.blobsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(config.blobsDir, entry.name);
    for (const name of fs.readdirSync(dir)) {
      if (!name.startsWith('.') || !name.endsWith('.tmp')) continue;
      const file = path.join(dir, name);
      try { if (fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file); } catch { /* 忽略 */ }
    }
  }
}
cleanStaleBlobTemps();

const app = express();
app.use(express.json({ limit: '1mb' }));

const ip = lanIPv4();
const baseUrl = `http://${ip}:${config.port}`;

// 前端同源加载；开发模式下 vite 在 5173，额外放行它。
const allowedOrigins = [baseUrl, 'http://localhost:5173', 'http://127.0.0.1:5173'];

const server = http.createServer(app);
const io = new SocketIOServer(server, { path: '/socket.io', cors: { origin: allowedOrigins } });

// ---- 一次性配对令牌 ----
const pairTokens = new Map(); // token -> { createdAt, used }

app.get('/api/server-info', (_req, res) => {
  res.json({
    name: 'LanDrop', address: baseUrl, ip, port: config.port,
    maxFileSize: config.maxFileSize,
    stats: stats(),
  });
});

// 长期访问码：直接指向服务器地址，不使用一次性 pairing token。
app.get('/api/access/qrcode', async (_req, res) => {
  const png = await QRCode.toBuffer(baseUrl, {
    width: 320,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#0f172a', light: '#ffffff' },
  });
  res.set('Content-Type', 'image/png');
  res.set('Cache-Control', 'public, max-age=3600');
  res.send(png);
});

// 顺手清理已用和过期的令牌，避免长期运行时 Map 无限增长
function prunePairTokens() {
  for (const [t, v] of pairTokens) {
    if (v.used || Date.now() - v.createdAt > config.pairTtlMs) pairTokens.delete(t);
  }
}

// 生成一个配对二维码（服务端出图）
app.get('/api/pair/qrcode', async (_req, res) => {
  const token = crypto.randomBytes(16).toString('hex');
  pairTokens.set(token, { createdAt: Date.now(), used: false });
  prunePairTokens();
  const url = `${baseUrl}${config.pairPath}/${token}`;
  const png = await QRCode.toBuffer(url, { width: 320, margin: 2, color: { dark: '#111827', light: '#ffffff' } });
  res.set('Content-Type', 'image/png').send(png);
});

// 配对页校验令牌
app.get(`${config.pairPath}/:token`, (req, res) => {
  prunePairTokens();
  const rec = pairTokens.get(req.params.token);
  if (!rec || rec.used || Date.now() - rec.createdAt > config.pairTtlMs) {
    return res.status(410).type('html').send('<h2>配对链接已失效，请在服务器上重新扫码</h2>');
  }
  rec.used = true;
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>连接 LanDrop</title></head><body style="font-family:system-ui;padding:24px">
    <h2>连接成功</h2><p>你已连接到局域网的 LanDrop 服务器。</p>
    <p><a href="/">打开 LanDrop →</a></p></body></html>`);
});

// ---- 设备 ----
app.post('/api/devices', (req, res) => {
  const { id, name } = req.body || {};
  if (!id || !name) return res.status(400).json({ error: 'id 和 name 必填' });
  touchDevice(id, name);
  io.emit('devices', listDevices());
  res.json({ ok: true, devices: listDevices() });
});

app.get('/api/devices', (_req, res) => res.json(listDevices()));

// ---- 媒体库 ----
app.get('/api/assets', (req, res) => {
  const kind = req.query.kind || 'all';
  const parsedLimit = Number(req.query.limit);
  const parsedOffset = Number(req.query.offset);
  // SQLite 里负数 LIMIT 表示不限制，必须挡住；非法值回退默认值。
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(Math.floor(parsedLimit), 1000) : 200;
  const offset = Number.isFinite(parsedOffset) && parsedOffset > 0 ? Math.floor(parsedOffset) : 0;
  res.json(listAssets({ kind, limit, offset }));
});

app.get('/api/assets/:id', (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset) return res.status(404).json({ error: 'not found' });
  res.json({ asset, versions: listVersions(req.params.id) });
});

app.patch('/api/assets/:id', (req, res) => {
  const name = String(req.body?.name || '').trim().slice(0, 255);
  if (!name) return res.status(400).json({ error: 'name 必填' });
  const asset = renameAsset(req.params.id, name);
  if (!asset) return res.status(404).json({ error: 'not found' });
  io.emit('library-changed');
  res.json({ ok: true, name });
});

app.put('/api/assets/:id/text', async (req, res) => {
  const content = req.body?.content;
  if (typeof content !== 'string') return res.status(400).json({ error: 'content 必须是字符串' });
  const asset = getAsset(req.params.id);
  if (!asset || asset.deleted_at) return res.status(404).json({ error: 'not found' });
  const current = getVersion(asset.current_version_id);
  const name = current?.original_name || asset.friendly_name;
  const buffer = Buffer.from(content, 'utf8');
  const result = await ingestBuffer({
    assetId: asset.id,
    buffer,
    originalName: name,
    sourceDevice: current?.source_device,
    mime: 'text/markdown',
  });
  io.emit('library-changed');
  res.json({
    ok: true,
    versionId: result.version.id,
    size: result.version.size,
    mime: result.version.mime,
    name,
    excerpt: excerptOf(buffer),
  });
});

app.put('/api/assets/:id/replace', async (req, res) => {
  const asset = getAsset(req.params.id);
  if (!asset || asset.deleted_at) return res.status(404).json({ error: 'not found' });
  const current = getVersion(asset.current_version_id);
  const name = String(req.query.name || '').trim().slice(0, 255) || asset.friendly_name;

  await fs.promises.mkdir(config.uploadDir, { recursive: true });
  const tmp = path.join(config.uploadDir, `.replace-${crypto.randomUUID()}`);
  try {
    await pipeline(req, fs.createWriteStream(tmp));
    if (fs.statSync(tmp).size === 0) return res.status(400).json({ error: '文件内容为空' });
    const result = await ingestPath({
      filePath: tmp,
      originalName: name,
      sourceDevice: current?.source_device,
      deviceId: current?.source_device,
      declaredMime: req.header('content-type') || current?.mime || '',
      assetId: asset.id,
    });
    const isText = result.kind === 'text' || /^(text\/|application\/json$)/.test(result.version.mime);
    io.emit('library-changed');
    res.json({
      ok: true,
      versionId: result.version.id,
      size: result.version.size,
      mime: result.version.mime,
      name,
      kind: result.kind,
      excerpt: isText ? excerptOfFile(tmp) : '',
    });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

app.post('/api/assets/upload', async (req, res) => {
  const name = String(req.query.name || '').trim().slice(0, 255) || '未命名文件';
  const sourceDevice = String(req.query.device || '').trim().slice(0, 120) || 'unknown';
  touchDevice(sourceDevice, sourceDevice);

  await fs.promises.mkdir(config.uploadDir, { recursive: true });
  const tmp = path.join(config.uploadDir, `.upload-${crypto.randomUUID()}`);
  try {
    await pipeline(req, fs.createWriteStream(tmp));
    if (fs.statSync(tmp).size === 0) return res.status(400).json({ error: '文件内容为空' });
    const result = await ingestPath({
      filePath: tmp,
      originalName: name,
      sourceDevice,
      deviceId: sourceDevice,
      declaredMime: req.header('content-type') || '',
    });
    io.emit('library-changed');
    res.json({
      ok: true,
      id: result.assetId,
      versionId: result.version.id,
      name,
      url: `/api/versions/${result.version.id}/file`,
    });
  } finally {
    fs.rmSync(tmp, { force: true });
  }
});

// ---- 回收站：软删除，CAS 字节暂不清理 ----
app.get('/api/trash', (_req, res) => res.json(listDeletedAssets()));

app.delete('/api/assets/:id', (req, res) => {
  const ok = softDeleteAsset(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  io.emit('library-changed');
  res.json({ ok: true });
});

app.post('/api/assets/:id/restore', (req, res) => {
  const ok = restoreAsset(req.params.id);
  if (!ok) return res.status(404).json({ error: 'not found' });
  io.emit('library-changed');
  res.json({ ok: true });
});

app.delete('/api/versions/:id', (req, res) => {
  const id = Number(req.params.id);
  const version = Number.isInteger(id) ? softDeleteVersion(id) : null;
  if (!version) return res.status(404).json({ error: 'not found' });
  io.emit('library-changed');
  res.json({ ok: true });
});

app.post('/api/versions/:id/restore', (req, res) => {
  const id = Number(req.params.id);
  const version = Number.isInteger(id) ? restoreVersion(id) : null;
  if (!version) return res.status(404).json({ error: 'not found' });
  io.emit('library-changed');
  res.json({ ok: true });
});

// 原始文件下载（支持 Range，视频可拖动）
app.get('/api/versions/:id/file', (req, res) => {
  const versionId = Number(req.params.id);
  const v = Number.isInteger(versionId) ? getVersion(versionId) : null;
  if (!v) return res.status(404).json({ error: 'not found' });
  const filePath = blobTargetPath(v.blob_sha256);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'blob missing' });
  // 老数据可能带 MIME 参数（如 text/html; charset=utf-8），先归一化再判断。
  // 只有明确可安全预览的类型才 inline，其余一律 attachment，堵住同源脚本执行。
  const mime = (v.mime || '').split(';')[0].trim().toLowerCase();
  const safeInline = /^(image\/(jpeg|png|gif|webp|heic|heif)|video\/(mp4|quicktime|webm)|audio\/(mpeg|mp4|ogg|wav)|application\/(pdf|json)|text\/(plain|markdown|csv|x-markdown|x-csv))$/.test(mime);
  const disposition = `${safeInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(v.original_name)}`;
  res.set('X-Content-Type-Options', 'nosniff');
  if (!safeInline) res.set('Content-Security-Policy', "default-src 'none'; sandbox");
  res.set('Content-Type', mime || 'application/octet-stream');
  res.set('Content-Disposition', disposition);
  res.sendFile(filePath);
});

// 缩略图
app.get('/api/thumbs/:sha/:kind', (req, res) => {
  const t = getThumb(req.params.sha, req.params.kind);
  if (!t) return res.status(404).end();
  const file = path.join(config.dataDir, t.path);
  if (!fs.existsSync(file)) return res.status(404).end();
  res.set('Content-Type', t.mime || 'image/jpeg');
  res.sendFile(file);
});

// ---- tus 上传 ----
const fileStore = new FileStore({ directory: config.uploadDir });
const tusServer = new TusServer({
  path: '/uploads',
  datastore: fileStore,
  maxSize: config.maxFileSize,
  // @tus/server 只认 allowedOrigins / allowedHeaders，没有 options.cors。
  allowedOrigins: (origin) => allowedOrigins.includes(origin),
  allowedHeaders: ['Authorization', 'Content-Type', 'Tus-Resumable', 'Upload-Length', 'Upload-Metadata', 'Upload-Offset', 'Upload-Defer-Length', 'Upload-Concat'],
  async onUploadFinish(_req, upload) {
    const result = await ingestUpload(upload);
    io.emit('new-version', {
      assetId: result.assetId,
      versionId: result.version.id,
      name: result.version.original_name,
      from: result.version.source_device,
      targets: result.targets,
    });
    return {};
  },
});
app.all('/uploads', (req, res) => tusServer.handle(req, res));
app.all('/uploads/*splat', (req, res) => tusServer.handle(req, res));

// ---- 同源托管前端 ----
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  app.get('/*splat', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads') || req.path.startsWith('/p/') || req.path.startsWith('/socket.io')) {
      return next();
    }
    res.sendFile(path.join(config.webDist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.type('html').send('<h2>LanDrop 后端已启动</h2><p>前端尚未构建。请构建 web 目录后刷新。</p>');
  });
}

io.on('connection', (socket) => {
  io.emit('devices', listDevices());
});

server.listen(config.port, config.host, () => {
  console.log('');
  console.log('  LanDrop 已启动');
  console.log(`  局域网地址：${baseUrl}`);
  console.log(`  配对二维码：${baseUrl}/api/pair/qrcode`);
  console.log(`  数据目录：${config.dataDir}`);
  console.log('');
});

// mDNS 广播（桌面端自动发现用），失败不影响主服务
let bonjour;
try {
  bonjour = new Bonjour();
  bonjour.publish({
    name: 'LanDrop',
    type: 'landrop',
    subtypes: ['http'],
    port: config.port,
    // 冲突探测失败时库会打印整段 Error 堆栈；mDNS 只是锦上添花，不必抢这个探针。
    probe: false,
    txt: { path: '/', ver: '1', addr: ip },
  });
  // publish 的冲突探测是异步的，这里只说明已发起发布，不代表广播一定成功。
  console.log('  mDNS 广播正在发布（_landrop._tcp）');
} catch (err) {
  console.warn('  mDNS 广播未开启：', err.message);
}

function shutdown() {
  bonjour?.destroy();
  server.closeAllConnections?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
