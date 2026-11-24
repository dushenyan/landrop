import { useCallback, useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Asset, type Device, type ServerInfo } from './api';
import { io } from 'socket.io-client';
import { getDevice, setDeviceName } from './device';
import Icon from './icons';
import Uploader from './Uploader';
import Gallery from './Gallery';
import PreviewModal from './PreviewModal';
import AccessModal from './AccessModal';
import { copyText } from './clipboard';
import { useScrollLock } from './useScrollLock';

const queryClient = new QueryClient();


function AppInner() {
  const qc = useQueryClient();
  const device = getDevice();
  const [deviceName, setDeviceNameState] = useState(device.name);
  const [recipients, setRecipients] = useState('ALL');
  const [view, setView] = useState<'library' | 'trash'>('library');
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [toast, setToast] = useState('');
  const [confirm, setConfirm] = useState<{ message: string; action: () => void } | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  useScrollLock(!!confirm);

  const infoQ = useQuery<ServerInfo>({ queryKey: ['info'], queryFn: api.serverInfo });
  const serverAddress = infoQ.data?.address ?? window.location.origin;
  const assetsQ = useQuery<Asset[]>({ queryKey: ['assets'], queryFn: () => api.assets() });
  const devicesQ = useQuery<Device[]>({ queryKey: ['devices'], queryFn: api.devices });
  const trashQ = useQuery<Asset[]>({ queryKey: ['trash'], queryFn: api.trash, enabled: view === 'trash' });

  const toastTimer = useRef<number | null>(null);
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3500);
  }, []);

  useEffect(() => () => {
    if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
  }, []);

  const copyAddress = useCallback(async () => {
    if (await copyText(serverAddress)) {
      showToast('访问地址已复制');
    } else {
      window.prompt('手动复制：', serverAddress);
    }
  }, [serverAddress, showToast]);

  // 注册设备 + 建立实时连接
  useEffect(() => {
    api.registerDevice(device.id, device.name)
      .then(() => qc.invalidateQueries({ queryKey: ['devices'] }))
      .catch(() => showToast('设备注册失败，刷新页面重试'));
    const socket = io();
    socket.on('devices', () => qc.invalidateQueries({ queryKey: ['devices'] }));
    socket.on('new-version', (payload: { name: string; from: string }) => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['info'] });
      showToast(`收到 ${payload.from} 发来的 ${payload.name}`);
    });
    socket.on('library-changed', () => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['trash'] });
      qc.invalidateQueries({ queryKey: ['info'] });
    });
    return () => { socket.disconnect(); };
  }, [qc, device.id, device.name, showToast]);

  const onUploaded = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['assets'] });
    qc.invalidateQueries({ queryKey: ['info'] });
    showToast('上传完成，已保存到媒体库');
  }, [qc, showToast]);

  const refreshLibrary = useCallback(() => {
    qc.invalidateQueries({ queryKey: ['assets'] });
    qc.invalidateQueries({ queryKey: ['trash'] });
    qc.invalidateQueries({ queryKey: ['info'] });
  }, [qc]);

  const deleteAsset = useCallback((id: string) => {
    setConfirm({
      message: '删除到回收站？之后可以恢复。',
      action: () => {
        api.deleteAsset(id)
          .then(() => { refreshLibrary(); showToast('已移到回收站'); })
          .catch(() => showToast('删除失败，请重试'));
      },
    });
  }, [refreshLibrary, showToast]);

  const restoreAsset = useCallback(async (id: string) => {
    try {
      await api.restoreAsset(id);
      refreshLibrary();
      showToast('已恢复到媒体库');
    } catch { showToast('恢复失败，请重试'); }
  }, [refreshLibrary, showToast]);

  const renameAsset = useCallback((id: string, name: string) => {
    const next = window.prompt('重命名文件', name);
    if (!next || !next.trim() || next.trim() === name) return;
    api.renameAsset(id, next.trim())
      .then(() => { refreshLibrary(); showToast('已重命名'); })
      .catch(() => showToast('重命名失败，请重试'));
  }, [refreshLibrary, showToast]);

  const handlePreviewSaved = useCallback((updated: Asset) => {
    setPreviewAsset(updated);
    qc.invalidateQueries({ queryKey: ['assets'] });
    qc.invalidateQueries({ queryKey: ['trash'] });
    qc.invalidateQueries({ queryKey: ['info'] });
  }, [qc]);



  const renameDevice = useCallback(() => {
    const next = window.prompt('给这台设备起个名字', deviceName);
    if (next && next.trim()) {
      const d = setDeviceName(next.trim());
      setDeviceNameState(d.name);
      api.registerDevice(d.id, d.name).catch(() => showToast('设备名同步失败，稍后重试'));
      qc.invalidateQueries({ queryKey: ['devices'] });
    }
  }, [deviceName, qc, showToast]);

  const others = Array.from(new Map(
    (devicesQ.data || [])
      .filter((d) => d.id !== device.id && d.name !== deviceName)
      .map((d) => [d.name, d] as const)
  ).values());

  return (
    <div className="app">
      <aside className="side">
      <header className="header">
        <div className="brand">
          <span className="logo"><Icon name="mark" size={18} /></span>
          <div>
            <h1>LanDrop</h1>
            <p>局域网闪传 · 原文件不压缩</p>
          </div>
        </div>
        <div className="access-row">
          <button type="button" className="access-chip" onClick={() => setAccessOpen(true)}
            aria-label="查看扫码访问地址" title="扫码访问">
            <Icon name="qr" size={14} />
            <span className="access-addr">{infoQ.data?.ip ?? '扫码访问'}</span>
          </button>
          <button type="button" className="access-copy" onClick={copyAddress}
            aria-label="复制访问地址" title="复制访问地址">
            <Icon name="copy" size={14} />
          </button>
        </div>
        <button type="button" className="device-chip" onClick={renameDevice}
          aria-label={`设备 ${deviceName}，点击改名`} title="点击改名">
          <Icon name="device" size={13} /><span>{deviceName}</span>
        </button>
      </header>

      <section className="panel">
        <div className="panel-head">
          <h2>发送</h2>
          <span className="dim small">接收设备</span>
        </div>
        <div className="recipients">
          <label className="radio-chip">
            <input type="radio" name="recipient" value="ALL" defaultChecked
              onChange={() => setRecipients('ALL')} />
            <span>所有设备</span>
          </label>
          {others.map((d) => (
            <label className="radio-chip" key={d.id}>
              <input type="radio" name="recipient" value={d.id}
                onChange={() => setRecipients(d.id)} />
              <span>{d.name}</span>
            </label>
          ))}
        </div>
        <Uploader device={{ id: device.id, name: deviceName }} recipients={recipients}
          maxFileSize={infoQ.data?.maxFileSize ?? 10 * 1024 * 1024 * 1024}
          onComplete={onUploaded} />
      </section>
        <footer className="footer dim">
          {infoQ.data && <>服务器 {infoQ.data.address} · CAS 去重</>}
        </footer>
      </aside>

      <main className="panel content">
        <div className="panel-head">
          <h2>媒体库</h2>
          <button type="button" className="btn subtle" aria-pressed={view === 'trash'}
            onClick={() => setView(view === 'trash' ? 'library' : 'trash')}>
            <Icon name="trash" size={12} />{view === 'trash' ? '返回媒体库' : '回收站'}
          </button>
          {infoQ.data && (
            <span className="dim small">
              {view === 'trash'
                ? `${trashQ.data?.length ?? 0} 项待恢复`
                : `${infoQ.data.stats.assets} 文件`}
            </span>
          )}
        </div>
        <div className="library-scroll">
        {(view === 'trash' ? trashQ : assetsQ).isError ? (
          <p className="dim">加载失败 · <button type="button" className="link-btn"
            onClick={() => (view === 'trash' ? trashQ : assetsQ).refetch()}>重试</button></p>
        ) : (view === 'trash' ? trashQ : assetsQ).isLoading ? <p className="dim">加载中…</p> :
          <Gallery
            assets={(view === 'trash' ? trashQ : assetsQ).data || []}
            trash={view === 'trash'}
            onPreview={setPreviewAsset}
            onRename={renameAsset}
            onDelete={deleteAsset}
            onRestore={restoreAsset}
          />}
        </div>
      </main>


      {previewAsset && <PreviewModal asset={previewAsset} onSaved={handlePreviewSaved} onClose={() => setPreviewAsset(null)} />}
      {accessOpen && (
        <AccessModal address={serverAddress}
          onClose={() => setAccessOpen(false)}
          onCopied={() => showToast('访问地址已复制')} />
      )}
      {confirm && (
        <div className="confirm-backdrop" onClick={() => setConfirm(null)}>
          <div className="confirm-box" role="alertdialog" aria-modal="true"
            aria-labelledby="confirm-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="confirm-title">确认删除</h3>
            <p>{confirm.message}</p>
            <div className="confirm-actions">
              <button type="button" className="btn subtle" onClick={() => setConfirm(null)}>取消</button>
              <button type="button" className="btn primary" onClick={() => {
                const action = confirm.action;
                setConfirm(null);
                action();
              }}>删除</button>
            </div>
          </div>
        </div>
      )}
      {toast && <div className="toast" role="status" aria-live="polite"><Icon name="check" size={14} />{toast}</div>}
    </div>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  );
}
