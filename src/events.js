const clients = new Set();

export function publish(event) {
  const packet = `event: ${event.type}\ndata: ${JSON.stringify(event.data || {})}\n\n`;
  for (const client of clients) {
    if (event.userIds && !event.userIds.includes(client.userId)) continue;
    try {
      client.res.write(packet);
    } catch {
      clients.delete(client);
    }
  }
}

export function boardChanged({ actor, summary, taskId }) {
  publish({
    type: 'board:changed',
    data: { actor: actor || '', summary: summary || 'Board updated', taskId: taskId || null },
  });
}

export function notifyUser(userId, data) {
  if (!userId) return;
  publish({ type: 'notify', userIds: [userId], data });
}

export function grokMessage(userId, threadId) {
  if (!userId) return;
  publish({ type: 'grok:message', userIds: [userId], data: { threadId } });
}

export function subscribe(userId, res) {
  const client = { userId, res };
  clients.add(client);
  return () => clients.delete(client);
}

export function closeAll() {
  for (const client of clients) {
    try { client.res.end(); } catch { /* already closed */ }
  }
  clients.clear();
}
