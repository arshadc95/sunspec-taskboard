const TIPS = [
  'Cap what is in progress. Two or three live jobs beats a long in-progress list.',
  'A due date is a promise to the week. Set it on purpose, or leave it blank on purpose.',
  'Once a week, look at what has gone quiet. Old in-progress work is where things stall.',
  'Finish before you start. More tasks in progress means a longer wait for each one.',
  'If review is piling up, pause new starts until a couple clear.',
  'Unassigned work is easy to forget. Put a name on it.',
  'A ten-minute check-in beats another status meeting.',
  'On time depends on the date you set, so set one you can actually hit.',
  'Look at how long jobs take, not only how many got done.',
  'If one person is holding most of the open work, the whole board slows down.',
  'If a task has not moved in a week, ask what is blocking it.',
  'A short Monday look at overdue items saves a messy Friday.',
  'Do not start a new task for someone already sitting on a pile.',
  'The slow tasks matter more than the average. That is the one that hurts.',
  'Clear review before you pull more into progress.',
  'The same person on too many tasks is switching around, not getting faster.',
  'Write the next step on the task so a check-in is easy.',
  'Compare this period with the last one before you change the plan.',
  'If someone has room, offer them a task before the others get buried.',
  'Name the safe state. If the PLC stops, the plant should fail quietly, not wildly.',
];

export function managerTip(now = new Date(), { review = false } = {}) {
  const pool = review ? TIPS : TIPS.filter((line) => !/review/i.test(line));
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const day = Math.floor((now.getTime() - start) / 86400000);
  return pool[((day % pool.length) + pool.length) % pool.length];
}

function tip(id, text, href, tone = 'note') {
  return { id, text, href, tone };
}

export function coachTips(facts) {
  const issues = [];
  const positives = [];
  const people = facts.people || [];
  const open = facts.open || 0;
  const enoughHistory = (facts.historyDays || 0) >= 14;
  const doneSample = (facts.donePeriod || 0) + (facts.donePrevious || 0);

  const overloaded = people.filter((person) => person.overdue >= 2).sort((a, b) => b.overdue - a.overdue)[0];
  const spare = people.filter((person) => !overloaded || person.id !== overloaded.id).sort((a, b) => a.open - b.open)[0];
  if (overloaded && spare && spare.open < overloaded.open) {
    issues.push(tip(
      'rebalance',
      `${overloaded.name} has ${overloaded.overdue} overdue. ${spare.name} has some room if a couple need a home.`,
      `/?assignee=${overloaded.id}&overdue=1`,
    ));
  }

  const busiest = [...people].sort((a, b) => b.open - a.open)[0];
  if (busiest && open >= 4 && busiest.open / open > 0.5) {
    issues.push(tip(
      'balance',
      `Most of the open work is with ${busiest.name}. Worth seeing who else has space.`,
      `/?assignee=${busiest.id}`,
    ));
  }

  if ((facts.reviewStuck || 0) >= 2) {
    issues.push(tip(
      'review',
      `Review is getting a bit full. ${facts.reviewStuck} tasks have sat there more than 3 days. Clear a couple before starting new stuff.`,
      '/?status=review',
    ));
  }

  const stale = [...(facts.staleProgress || [])].sort((a, b) => b.days - a.days)[0];
  if (stale) {
    issues.push(tip(
      'checkin',
      `Check in with ${stale.owner} on ${stale.title}. No update in ${stale.days} days.`,
      `/tasks/${stale.id}`,
    ));
  }

  const wip = people.filter((person) => person.inProgress > 5).sort((a, b) => b.inProgress - a.inProgress)[0];
  if (wip) {
    issues.push(tip(
      'wip',
      `${wip.name} has ${wip.inProgress} in progress. Finishing a couple before starting more usually keeps things moving.`,
      `/?status=in_progress&assignee=${wip.id}`,
    ));
  }

  if ((facts.unassignedNew || 0) >= 1) {
    issues.push(tip(
      'unassigned',
      `${facts.unassignedNew} new task${facts.unassignedNew === 1 ? '' : 's'} still need a name on them.`,
      '/?assignee=none',
    ));
  } else if ((facts.unassigned || 0) >= 2) {
    issues.push(tip(
      'unassigned',
      `${facts.unassigned} open tasks are not assigned yet.`,
      '/?assignee=none',
    ));
  }

  if ((facts.noDue || 0) >= 3) {
    issues.push(tip(
      'nodue',
      `${facts.noDue} open tasks have no due date. A date on the ones that matter this week helps.`,
      '/?nodue=1',
    ));
  }

  if (enoughHistory && doneSample >= 5 && (facts.overdueNow || 0) > (facts.overdueStart || 0)) {
    issues.push(tip(
      'overdue-trend',
      'Overdue items are up on the previous stretch. A short look at what is blocking them should help.',
      '/?overdue=1',
    ));
  }

  if (enoughHistory && doneSample >= 5 && (facts.donePeriod || 0) < (facts.donePrevious || 0)) {
    issues.push(tip(
      'throughput',
      'Fewer tasks got finished than the period before. See what is in progress before pulling more in.',
      '/?status=in_progress',
    ));
  }

  if ((facts.onTimeWeek || 0) >= 3) {
    positives.push(tip(
      'ontime',
      `Nice, ${facts.onTimeWeek} tasks closed on time this week.`,
      '/?status=done',
      'good',
    ));
  }
  if (facts.topFinisher && facts.topFinisher.done >= 3) {
    positives.push(tip(
      'finisher',
      `${facts.topFinisher.name} closed ${facts.topFinisher.done} this week. Solid stretch.`,
      '/?status=done',
      'good',
    ));
  }

  const picked = issues.slice(0, positives.length ? 5 : 6);
  if (positives.length) picked.push(positives[0]);
  return picked.slice(0, 6);
}
