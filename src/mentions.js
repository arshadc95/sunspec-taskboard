const TOKEN = /@\[[^\]]*]\((\d+)\)/g;

export function mentionIdsFromText(body, users = []) {
  const text = String(body || '');
  const ids = new Set();
  for (const match of text.matchAll(TOKEN)) ids.add(Number(match[1]));
  const stripped = text.replace(TOKEN, ' ');
  const lower = stripped.toLowerCase();
  const sorted = [...users].sort((a, b) => String(b.name || '').length - String(a.name || '').length);
  for (const user of sorted) {
    const name = String(user.name || '').trim().toLowerCase();
    const email = String(user.email || '').trim().toLowerCase();
    if ((name && lower.includes(`@${name}`)) || (email && lower.includes(`@${email}`))) ids.add(user.id);
  }
  return [...ids];
}

export function mentionedUserIds(body, users) {
  return mentionIdsFromText(body, users);
}
