'use strict';

const $ = (id) => document.getElementById(id);

/** Escape anything that reaches innerHTML - results contain remote SMTP text. */
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showLoading(slot, text) {
  slot.innerHTML =
    `<div class="loading"><span class="spinner"></span><span>${esc(text)}</span></div>`;
}

function showError(slot, err) {
  slot.innerHTML = `<div class="error">${esc(err.message || err)}</div>`;
}

const RING = { deliverable: 'var(--ok)', risky: 'var(--warn)', undeliverable: 'var(--bad)', unknown: 'var(--idle)' };

/** Signal chips: only render the ones that actually carry information. */
function chips(checks) {
  const out = [];
  const add = (label, tone) => out.push(`<span class="chip ${tone}">${esc(label)}</span>`);

  add(checks.syntax ? 'Valid syntax' : 'Bad syntax', checks.syntax ? 'pos' : 'neg');
  if (checks.mxFound) add('MX found', 'pos'); else add('No MX', 'neg');
  if (checks.smtpConnected) add('SMTP reachable', 'pos');
  if (checks.mailboxExists === true) add('Mailbox exists', 'pos');
  if (checks.mailboxExists === false) add('Mailbox missing', 'neg');
  if (checks.catchAll === true) add('Accept-all domain', 'cau');
  if (checks.disposable) add('Disposable', 'neg');
  if (checks.roleAccount) add('Role account', 'cau');
  if (checks.freeProvider) add('Free provider', '');
  if (checks.parkedDomain) add('Parked domain', 'cau');
  if (checks.gibberish) add('Random-looking', 'cau');
  return out.join('');
}

function verdictCard(r) {
  const mx = r.mx && r.mx.length ? r.mx.map((m) => m.exchange).join(', ') : '—';
  const suggestion = r.didYouMean
    ? `<div class="suggest">Did you mean
         <button type="button" data-suggest="${esc(r.localPart)}@${esc(r.didYouMean)}">${esc(r.localPart)}@${esc(r.didYouMean)}</button>?
       </div>`
    : '';

  return `
    <div class="verdict">
      <div class="verdict-head ${esc(r.status)}">
        <div class="score-ring" style="--pct:${Number(r.score) || 0};--ring:${RING[r.status] || 'var(--idle)'}">
          <span>${Number(r.score) || 0}</span>
        </div>
        <div>
          <div class="verdict-title">${esc(r.status)}</div>
          <div class="verdict-email">${esc(r.normalized || r.email)}</div>
          <div class="verdict-msg">${esc(r.message)}</div>
        </div>
      </div>
      <div class="verdict-body">
        <div class="checks">${chips(r.checks)}</div>
        ${suggestion}
        <div class="meta">
          <span>Reason</span><code>${esc(r.reason)}</code>
          <span>Mail servers</span><code>${esc(mx)}</code>
          ${r.smtpResponse ? `<span>SMTP reply</span><code>${esc(r.smtpResponse)}</code>` : ''}
          <span>Took</span><code>${esc(r.durationMs)} ms${r.cached ? ' (cached)' : ''}</code>
        </div>
      </div>
    </div>`;
}

/* ---------------- tabs ---------------- */
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => {
      t.classList.toggle('is-active', t === tab);
      t.setAttribute('aria-selected', String(t === tab));
    });
    document.querySelectorAll('.panel').forEach((p) => {
      p.classList.toggle('is-active', p.id === `panel-${tab.dataset.panel}`);
    });
  });
});

/* ---------------- single ---------------- */
const singleSlot = $('singleResult');

$('singleForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const email = $('singleEmail').value.trim();
  if (!email) return;

  const button = event.target.querySelector('button');
  button.disabled = true;
  showLoading(singleSlot, 'Checking syntax, DNS and mailbox…');
  try {
    singleSlot.innerHTML = verdictCard(await api('/api/verify', { email }));
  } catch (err) {
    showError(singleSlot, err);
  } finally {
    button.disabled = false;
  }
});

// Accept a "did you mean" suggestion and immediately re-run it.
singleSlot.addEventListener('click', (event) => {
  const target = event.target.closest('[data-suggest]');
  if (!target) return;
  $('singleEmail').value = target.dataset.suggest;
  $('singleForm').requestSubmit();
});

/* ---------------- bulk ---------------- */
const bulkSlot = $('bulkResult');
const bulkInput = $('bulkInput');
const EMAIL_RE = /[^\s,;<>"'()[\]]+@[^\s,;<>"'()[\]]+\.[A-Za-z]{2,}/g;

function countEmails() {
  const found = bulkInput.value.match(EMAIL_RE) || [];
  const unique = new Set(found.map((e) => e.toLowerCase())).size;
  $('bulkCount').textContent = `${unique} address${unique === 1 ? '' : 'es'}`;
}
bulkInput.addEventListener('input', countEmails);

$('bulkFile').addEventListener('change', async (event) => {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  bulkInput.value = await file.text();
  countEmails();
});

let lastBulkResults = [];

function summaryCards(s) {
  const cards = ['deliverable', 'risky', 'undeliverable', 'unknown']
    .map((key) => `
      <div class="stat ${key}">
        <div class="stat-num">${s[key]}</div>
        <div class="stat-label">${key}</div>
      </div>`)
    .join('');
  return `<div class="summary">
    <div class="stat"><div class="stat-num">${s.total}</div><div class="stat-label">checked</div></div>
    ${cards}
  </div>`;
}

function resultsTable(results) {
  const rows = results.map((r) => `
    <tr>
      <td class="email">${esc(r.normalized || r.email)}</td>
      <td><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td>
      <td class="num">${Number(r.score) || 0}</td>
      <td>${esc(r.message)}</td>
    </tr>`).join('');

  return `
    <div class="table-actions">
      <button class="btn" id="downloadCsv" type="button">Download CSV</button>
      <span class="hint">Sorted worst-first so you can trim the list from the top.</span>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Address</th><th>Status</th><th>Score</th><th>Detail</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

const STATUS_ORDER = { undeliverable: 0, risky: 1, unknown: 2, deliverable: 3 };

$('bulkForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const raw = bulkInput.value.trim();
  if (!raw) return;

  const button = event.target.querySelector('button[type="submit"]');
  button.disabled = true;
  bulkSlot.innerHTML =
    '<div class="loading"><span class="spinner"></span><span>Verifying the list. ' +
    'SMTP probes are paced per mail server, so a long list takes a while.</span></div>' +
    '<div class="progress"><i></i></div>';

  try {
    const data = await api('/api/verify/bulk', {
      emails: raw,
      skipSmtp: $('bulkSkipSmtp').checked,
    });
    lastBulkResults = data.results.slice().sort(
      (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || a.score - b.score
    );
    bulkSlot.innerHTML = summaryCards(data.summary) + resultsTable(lastBulkResults);
  } catch (err) {
    showError(bulkSlot, err);
  } finally {
    button.disabled = false;
  }
});

// Build the CSV client-side from results we already have - no second pass of probes.
bulkSlot.addEventListener('click', (event) => {
  if (!event.target.closest('#downloadCsv')) return;

  const header = ['email', 'status', 'score', 'reason', 'message', 'domain', 'catch_all', 'role_account', 'disposable'];
  const cell = (v) => {
    const text = String(v ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const body = lastBulkResults.map((r) => [
    r.normalized || r.email, r.status, r.score, r.reason, r.message, r.domain,
    r.checks.catchAll ?? '', r.checks.roleAccount, r.checks.disposable,
  ].map(cell).join(','));

  const blob = new Blob([[header.join(','), ...body].join('\r\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'verification-results.csv';
  link.click();
  URL.revokeObjectURL(url);
});

/* ---------------- finder ---------------- */
const finderSlot = $('finderResult');

$('finderForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.target.querySelector('button');
  button.disabled = true;
  showLoading(finderSlot, 'Testing the most likely address patterns…');

  try {
    const data = await api('/api/find', {
      firstName: $('finderFirst').value.trim(),
      lastName: $('finderLast').value.trim(),
      domain: $('finderDomain').value.trim(),
    });

    // Explain why nothing carries a confirmed verdict, rather than showing a
    // table of "Unknown" with no reason.
    const NOTES = {
      accept_all_domain:
        'This domain accepts mail for every address, so no candidate can be ' +
        'confirmed. These are ranked by how common each pattern is.',
      smtp_unavailable:
        'The mail server could not be reached for verification, so nothing ' +
        'here is confirmed. These are ranked by how common each pattern is. ' +
        'Outbound port 25 is blocked on most cloud hosts — see the README.',
    };
    const note = data.confirmed
      ? ''
      : `<div class="suggest">${esc(NOTES[data.unconfirmedReason] || NOTES.smtp_unavailable)}</div>`;

    const best = data.best
      ? `<div class="stat" style="margin-bottom:14px">
           <div class="stat-label">${data.confirmed ? 'Best match' : 'Most likely pattern'} — ${esc(data.best.confidence)}% confidence</div>
           <div class="stat-num" style="font-size:17px;font-family:ui-monospace,monospace">${esc(data.best.email)}</div>
         </div>`
      : '<div class="error">No likely address found for that name and domain.</div>';

    const rows = data.candidates.map((c) => `
      <tr>
        <td class="email">${esc(c.email)}</td>
        <td><code style="font-size:12px">${esc(c.pattern)}</code></td>
        <td><span class="badge ${esc(c.verification.status)}">${esc(c.verification.status)}</span></td>
        <td class="num">${esc(c.confidence)}%</td>
      </tr>`).join('');

    finderSlot.innerHTML = `${note}${best}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Candidate</th><th>Pattern</th><th>Status</th><th>Confidence</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  } catch (err) {
    showError(finderSlot, err);
  } finally {
    button.disabled = false;
  }
});

/* ---------------- engine status ---------------- */
(async function engineStatus() {
  const pill = $('engineStatus');
  try {
    const health = await api('/api/health');
    if (health.smtpEnabled) {
      pill.textContent = 'SMTP probe active';
    } else {
      pill.textContent = 'DNS-only mode';
      pill.classList.add('warn');
      pill.title = 'SMTP verification is disabled, so mailboxes cannot be confirmed.';
    }
  } catch {
    pill.textContent = 'Engine unreachable';
    pill.classList.add('warn');
  }
})();
