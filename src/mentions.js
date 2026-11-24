export function mentionedUserIds(body, users) {
  const found = new Set();
  const lower = String(body || '').toLowerCase();
  const sorted = [...users].sort((a, b) => String(b.name || '').length - String(a.name || '').length);
  for (const user of sorted) {
    const name = String(user.name || '').trim().toLowerCase();
    const email = String(user.email || '').trim().toLowerCase();
    if ((name && lower.includes(`@${name}`)) || (email && lower.includes(`@${email}`))) found.add(user.id);
  }
  return [...found];
}
