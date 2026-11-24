export const STATUSES = [
  ['todo', 'To Do'],
  ['in_progress', 'In Progress'],
  ['review', 'Review'],
  ['done', 'Done'],
];

export const PRIORITIES = [
  ['low', 'Low'],
  ['med', 'Med'],
  ['high', 'High'],
  ['urgent', 'Urgent'],
];

export const ROLES = [
  ['superuser', 'Superuser'],
  ['admin', 'Admin'],
  ['user', 'User'],
];

export function labelOf(list, key) {
  const found = list.find(([value]) => value === key);
  return found ? found[1] : '';
}
