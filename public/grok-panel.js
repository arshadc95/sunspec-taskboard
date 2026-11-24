export function applyGrokClick(open, kind, inside) {
  if (kind === 'bubble') return !open;
  if (kind === 'close') return false;
  if (kind === 'outside') return inside ? open : false;
  return open;
}

export const GROK_PDF_LIMIT = 5;
export const GROK_PDF_MAX_BYTES = 15 * 1024 * 1024;

export function acceptGrokFiles(existing, incoming) {
  const files = existing.slice();
  let error = '';
  for (const file of incoming) {
    const name = String(file?.name || '');
    const type = String(file?.type || '').toLowerCase();
    const pdf = type === 'application/pdf' || name.toLowerCase().endsWith('.pdf');
    if (!pdf) {
      error = 'Only PDF files can be attached.';
      continue;
    }
    if (Number(file.size) > GROK_PDF_MAX_BYTES) {
      error = 'Each PDF must be 15 MB or smaller.';
      continue;
    }
    if (files.length >= GROK_PDF_LIMIT) {
      error = 'Only five PDFs at a time.';
      break;
    }
    files.push(file);
  }
  return { files, error };
}

export function grokShouldQueue({ sending = false, pending = false, queued = 0 } = {}) {
  return Boolean(sending || pending || queued > 0);
}

export function grokFileView(file) {
  const name = String(file?.filename || '').trim() || 'file.pdf';
  const size = Number(file?.size) || 0;
  const sizeLabel = size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${Math.max(1, Math.round(size / 1024))} KB`
      : `${(size / (1024 * 1024)).toFixed(1)} MB`;
  const id = file?.id;
  return {
    name,
    sizeLabel,
    expiry: file?.expired ? 'expired' : (file?.expires_label || ''),
    openUrl: id ? `/files/${id}?inline=1` : '',
    downloadUrl: id ? `/files/${id}` : '',
  };
}

export function toggleGrokLayout(mode) {
  return mode === 'full' ? 'panel' : 'full';
}

export function grokPreview(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

export function grokThreadVisible(thread, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  const title = String(thread?.title || 'New chat').toLowerCase();
  const preview = String(thread?.preview || '').toLowerCase();
  return title.includes(q) || preview.includes(q);
}

export function grokQueuedLabel(item) {
  const names = (item?.files || []).map((file) => file.name).filter(Boolean).join(', ');
  const body = [String(item?.text || '').trim(), names].filter(Boolean).join(' · ');
  return `${body} · queued`;
}
