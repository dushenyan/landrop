export interface Asset {
  id: string;
  current_version_id: number;
  friendly_name: string;
  kind: 'image' | 'video' | 'text' | 'file';
  created_at: string;
  updated_at: string;
  original_name: string;
  mime: string;
  size: number;
  blob_sha256: string;
  source_device: string;
  uploaded_at: string;
  width: number | null;
  height: number | null;
  duration_sec: number | null;
  excerpt?: string;
}


export interface Device {
  id: string;
  name: string;
  last_seen_at: string;
}

export interface ServerInfo {
  name: string;
  address: string;
  ip: string;
  port: number;
  maxFileSize: number;
  stats: { assets: number; versions: number; blobs: number };
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  serverInfo: () => json<ServerInfo>('/api/server-info'),
  accessQrcode: () => '/api/access/qrcode',
  assets: (kind = 'all') => json<Asset[]>(`/api/assets?kind=${encodeURIComponent(kind)}`),
  trash: () => json<Asset[]>('/api/trash'),
  deleteAsset: (id: string) => json<{ ok: boolean }>(`/api/assets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restoreAsset: (id: string) => json<{ ok: boolean }>(`/api/assets/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  renameAsset: (id: string, name: string) =>
    json<{ ok: boolean; name: string }>(`/api/assets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }),
  saveText: (id: string, content: string) =>
    json<{ ok: boolean; versionId: number; size: number; mime: string; name: string; excerpt: string }>(
      `/api/assets/${encodeURIComponent(id)}/text`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }
    ),
  replaceFile: (id: string, file: File) =>
    json<{ ok: boolean; versionId: number; size: number; mime: string; name: string; kind: Asset['kind']; excerpt: string }>(
      `/api/assets/${encodeURIComponent(id)}/replace?name=${encodeURIComponent(file.name)}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      }
    ),
  uploadAsset: (file: File, device: string) =>
    json<{ ok: boolean; id: string; versionId: number; name: string; url: string }>(
      `/api/assets/upload?name=${encodeURIComponent(file.name)}&device=${encodeURIComponent(device)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      }
    ),
  devices: () => json<Device[]>('/api/devices'),
  registerDevice: (id: string, name: string) =>
    json<{ ok: boolean }>('/api/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name }),
    }),
  thumbUrl: (sha: string, kind: string) => `/api/thumbs/${encodeURIComponent(sha)}/${encodeURIComponent(kind)}`,
  fileUrl: (versionId: number) => `/api/versions/${versionId}/file`,
};
