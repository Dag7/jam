import React from 'react';
import type { FileAttachment } from '@/store/chatSlice';
import { isImageAttachment } from '@/hooks/useFileAttachments';

interface AttachmentPreviewStripProps {
  attachments: FileAttachment[];
  onRemove: (id: string) => void;
}

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** Map file extension to a short label for the icon */
const getExtLabel = (name: string): string => {
  const ext = name.split('.').pop()?.toUpperCase() ?? '';
  return ext.length > 4 ? ext.slice(0, 4) : ext || 'FILE';
};

const RemoveButton: React.FC<{ name: string; onClick: () => void }> = ({ name, onClick }) => (
  <button
    onClick={onClick}
    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-zinc-700 border border-zinc-600 flex items-center justify-center opacity-0 group-hover/thumb:opacity-100 transition-opacity hover:bg-red-600 hover:border-red-500"
    title={`Remove ${name}`}
  >
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  </button>
);

const ImageThumbnail: React.FC<{ attachment: FileAttachment; onRemove: () => void }> = React.memo(
  ({ attachment, onRemove }) => (
    <div className="relative group/thumb shrink-0">
      <img
        src={attachment.dataUrl}
        alt={attachment.name}
        className="h-16 w-16 rounded-lg object-cover border border-zinc-600"
      />
      <RemoveButton name={attachment.name} onClick={onRemove} />
      <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-zinc-300 text-center rounded-b-lg truncate px-1">
        {formatSize(attachment.size)}
      </span>
    </div>
  ),
);
ImageThumbnail.displayName = 'ImageThumbnail';

const FileThumbnail: React.FC<{ attachment: FileAttachment; onRemove: () => void }> = React.memo(
  ({ attachment, onRemove }) => (
    <div className="relative group/thumb shrink-0">
      <div className="h-16 w-16 rounded-lg border border-zinc-600 bg-zinc-800 flex flex-col items-center justify-center gap-0.5">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="text-[9px] font-mono text-zinc-500 leading-none">{getExtLabel(attachment.name)}</span>
      </div>
      <RemoveButton name={attachment.name} onClick={onRemove} />
      <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] text-zinc-300 text-center rounded-b-lg truncate px-1">
        {formatSize(attachment.size)}
      </span>
    </div>
  ),
);
FileThumbnail.displayName = 'FileThumbnail';

export const AttachmentPreviewStrip: React.FC<AttachmentPreviewStripProps> = React.memo(
  ({ attachments, onRemove }) => {
    if (attachments.length === 0) return null;

    return (
      <div className="flex gap-2 px-1 pb-2 overflow-x-auto">
        {attachments.map((a) =>
          isImageAttachment(a)
            ? <ImageThumbnail key={a.id} attachment={a} onRemove={() => onRemove(a.id)} />
            : <FileThumbnail key={a.id} attachment={a} onRemove={() => onRemove(a.id)} />,
        )}
      </div>
    );
  },
);
AttachmentPreviewStrip.displayName = 'AttachmentPreviewStrip';
