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

export function grokQueuedLabel(item) {
  const names = (item?.files || []).map((file) => file.name).filter(Boolean).join(', ');
  const body = [String(item?.text || '').trim(), names].filter(Boolean).join(' · ');
  return `${body} · queued`;
}
