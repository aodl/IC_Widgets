import { liveError, result } from './client.js';
import { dashboardLink } from './dashboard.js';
import { interactionChecks, nextActivityAttempt } from './review-checks.js';
import { action, el, option, styled, time } from './view.js';

const decisions = { 1: 'Undecided', 2: 'Rejected', 3: 'Adopted', 4: 'Adopted', 5: 'Adopted' };
const actions = { 2: 'Add nodes', 13: 'Remove nodes', 31: 'Change subnet membership' };
const supported = row => Object.hasOwn(actions, option(row.function));
const subnetAction = row => supported(row) || option(row.function) === 6 || (row.topic === 7 && option(row.function) === undefined);
const ids = row => (option(row.targets) ?? []).map(id => id.toText());

export function activityRows(payload, filter) {
  const proposals = payload.proposals.filter(subnetAction).filter(row => filter === 'all'
    || (filter === 'voting' ? option(row.voting_open) === true : option(row.decision) === 1));
  const bySubnet = new Map((option(payload.subnets) ?? []).map(id => [id.toText(), []]));
  const unresolved = [];
  for (const row of proposals) {
    const targets = ids(row);
    for (const target of targets) bySubnet.get(target)?.push(row);
    if (!targets.length || option(row.unresolved)) unresolved.push(row);
  }
  const membership = proposals.filter(supported);
  return { bySubnet, unresolved, membershipCount: membership.length,
    affectedCount: [...bySubnet.values()].filter(rows => rows.some(supported)).length };
}

const compareDeadline = (a, b) => a === b ? 0 : a === undefined ? 1 : b === undefined || a < b ? -1 : 1;

export function rowSummary(proposals) {
  const deadlines = proposals.filter(row => option(row.voting_open) === true)
    .map(row => option(row.deadline)).filter(value => value > 0n);
  return { deadline: deadlines.reduce((first, deadline) => first === undefined || deadline < first ? deadline : first, undefined),
    awaiting: proposals.filter(row => 'AdoptedPendingExecution' in row.lifecycle).length };
}

function status(row) {
  const decision = option(row.decision);
  const executed = option(row.executed_at);
  const deadline = option(row.deadline);
  const votes = option(row.voting_open);
  const execution = executed ? 'Executed ' + time(executed * 1_000_000_000n)
    : decision === 5 ? 'Execution failed' : decision === 3 ? 'Awaiting execution' : 'Execution not observed';
  return [decisions[decision] ?? 'Decision status unavailable', votes === undefined ? 'Voting status unavailable'
    : votes ? 'Voting open' : 'Voting closed', execution,
    deadline ? 'Voting deadline ' + time(deadline * 1_000_000_000n) : 'Voting deadline unavailable'].join(' · ');
}

export function mountActivityNavigator(call, { open, inspectSubnet, refreshed, references, showReview, initial, read }) {
  const section = styled('section', 'card activity-navigator');
  section.setAttribute('aria-label', 'Subnet Activity');
  section.hidden = true;
  let observation = initial && { response: initial.reply.Ok, attempt: nextActivityAttempt() };
  let issue, loading, selected, filter = 'undecided';
  const expanded = new Set();
  let generation = 0;

  function choose(row, subnet) {
    if (read && selected?.id === row.id && selected.subnet === subnet) return;
    selected = { id: row.id, subnet };
    render();
    open(row.id, subnet, observation, row);
    showReview?.();
  }

  function render() {
    const top = section.scrollTop;
    const payload = observation?.response?.outcome?.Ok;
    const refresh = action(loading ? 'Checking…' : issue ? 'Retry discovery' : 'Refresh discovery', () => load(true));
    refresh.disabled = !!loading;
    const filters = styled('div', 'controls', Object.entries({ undecided: 'Undecided', voting: 'Voting open', all: 'All subnets' }).map(([key, label]) => {
      const button = action(label, () => { filter = key; render(); });
      button.setAttribute('aria-pressed', key === filter);
      return button;
    }));
    const content = [styled('div', 'activity-toolbar', el('h2', 'Subnet Activity'), refresh), filters,
      loading ? styled('p', 'activity-progress', payload ? 'Showing the previous observation while checking again.'
        : 'Checking Governance proposals and resolving affected subnets against the Registry.') : null,
      issue ? el('p', 'Discovery failed · ' + issue + (payload ? ' · Showing the previous observation.' : ' · No evidence available.')) : null];
    if (loading) content.at(2).setAttribute('role', 'status');
    if (!payload) { section.replaceChildren(...content.filter(Boolean)); return; }
    const coverage = interactionChecks(observation);
    refresh.setAttribute('aria-label', loading ? 'Checking activity' : refresh.textContent);
    const rows = activityRows(payload, filter);
    const renderProposal = (row, subnet) => el('li', dashboardLink('proposal', row.id, '#' + row.id), ' · ',
      option(row.title) ?? 'Subnet action', el('div', status(row)),
      supported(row) ? action('Review #' + row.id, () => choose(row, subnet)) : null);
    const entries = [...rows.bySubnet].filter(([, proposals]) => filter === 'all' || proposals.length);
    const reviewable = new Map(rows.unresolved.filter(supported).map(row => [row.id, { row }]));
    for (const [subnet, proposals] of entries) for (const row of proposals.filter(supported)) {
      if (!reviewable.get(row.id)?.subnet || subnet === selected?.subnet) reviewable.set(row.id, { row, subnet });
    }
    const sequence = [...reviewable.values()].sort((a, b) =>
      compareDeadline(rowSummary([a.row]).deadline, rowSummary([b.row]).deadline)
      || (a.row.id > b.row.id ? -1 : a.row.id < b.row.id ? 1 : 0));
    const index = sequence.findIndex(item => item.row.id === selected?.id);
    const move = offset => {
      const item = sequence[index + offset];
      if (item) choose(item.row, item.subnet);
    };
    const previous = action('Previous proposal', () => move(-1));
    const next = action('Next proposal', () => move(1));
    previous.disabled = index <= 0;
    next.disabled = index < 0 || index + 1 >= sequence.length;
    const pending = payload.proposals.filter(row => subnetAction(row) && 'AdoptedPendingExecution' in row.lifecycle);
    const checked = option(payload.registry_memberships_checked ?? []);
    const roster = option(payload.subnets ?? []) ?? [];
    const observed = observation.response.usage.finished_at;
    const minutes = Math.max(0, Math.floor((Date.now() - Number(observed / 1_000_000n)) / 60_000));
    const relative = minutes === 0 ? 'less than a minute ago' : minutes + (minutes === 1 ? ' minute ago' : ' minutes ago');
    const observedClock = Object.assign(el('time', time(observed).replace(/\.\d+ UTC$/, ' UTC')), {
      dateTime: new Date(Number(observed / 1_000_000n)).toISOString(), title: time(observed),
    });
    const countLine = styled('p', 'activity-total', rows.membershipCount
      + ' distinct observed Membership proposals · ' + rows.affectedCount + ' confirmed affected subnets'
      + (rows.unresolved.length ? ' · ' + rows.unresolved.length + ' unresolved targets' : ''));
    content.push(countLine,
    styled('p', 'observation-time', observedClock, ' · ', relative),
    styled('p', 'activity-registry', 'Registry ' + (option(observation.response.registry_version) ?? 'unavailable') + ' · '
      + (option(payload.registry_complete) ? 'Pinned roster resolved' : 'Registry associations incomplete')
      + (checked > 0 ? ' · ' + checked + '/' + roster.length + ' memberships checked' : '')
      + ' · Voting pagination ' + (option(payload.voting_pagination_complete) ? 'complete' : 'incomplete')),
    styled('details', 'activity-coverage', el('summary', coverage.overview), el('ul', [...coverage.observations,
      ...(option(payload.voting_issues ?? []) ?? []).map(issue => 'Voting discovery · ' + issue)].map(text => el('li', text)))),
    rows.membershipCount === 0 && filter !== 'all' ? el('p', option(payload.voting_pagination_complete) && !issue
      ? 'No matching Membership proposals were observed within the checked coverage.'
      : 'No matching Membership proposals were seen in this incomplete observation.') : null,
    pending.length && filter !== 'all' ? el('details', el('summary', 'Adopted awaiting execution (' + pending.length + ')'),
      el('ul', pending.map(row => renderProposal(row, ids(row).length === 1 ? ids(row)[0] : undefined)))) : null,
    selected ? styled('div', 'controls', el('strong', selected.id === undefined
      ? 'Selected subnet ' + selected.subnet.slice(0, 11) + '…' : 'Selected #' + selected.id), previous, next) : null,
    ...entries.sort(([, a], [, b]) => compareDeadline(rowSummary(a).deadline, rowSummary(b).deadline))
      .map(([subnet, proposals]) => {
      const label = subnet === selected?.subnet ? 'Selected subnet ' : 'Subnet ';
      const { deadline, awaiting } = rowSummary(proposals);
      const single = proposals.length === 1 && proposals[0];
      const row = () => [single ? styled('strong', 'activity-title',
        '#' + single.id + ' · ' + (option(single.title) ?? 'Membership change')) : null,
        styled('span', 'activity-subnet', label, Object.assign(el('span', subnet.slice(0, 11) + '…'), { title: subnet })),
        single ? null : styled('span', 'activity-count', String(proposals.length)),
        single || deadline || awaiting ? styled('small', 'activity-row-meta', [
          single ? actions[option(single.function)] : '',
          single ? decisions[option(single.decision)] : '',
          deadline ? 'Vote by ' + time(deadline * 1_000_000_000n) : '', awaiting ? awaiting + ' awaiting execution' : '',
        ].filter(Boolean).join(' · ')) : null];
      const reviewable = proposals.filter(supported);
      if (filter !== 'all' && proposals.length === 1 && reviewable.length === 1) {
        const control = action(row(), () => choose(reviewable[0], subnet));
        if (subnet === selected?.subnet) control.classList.add('activity-selection-focus');
        return styled('div', 'activity-direct', control);
      }
      const inspect = action('Inspect current membership', () => {
        selected = { subnet };
        render();
        inspectSubnet(subnet);
        showReview?.();
      });
      const summary = el('summary', row());
      if (subnet === selected?.subnet) summary.classList.add('activity-selection-focus');
      const detail = el('details', summary,
        filter === 'all' ? inspect : null,
        el('p', dashboardLink('subnet', subnet, 'Open subnet on the IC Dashboard')),
        proposals.length ? el('ul', proposals.map(item => renderProposal(item, subnet)))
          : el('p', 'No proposals for this subnet in the observed result.'));
      detail.open = expanded.has(subnet) || subnet === selected?.subnet;
      detail.addEventListener('toggle', () => detail.open ? expanded.add(subnet) : expanded.delete(subnet));
      return detail;
    }), rows.unresolved.length ? el('details', el('summary', 'Unresolved targets (' + rows.unresolved.length + ')'),
      el('ul', rows.unresolved.map(row => renderProposal(row, undefined)))) : null);
    section.replaceChildren(...content.filter(Boolean));
    section.scrollTop = top;
    if (section.scrollHeight <= section.clientHeight) return;
    const item = section.querySelector('.activity-selection-focus');
    if (item && (item.offsetTop < section.scrollTop || item.offsetTop + item.offsetHeight > section.scrollTop + section.clientHeight)) {
      section.scrollTop = item.offsetTop - section.offsetTop;
    }
  }

  async function load(refresh = false) {
    if (loading) return;
    const ticket = ++generation;
    const attempt = nextActivityAttempt();
    loading = true;
    issue = undefined;
    render();
    const active = () => ticket === generation && section.isConnected;
    try {
      const nodes = references?.();
      const fetch = () => call(active, client => client.subnet_activity([], nodes?.length ? [nodes] : []));
      const reply = await (read ? read(active, fetch, refresh) : fetch());
      if (!reply || !active()) return;
      const response = result(reply);
      if ('Err' in response.outcome) throw new Error(liveError(response.outcome.Err));
      observation = { response, attempt };
      refreshed?.(observation);
    } catch (error) {
      if (active()) {
        issue = error.message;
        if (observation) {
          observation = { ...observation, attempt, stale: true, error: 'Refresh failed · ' + issue };
        }
        refreshed?.(observation ?? { attempt, error: 'Refresh failed · ' + issue });
      }
    } finally {
      if (active()) { loading = false; render(); }
    }
  }
  return { section, show() {
    section.hidden = !section.hidden;
    if (section.hidden) return;
    if (!loading && (!observation || (!initial?.fresh && observation.response === initial?.reply.Ok && !issue))) void load();
    else render();
  } };
}
