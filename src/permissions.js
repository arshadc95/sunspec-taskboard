export function isStaff(user) {
  return Boolean(user) && (user.role === 'superuser' || user.role === 'admin');
}

export function canEditUser(actor, target) {
  if (!actor || !target) return false;
  if (actor.role === 'superuser') return true;
  if (actor.role === 'admin') return target.role === 'user';
  return false;
}

function isAssignee(actor, task) {
  if (!actor || !task) return false;
  if (Array.isArray(task.assignee_ids) && task.assignee_ids.includes(actor.id)) return true;
  return task.assignee_id === actor.id;
}

export function canEditTask(actor, task) {
  if (!actor || !task) return false;
  if (actor.role === 'superuser' || actor.role === 'admin') return true;
  return task.created_by === actor.id || isAssignee(actor, task);
}

export function canRemoveTask(actor, task) {
  if (!actor || !task) return false;
  if (actor.role === 'superuser' || actor.role === 'admin') return true;
  return task.created_by === actor.id;
}

export function canCompleteTask(actor, task) {
  if (!actor || !task) return false;
  if (actor.role === 'superuser' || actor.role === 'admin') return true;
  return task.created_by === actor.id || isAssignee(actor, task);
}

export function canControlTimer(actor, task) {
  return isAssignee(actor, task);
}

export function canDeleteComment(actor, comment) {
  if (!actor || !comment) return false;
  if (actor.role === 'superuser') return true;
  return comment.author_id === actor.id;
}
