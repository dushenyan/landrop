import { useCallback, useEffect, useRef, useState } from 'react';
import Uppy from '@uppy/core';
import Tus from '@uppy/tus';
import Icon from './icons';
import type { LocalDevice } from './device';
import { plainText, renderDocument } from './markdown';
import { useImageUpload } from './useImageUpload';

interface Props {
  device: LocalDevice;
  recipients: string;
  maxFileSize: number;
  onComplete: () => void;
}

type UploadStatus = 'uploading' | 'done' | 'error';

interface UploadItem {
  id: string;
  name: string;
  percent: number;
  status: UploadStatus;
  message?: string;
  summary?: string;
}

export default function Uploader({ device, recipients, maxFileSize, onComplete }: Props) {
  const uppyRef = useRef<Uppy | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const deviceRef = useRef(device);
  deviceRef.current = device;
  const recipientsRef = useRef(recipients);
  recipientsRef.current = recipients;
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const doneTimers = useRef<number[]>([]);

  const [items, setItems] = useState<UploadItem[]>([]);
  const [text, setText] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);

  const imageUpload = useImageUpload(device.name, textareaRef, setText);

  const patch = useCallback((id: string, change: Partial<UploadItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...change } : item)));
  }, []);

  useEffect(() => {
    const uppy = new Uppy({ autoProceed: true, restrictions: { maxFileSize } });
    uppy.use(Tus, {
      endpoint: '/uploads',
      retryDelays: [0, 1000, 3000, 5000],
      chunkSize: 6 * 1024 * 1024,
    });

    uppy.on('file-added', (file) => {
      file.meta = {
        ...file.meta,
        device: deviceRef.current.name,
        deviceId: deviceRef.current.id,
        recipients: recipientsRef.current,
        mime: file.type || 'application/octet-stream',
      };
      setItems((prev) => [
        ...prev.filter((item) => item.status !== 'done'),
        {
          id: file.id,
          name: file.name ?? '未命名文件',
          percent: 0,
          status: 'uploading' as const,
          summary: String(file.meta.summary || '') || undefined,
        },
      ].slice(-6));
      setError('');
    });

    uppy.on('upload-progress', (file, progress) => {
      if (file) patch(file.id, { percent: Math.round(progress.percentage ?? 0) });
    });
    uppy.on('upload-success', (file) => {
      if (!file) return;
      patch(file.id, { percent: 100, status: 'done' });
      const timer = window.setTimeout(() => {
        setItems((prev) => prev.filter((item) => item.id !== file.id));
      }, 1200);
      doneTimers.current.push(timer);
    });
    uppy.on('upload-error', (file, err) => {
      if (file) patch(file.id, { status: 'error', message: err.message });
      setError(err.message);
    });
    uppy.on('restriction-failed', (_file, err) => setError(err.message));
    uppy.on('complete', (result) => {
      if (result.successful && result.successful.length > 0) onCompleteRef.current();
    });

    uppyRef.current = uppy;
    return () => {
      doneTimers.current.forEach((timer) => window.clearTimeout(timer));
      doneTimers.current = [];
      uppy.destroy();
      uppyRef.current = null;
    };
  }, [maxFileSize, patch]);

  const meta = useCallback(() => ({
    device: deviceRef.current.name,
    deviceId: deviceRef.current.id,
    recipients: recipientsRef.current,
  }), []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const uppy = uppyRef.current;
    if (!uppy || files.length === 0) return;
    uppy.addFiles(Array.from(files).map((file) => ({
      name: file.name,
      type: file.type || 'application/octet-stream',
      data: file,
      meta: { ...meta(), mime: file.type || 'application/octet-stream' },
    })));
  }, [meta]);

  useEffect(() => {
    const uppy = uppyRef.current;
    if (!uppy) return;
    const sync = () => {
      for (const file of uppy.getFiles()) {
        file.meta.device = deviceRef.current.name;
        file.meta.deviceId = deviceRef.current.id;
        file.meta.recipients = recipientsRef.current;
      }
    };
    uppy.on('upload', sync);
    return () => { uppy.off('upload', sync); };
  }, [maxFileSize]);

  const sendDocument = () => {
    const content = text.trim();
    if (!content || !uppyRef.current) return;
    const summary = plainText(content).slice(0, 120);
    const title = (summary.split('\n')[0] || '文档').replace(/[\\/:*?"<>|]/g, '').slice(0, 40) || '文档';
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    uppyRef.current.addFile({
      name: `文档-${title}-${stamp}.md`,
      type: 'text/markdown',
      data: new Blob([content], { type: 'text/markdown;charset=utf-8' }),
      meta: { ...meta(), mime: 'text/markdown', summary },
    });
    setText('');
    setShowPreview(false);
  };

  const retry = (id: string) => {
    patch(id, { status: 'uploading', percent: 0, message: undefined });
    setError('');
    uppyRef.current?.retryUpload(id);
  };

  const message = error || imageUpload.error;

  return (
    <div className="uploader">
      <div className="composer">
        <button type="button"
          className={`composer-drop${dragging ? ' dragging' : ''}`}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}>
          <Icon name="upload" size={15} />
          <span>拖入文件，或从设备选择</span>
        </button>
        <input ref={fileRef} className="visually-hidden" type="file" multiple
          aria-label="选择要发送的文件"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files);
            e.target.value = '';
          }} />

        <div className="composer-body">
          {showPreview ? (
            <div className="composer-preview doc-body"
              dangerouslySetInnerHTML={{ __html: renderDocument(text || '空白文档') }} />
          ) : (
            <textarea ref={textareaRef} className="composer-input" value={text}
              placeholder="写点什么…可插入图片，作为一份文档发送"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) sendDocument();
              }} />
          )}
          <div className="composer-tools">
            <button type="button" onClick={() => imageUpload.inputRef.current?.click()}
              disabled={imageUpload.uploading}>
              <Icon name="image" size={13} />{imageUpload.uploading ? '上传中' : '插入图片'}
            </button>
            <input ref={imageUpload.inputRef} className="visually-hidden" type="file"
              accept="image/*" onChange={imageUpload.onChange} />
            <button type="button" onClick={() => setShowPreview((value) => !value)}>
              {showPreview ? '继续编辑' : '预览文档'}
            </button>
            <span className="composer-hint">⌘/Ctrl+Enter 发送</span>
          </div>
        </div>
        <button type="button" className="btn primary composer-send" onClick={sendDocument}
          disabled={!text.trim() || imageUpload.uploading}>发送</button>
      </div>

      {message && (
        <p className="inline-error" role="alert">
          <Icon name="alert" size={13} /> {message}
        </p>
      )}

      {items.length > 0 && (
        <ul className="upload-list" aria-label="上传进度">
          {items.map((item) => (
            <li className={`upload-item ${item.status}`} key={item.id}>
              <span className="upload-name" title={item.name}>
                {item.name}
                {item.summary && <span className="upload-summary">{item.summary}</span>}
              </span>
              <span className="upload-track">
                <span className="upload-fill" style={{ width: `${item.percent}%` }} />
              </span>
              <span className="upload-percent">
                {item.status === 'done' ? <Icon name="check" size={14} /> : `${item.percent}%`}
              </span>
              {item.status === 'error' && (
                <button type="button" className="icon-action" onClick={() => retry(item.id)}
                  aria-label={`重试 ${item.name}`} title={item.message ?? '重试'}>
                  <Icon name="retry" size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
