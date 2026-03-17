import { useState, useCallback, useRef } from 'react';
import type { FileAttachment } from '@/store/chatSlice';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB
const MAX_ATTACHMENTS = 10;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);

export function isImageAttachment(attachment: FileAttachment): boolean {
  return IMAGE_TYPES.has(attachment.mimeType);
}

/** Strategy interface for reading files into FileAttachment objects */
interface AttachmentReader {
  read(file: File): Promise<FileAttachment | null>;
}

/** Default reader — converts any File to a base64 data URL */
const dataUrlReader: AttachmentReader = {
  async read(file: File): Promise<FileAttachment | null> {
    if (file.size > MAX_FILE_SIZE) return null;

    return new Promise((resolve) => {
      const reader = new globalThis.FileReader();
      reader.onload = () => {
        resolve({
          id: crypto.randomUUID(),
          name: file.name,
          dataUrl: reader.result as string,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
        });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });
  },
};

function extractFiles(dataTransfer: DataTransfer): File[] {
  const files: File[] = [];
  for (let i = 0; i < dataTransfer.files.length; i++) {
    files.push(dataTransfer.files[i]);
  }
  return files;
}

export function useFileAttachments(reader: AttachmentReader = dataUrlReader) {
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = useCallback(async (files: File[]) => {
    const results = await Promise.all(files.map((f) => reader.read(f)));
    const valid = results.filter((r): r is FileAttachment => r !== null);
    if (valid.length === 0) return;

    setAttachments((prev) => {
      const remaining = MAX_ATTACHMENTS - prev.length;
      return remaining > 0 ? [...prev, ...valid.slice(0, remaining)] : prev;
    });
  }, [reader]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const clearAttachments = useCallback(() => {
    setAttachments([]);
  }, []);

  const openFilePicker = useCallback(() => {
    if (!fileInputRef.current) {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.style.display = 'none';
      input.addEventListener('change', () => {
        if (input.files && input.files.length > 0) {
          const files: File[] = [];
          for (let i = 0; i < input.files.length; i++) files.push(input.files[i]);
          addFiles(files);
        }
        input.value = '';
      });
      document.body.appendChild(input);
      fileInputRef.current = input;
    }
    fileInputRef.current.click();
  }, [addFiles]);

  // --- Drag event handlers ---

  const onDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true);
    }
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);
    const files = extractFiles(e.dataTransfer);
    if (files.length > 0) addFiles(files);
  }, [addFiles]);

  // --- Paste handler (images only — text paste is preserved) ---

  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const files = extractFiles(e.clipboardData);
    if (files.length > 0) {
      e.preventDefault();
      addFiles(files);
    }
  }, [addFiles]);

  return {
    attachments,
    isDragging,
    addFiles,
    removeAttachment,
    clearAttachments,
    openFilePicker,
    dragHandlers: { onDragEnter, onDragOver, onDragLeave, onDrop },
    onPaste,
  };
}
