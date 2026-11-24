const KEY = 'landrop-device';

export interface LocalDevice {
  id: string;
  name: string;
}

function defaultName(): string {
  const ua = navigator.userAgent;
  let platform = '设备';
  if (/iPad/.test(ua)) platform = 'iPad';
  else if (/iPhone/.test(ua)) platform = 'iPhone';
  else if (/Macintosh/.test(ua)) platform = 'Mac';
  else if (/Windows/.test(ua)) platform = 'Windows电脑';
  else if (/Android/.test(ua)) platform = '安卓设备';
  return `${platform}`;
}

// crypto.randomUUID() 只在安全上下文可用；局域网 HTTP 下 Safari 没有它，
// 首屏会因它直接抛错。这里优先用原生 API，退化到 getRandomValues，再退化到 Math.random。
function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 局域网 HTTP 下没有 randomUUID，但仍可用 getRandomValues；最后才退化到 Math.random。
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  // 手动拼成 UUID v4 格式，保证与后端/其他设备的 id 形态一致。
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// localStorage 可能被禁用或存了损坏内容，只有形状正确才采用。
function readStored(): LocalDevice | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const { id, name } = parsed as Partial<LocalDevice>;
      if (typeof id === 'string' && id && typeof name === 'string' && name) return { id, name };
    }
  } catch { /* 隐私模式或内容损坏时重新生成 */ }
  return null;
}

function persist(device: LocalDevice): void {
  try { localStorage.setItem(KEY, JSON.stringify(device)); } catch { /* 写不进去就只在内存里用 */ }
}

export function getDevice(): LocalDevice {
  const stored = readStored();
  if (stored) return stored;
  const device: LocalDevice = { id: newId(), name: defaultName() };
  persist(device);
  return device;
}

export function setDeviceName(name: string): LocalDevice {
  const device = getDevice();
  device.name = name;
  persist(device);
  return device;
}
