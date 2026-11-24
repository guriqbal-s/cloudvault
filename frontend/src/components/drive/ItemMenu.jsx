import { Download, Eye, FolderInput, FolderOpen, History, MoreVertical, Pencil, Share2, Star, StarOff, Trash2 } from 'lucide-react';
import Button from '../ui/Button.jsx';
import Menu, { MenuItem, MenuSeparator } from '../ui/Dropdown.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import { caps, isOwner } from './driveUtils.js';

/**
 * Menu entries for one file/folder, gated on `item.access.capabilities` (never on roles).
 * `act(action, item)` comes from useDriveActions.
 */
export function ItemMenuItems({ item, act }) {
  const { user } = useAuth();
  const c = caps(item);
  const file = item.kind === 'file';
  const owner = isOwner(item, user);
  return (
    <>
      <MenuItem icon={file ? <Eye /> : <FolderOpen />} onClick={() => act('open', item)}>{file ? 'Preview' : 'Open'}</MenuItem>
      {file && c.download && <MenuItem icon={<Download />} onClick={() => act('download', item)}>Download</MenuItem>}
      <MenuSeparator />
      {c.share && <MenuItem icon={<Share2 />} onClick={() => act('share', item)}>Share</MenuItem>}
      <MenuItem icon={item.starred ? <StarOff /> : <Star />} onClick={() => act('star', item)}>{item.starred ? 'Remove from starred' : 'Add to starred'}</MenuItem>
      {file && c.read && <MenuItem icon={<History />} onClick={() => act('versions', item)}>Version history</MenuItem>}
      {c.update && <MenuItem icon={<Pencil />} onClick={() => act('rename', item)}>Rename</MenuItem>}
      {c.update && owner && <MenuItem icon={<FolderInput />} onClick={() => act('move', item)}>Move to…</MenuItem>}
      {c.delete && (
        <>
          <MenuSeparator />
          <MenuItem danger icon={<Trash2 />} onClick={() => act('delete', item)}>Move to trash</MenuItem>
        </>
      )}
    </>
  );
}

/** Kebab button + dropdown. */
export default function ItemMenu({ item, act }) {
  return (
    <Menu trigger={<Button icon variant="ghost" size="sm" aria-label={`Actions for ${item.name}`}><MoreVertical className="h-4 w-4" /></Button>} align="end">
      <ItemMenuItems item={item} act={act} />
    </Menu>
  );
}
