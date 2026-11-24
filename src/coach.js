function firstName(name) {
  const word = String(name || '').trim().split(/\s+/)[0];
  return word || 'Someone';
}

function joinLabels(labels) {
  if (labels.length <= 1) return labels[0] || 'Someone';
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

function joinNames(people) {
  const names = [...people]
    .sort((a, b) => firstName(a.name).localeCompare(firstName(b.name)) || String(a.name).localeCompare(String(b.name)))
    .map((person) => firstName(person.name));
  return joinLabels(names);
}

function tip(id, rank, text, href) {
  return { id, rank, text, href };
}

function countLine(count, singular, plural) {
  return count === 1 ? `1 task ${singular}` : `${count} tasks ${plural}`;
}

function namedStaff(people) {
  return (people || []).filter((person) => person.role === 'user' || person.role === 'admin');
}

export function coachTips(facts = {}) {
  const people = namedStaff(facts.people);
  const open = Number.isFinite(facts.open) ? facts.open : people.reduce((sum, person) => sum + (person.open || 0), 0);
  const tips = [];

  const busiest = people.reduce((max, person) => Math.max(max, person.open || 0), 0);
  const heavy = people.filter((person) => (person.open || 0) === busiest && busiest >= 3);
  const spare = people.filter((person) => (person.open || 0) === 0);
  if (heavy.length && spare.length && people.length >= 2) {
    const heavyText = heavy.length === 1
      ? `${firstName(heavy[0].name)} has ${busiest} open`
      : `${joinNames(heavy)} have ${busiest} open`;
    const spareText = spare.length === 1
      ? `${firstName(spare[0].name)} has 0`
      : `${joinNames(spare)} have 0`;
    const shift = spare.length === 1
      ? `Consider shifting some work to ${firstName(spare[0].name)}.`
      : 'Consider shifting some work to them.';
    tips.push(tip('balance', 1, `${heavyText}, ${spareText}. ${shift}`, `/?assignee=${heavy[0].id}`));
  }

  const unassigned = facts.unassigned || 0;
  if (unassigned > 0) {
    tips.push(tip(
      'unassigned',
      2,
      unassigned === 1 ? '1 task has no owner. Assign it.' : `${unassigned} tasks have no owner. Assign them.`,
      '/?assignee=none',
    ));
  }

  const late = people.filter((person) => (person.overdue || 0) > 0)
    .sort((a, b) => b.overdue - a.overdue || firstName(a.name).localeCompare(firstName(b.name)));
  if (late.length) {
    tips.push(tip(
      'overdue',
      3,
      `${late.map((person) => `${firstName(person.name)} has ${person.overdue} overdue`).join(', ')}.`,
      '/?overdue=1',
    ));
  }

  const dueSoon = facts.dueSoon || 0;
  if (dueSoon > 0) {
    tips.push(tip(
      'due-soon',
      4,
      countLine(dueSoon, 'is due in the next 3 days and has not been started.', 'are due in the next 3 days and have not been started.'),
      '/?status=todo',
    ));
  }

  const stale = facts.stale || 0;
  if (stale > 0) {
    tips.push(tip(
      'stale',
      5,
      countLine(stale, 'has been in progress for more than 7 days with no update.', 'have been in progress for more than 7 days with no update.'),
      '/?status=in_progress',
    ));
  }

  const waiting = facts.reviewWaiting || 0;
  if (facts.reviewUsed && waiting > 0) {
    tips.push(tip(
      'review',
      6,
      countLine(waiting, 'has been in review for more than 2 days.', 'have been in review for more than 2 days.'),
      '/?status=review',
    ));
  }

  const noDue = facts.noDue || 0;
  if (noDue > 0) {
    tips.push(tip(
      'nodue',
      7,
      countLine(noDue, 'has no due date.', 'have no due date.'),
      '/?nodue=1',
    ));
  }

  if (spare.length && open > 0) {
    tips.push(tip(
      'idle',
      8,
      spare.length === 1
        ? `${firstName(spare[0].name)} has nothing open, give them work.`
        : `${joinNames(spare)} have nothing open, give them work.`,
      '/',
    ));
  }

  const quietProjects = (facts.projects || [])
    .filter((project) => (project.open || 0) >= 4 && !project.assignedRecently)
    .sort((a, b) => b.open - a.open || String(a.name).localeCompare(String(b.name)));
  if (quietProjects.length === 1) {
    const project = quietProjects[0];
    tips.push(tip(
      'project',
      9,
      `${project.name} has ${project.open} open tasks and nobody has been assigned there this month.`,
      project.id ? `/?project=${project.id}` : '/',
    ));
  } else if (quietProjects.length > 1) {
    tips.push(tip(
      'project',
      9,
      `${joinLabels(quietProjects.map((project) => project.name))} have many open tasks and nobody has been assigned to them this month.`,
      quietProjects[0].id ? `/?project=${quietProjects[0].id}` : '/',
    ));
  }

  return tips.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)).slice(0, 6);
}
