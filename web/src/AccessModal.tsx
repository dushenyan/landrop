import { useEffect, useRef, useState } from 'react';
import { api } from './api';
import Icon from './icons';
import { useScrollLock } from './useScrollLock';

interface Props {
  address: string;
  onClose: () => void;
  onCopied: () => void;
}

export default function AccessModal({ address, onClose, onCopied }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [qrSrc, setQrSrc] = useState(api.accessQrcode());
  const [qrFailed, setQrFailed] = useState(false);
  useScrollLock(true);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copy = async () => {
      onCopied();
  };

  return (
    <div className="access-backdrop" onClick={onClose}>
      <div className="access-modal" role="dialog" aria-modal="true"
        aria-labelledby="access-title" onClick={(e) => e.stopPropagation()}>
        <div className="access-head">
          <h3 id="access-title">扫码访问 LanDrop</h3>
          <button ref={closeRef} type="button" className="icon-btn" onClick={onClose}
            aria-label="关闭扫码访问"><Icon name="close" size={15} /></button>
        </div>
        {qrFailed ? (
          <div className="access-qr-fallback" role="alert">
            <Icon name="alert" size={18} />
            <span>二维码加载失败，可直接复制下方地址</span>
            <button type="button" className="btn subtle"
              onClick={() => { setQrFailed(false); setQrSrc(`${api.accessQrcode()}?retry=${Date.now()}`); }}>
              重试
            </button>
          </div>
        ) : (
          <img className="access-qr" src={qrSrc} alt="LanDrop 局域网访问二维码"
            width="240" height="240" onError={() => setQrFailed(true)} />
        )}
        <a className="access-address" href={address}>{address}</a>
        <p className="access-hint">手机与电脑在同一 Wi-Fi，用相机扫码即可打开</p>
        <div className="access-actions">
          <button type="button" className="btn primary" onClick={copy}>
            <Icon name="copy" size={13} />复制地址
          </button>
        </div>
      </div>
    </div>
  );
}
