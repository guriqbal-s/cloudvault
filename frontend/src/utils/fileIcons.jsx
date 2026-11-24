import {
  File, FileText, FileSpreadsheet, FileImage, FileVideo, FileArchive, FileType2, Presentation, Folder, FolderOpen,
} from 'lucide-react';
import { cn } from './cn.js';

// category (from the API's file DTO) -> icon + tone classes (text + soft background)
const CATEGORY = {
  image: { Icon: FileImage, tone: 'text-info bg-info-soft', label: 'Image' },
  pdf: { Icon: FileType2, tone: 'text-danger bg-danger-soft', label: 'PDF' },
  document: { Icon: FileText, tone: 'text-info bg-info-soft', label: 'Document' },
  spreadsheet: { Icon: FileSpreadsheet, tone: 'text-success bg-success-soft', label: 'Spreadsheet' },
  presentation: { Icon: Presentation, tone: 'text-warning bg-warning-soft', label: 'Presentation' },
  video: { Icon: FileVideo, tone: 'text-brand bg-brand-soft', label: 'Video' },
  archive: { Icon: FileArchive, tone: 'text-accent bg-accent-soft', label: 'Archive' },
  text: { Icon: FileText, tone: 'text-content-muted bg-surface-sunken', label: 'Text' },
  other: { Icon: File, tone: 'text-content-muted bg-surface-sunken', label: 'File' },
};
const FOLDER = { Icon: Folder, tone: 'text-brand bg-brand-soft', label: 'Folder' };

/** @param {{kind?: string, category?: string}|string} item a file/folder DTO or a category name */
export function getFileVisual(item) {
  if (item === 'folder' || item?.kind === 'folder') return FOLDER;
  const category = typeof item === 'string' ? item : item?.category;
  return CATEGORY[category] ?? CATEGORY.other;
}

/** Rounded icon tile for a file, folder or category. size: sm | md | lg */
export function FileIcon({ item, size = 'md', className }) {
  const { Icon, tone } = getFileVisual(item);
  const box = { sm: 'h-8 w-8 rounded-lg', md: 'h-10 w-10 rounded-xl', lg: 'h-14 w-14 rounded-2xl' }[size] ?? 'h-10 w-10 rounded-xl';
  const icon = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-7 w-7' }[size] ?? 'h-5 w-5';
  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center', box, tone, className)} aria-hidden="true">
      <Icon className={icon} strokeWidth={1.8} />
    </span>
  );
}

export { FolderOpen };
