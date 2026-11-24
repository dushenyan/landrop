import { useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { api } from './api';
import { insertAtCursor } from './insertText';

export function useImageUpload(
  device: string,
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  setValue: (value: string) => void
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const onChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      const result = await api.uploadAsset(file, device);
      insertAtCursor(textareaRef.current, `![${result.name}](${result.url})`, setValue);
    } catch {
      setError('图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  return { inputRef, onChange, uploading, error };
}
