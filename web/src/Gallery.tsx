import type { Asset } from './api';
import { plainText } from './markdown';
import Icon from './icons';

interface Props {
  assets: Asset[];
  trash?: boolean;
  onPreview?: (asset: Asset) => void;
  onRename?: (id: string, name: string) => void;
  onDelete?: (id: string) => void;
  onRestore?: (id: string) => void;
}


function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function fmtTime(s: string): string {
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function Gallery({ assets, trash, onPreview, onRename, onDelete, onRestore }: Props) {
  return (
    <>
      {assets.length === 0 ? (
        <div className="empty">
          <Icon name="mark" size={28} />
          <p>还没有文件</p>
          <span>上传第一个文件，它就会出现在这里</span>
        </div>
      ) : (
        <div className="grid">
          {assets.map((a) => {
            return (
              <div className="card" key={a.id}
                role="button" tabIndex={0}
                aria-label={`预览 ${a.original_name}`}
                onClick={() => onPreview?.(a)}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onPreview?.(a);
                  }
                }}>
                <div className="card-body">
                  <div className="card-icon"><Icon name="text" size={17} /></div>
                  <div className="card-name" title={a.original_name}>{a.original_name}</div>
                  <p className="card-excerpt" title={a.excerpt || a.mime}>
                    {a.excerpt ? plainText(a.excerpt) : `文档 · ${a.mime}`}
                  </p>
                  <div className="card-meta">
                    <span className="tag">文档</span>
                    <span>{fmtSize(a.size)}</span>
                    <span className="dim">·</span>
                    <span>{a.source_device}</span>
                    <span className="dim">·</span>
                    <span title={new Date(a.uploaded_at).toLocaleString()}>{fmtTime(a.uploaded_at)}</span>
                  </div>
                  <div className="card-actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="link-btn" onClick={() => onPreview?.(a)}>
                      <Icon name="text" size={12} />查看
                    </button>
                    {!trash && onRename && (
                      <button type="button" className="link-btn" onClick={() => onRename(a.id, a.original_name)}>
                        <Icon name="edit" size={12} />重命名
                      </button>
                    )}
                    {trash ? (
                      <button type="button" className="link-btn" onClick={() => onRestore?.(a.id)}>
                        <Icon name="restore" size={12} />恢复
                      </button>
                    ) : onDelete && (
                      <button type="button" className="icon-action" onClick={() => onDelete(a.id)}
                        aria-label={`删除 ${a.original_name}`} title="删除到回收站">
                        <Icon name="trash" size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
