export function isStaff(user) {
  return Boolean(user) && (user.role === 'superuser' || user.role === 'admin');
}

export function canEditUser(actor, target) {
  if (!actor || !target) return false;
  if (actor.role === 'superuser') return true;
  if (actor.role === 'admin') return target.role === 'user';
  return false;
}

export function canEditTask(actor, task) {
  if (!actor || !task) return false;
  if (actor.role === 'superuser' || actor.role === 'admin') return true;
  return task.created_by === actor.id || task.assignee_id === actor.id;
}

export function canRemoveTask(actor, task) {
  if (!actor || !task) return false;
  if (actor.role === 'superuser' || actor.role === 'admin') return true;
  return task.created_by === actor.id;
}

export function canCompleteTask(actor, task) {
  if (!actor || !task) return false;
  if (actor.role === 'superuser' || actor.role === 'admin') return true;
  return task.created_by === actor.id || task.assignee_id === actor.id;
}

export function canControlTimer(actor, task) {
  return Boolean(actor && task && task.assignee_id === actor.id);
}

export function canDeleteComment(actor, comment) {
  if (!actor || !comment) return false;
  if (actor.role === 'superuser') return true;
  return comment.author_id === actor.id;
}
