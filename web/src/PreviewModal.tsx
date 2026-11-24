import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { Asset } from './api';
import { api } from './api';
import { getDevice } from './device';
import Icon from './icons';
import { plainText, renderDocument } from './markdown';
import { useImageUpload } from './useImageUpload';
import { useScrollLock } from './useScrollLock';

interface Props {
  asset: Asset;
  onClose: () => void;
  onSaved?: (asset: Asset) => void;
}

interface SavedResult {
  versionId: number;
  size: number;
  mime: string;
  name: string;
  excerpt: string;
  kind?: Asset['kind'];
}

export default function PreviewModal({ asset, onClose, onSaved }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [textError, setTextError] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [showRendered, setShowRendered] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useScrollLock(true);

  const imageUpload = useImageUpload(getDevice().name, textareaRef, (value) => setDraft(value));

  const url = api.fileUrl(asset.current_version_id);
  const mime = (asset.mime || '').split(';')[0].trim().toLowerCase();
  const isText = asset.kind === 'text' || mime.startsWith('text/') || mime === 'application/json';
  const isImage = asset.kind === 'image' || mime.startsWith('image/');
  const isVideo = asset.kind === 'video' || mime.startsWith('video/');
  const isAudio = mime.startsWith('audio/');
  const isPdf = mime === 'application/pdf';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    closeRef.current?.focus();
  }, [onClose]);

  useEffect(() => {
    setEditing(false);
    setDraft(null);
    setShowRendered(false);
    setError('');
  }, [asset.current_version_id]);

  useEffect(() => {
    if (!isText) return;
    let cancelled = false;
    setText(null);
    setTextError(false);
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.text();
      })
      .then((value) => { if (!cancelled) setText(value); })
      .catch(() => { if (!cancelled) setTextError(true); });
    return () => { cancelled = true; };
  }, [url, isText]);

  const startEdit = async () => {
    setError('');
    if (isText) {
      setDraft(text ?? '');
      setEditing(true);
      return;
    }
    setPreparing(true);
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const file = new File([blob], asset.original_name, { type: asset.mime || 'application/octet-stream' });
      const ref = await api.uploadAsset(file, getDevice().name);
      setDraft(isImage ? `![${ref.name}](${ref.url})` : `[${ref.name}](${ref.url})`);
      setEditing(true);
    } catch {
      setError('准备文档失败，请重试');
    } finally {
      setPreparing(false);
    }
  };

  const applySaved = (res: SavedResult) => {
    onSaved?.({
      ...asset,
      current_version_id: res.versionId,
      size: res.size,
      mime: res.mime,
      original_name: res.name,
      excerpt: plainText(res.excerpt || ''),
      kind: res.kind ?? asset.kind,
    });
  };

  const saveDocument = async () => {
    if (draft === null) return;
    setSaving(true);
    setError('');
    try {
      const res = await api.saveText(asset.id, draft);
      setText(draft);
      setEditing(false);
      setShowRendered(false);
      applySaved(res);
    } catch {
      setError('保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const replaceFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setSaving(true);
    setError('');
    try {
      applySaved(await api.replaceFile(asset.id, file));
    } catch {
      setError('替换失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const downloadLink = (
    <a className="btn primary" href={url} target="_blank" rel="noopener noreferrer">
      <Icon name="download" size={13} />下载文件
    </a>
  );

  let content;
  if (isText) {
    content = textError ? (
      <div className="preview-fallback" role="alert">
        <Icon name="alert" size={22} />
        <p>文档加载失败</p>
        {downloadLink}
      </div>
    ) : text === null ? (
      <p className="preview-loading">加载中…</p>
    ) : (
      <div className="preview-doc doc-body" dangerouslySetInnerHTML={{ __html: renderDocument(text) }} />
    );
  } else if (isImage) {
    const imageMarkdown = `![${asset.original_name}](${url})`;
    content = (
      <div className="preview-doc doc-body" dangerouslySetInnerHTML={{ __html: renderDocument(imageMarkdown) }} />
    );
  } else if (isPdf) {
    content = <iframe className="preview-frame" src={url} title={asset.original_name} />;
  } else if (isVideo) {
    content = <video className="preview-media" controls src={url} />;
  } else if (isAudio) {
    content = <div className="preview-audio"><audio controls src={url} /></div>;
  } else {
    content = (
      <div className="preview-fallback">
        <Icon name="file" size={28} />
        <p>此格式暂不支持直接查看，可编辑为文档</p>
        {downloadLink}
      </div>
    );
  }

  const message = error || imageUpload.error;

  return (
    <div className="preview-backdrop" onClick={onClose}>
      <div className="preview-modal" role="dialog" aria-modal="true"
        aria-label={`查看 ${asset.original_name}`} data-color-mode="light"
        onClick={(e) => e.stopPropagation()}>
        <div className="preview-head">
          <div className="preview-title">
            <strong title={asset.original_name}>{asset.original_name}</strong>
            <span className="preview-by">来自 {asset.source_device}</span>
          </div>
          <div className="preview-actions">
            {!editing && (
              <button type="button" className="link-btn" onClick={startEdit} disabled={preparing || saving}>
                <Icon name="edit" size={12} />{preparing ? '准备中' : '编辑'}
              </button>
            )}
            {editing && (
              <>
                <button type="button" className="link-btn"
                  onClick={() => setShowRendered((value) => !value)}>
                  {showRendered ? '编辑' : '预览'}
                </button>
                <button type="button" className="link-btn" onClick={saveDocument}
                  disabled={saving || imageUpload.uploading}>保存</button>
                <button type="button" className="link-btn"
                  onClick={() => { setEditing(false); setDraft(null); setShowRendered(false); }}>取消</button>
              </>
            )}
            <button type="button" className="link-btn" disabled={saving}
              onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={12} />替换
            </button>
            <input ref={fileRef} className="visually-hidden" type="file" onChange={replaceFile} />
            <input ref={imageUpload.inputRef} className="visually-hidden" type="file"
              accept="image/*" onChange={imageUpload.onChange} />
            <button ref={closeRef} type="button" className="icon-btn" onClick={onClose}
              aria-label="关闭预览"><Icon name="close" size={15} /></button>
          </div>
        </div>
        {message && <p className="preview-error" role="alert">{message}</p>}
        {editing && !showRendered && (
          <div className="doc-toolbar">
            <button type="button" onClick={() => imageUpload.inputRef.current?.click()}
              disabled={imageUpload.uploading}>
              <Icon name="image" size={13} />{imageUpload.uploading ? '上传中' : '插入图片'}
            </button>
          </div>
        )}
        <div className="preview-body">
          {editing ? (
            showRendered ? (
              <div className="preview-doc doc-body"
                dangerouslySetInnerHTML={{ __html: renderDocument(draft ?? '') }} />
            ) : (
              <textarea ref={textareaRef} className="doc-editor" value={draft ?? ''}
                spellCheck={false} placeholder="写点什么…支持图片和 Markdown"
                onChange={(e) => setDraft(e.target.value)} />
            )
          ) : content}
        </div>
      </div>
    </div>
  );
}
