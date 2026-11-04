import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { captureFrame, startCamera, stopCamera } from './camera';
import { renderChart } from './chart';
import { fromCsv, toCsv } from './csv';
import {
  allMeasurements,
  clearMeasurements,
  deleteMeasurement,
  getMeasurement,
  kvGet,
  kvSet,
  putMeasurement,
  type LatencySample,
  type Measurement,
  type Source,
} from './db';
import { autoRead, drawOverlay } from './autoread';
import type { AutoOverlay, AutoResult } from './cv/protocol';
import { decodeImage } from './decode';
import { readExifTime } from './exif';
import {
  fmtDate,
  fmtSigned,
  fmtTime,
  fmtTod,
  localMidnight,
  parseTimeOfDay,
  watchTimeFromTimeOfDay,
} from './reading';
import { linearFit, segments } from './stats';
import { fmtCountdown, nextSetTarget, Pips, PIP_COUNT, SET_STEP_MS } from './setclock';
import { syncClock, type SyncResult } from './timesync';
import { Viewer } from './viewer';

registerSW({ immediate: true });

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---------- State ----------

const SYNC_MAX_AGE = 30 * 60_000; // the device clock does not drift by ms within minutes
let sync: SyncResult | null = null;
let syncing: Promise<SyncResult | null> | null = null;
let latencyMs = 0;
let calibMode = false;
let datePosition = 3;
let pendingReset = false; // watch was just set → next measurement starts a new series
const GOOD_CONF = 0.75; // below this the auto-read is flagged as uncertain

interface Entry {
  mode: 'new' | 'calib' | 'edit';
  source: Source;
  photo?: Blob;
  imgW: number;
  imgH: number;
  tDevice: number;
  offsetMs: number;
  offsetErrMs: number;
  latencyMs: number;
  existing?: Measurement;
  auto?: AutoResult;
  autoText?: string; // text the auto-read wrote into the input (to detect manual edits)
}
let entry: Entry | null = null;

const viewer = new Viewer($<HTMLCanvasElement>('photo'));
const video = $<HTMLVideoElement>('video');

// ---------- Helpers ----------

let toastTimer = 0;
function toast(msg: string, ms = 3000) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t.hidden = true), ms);
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// ---------- Clock sync ----------

function renderSync(state: 'busy' | 'ok' | 'err') {
  const b = $('sync-badge');
  b.className = 'badge';
  if (state === 'busy') {
    b.textContent = 'syncing…';
    return;
  }
  if (state === 'err' || !sync) {
    b.classList.add('err');
    b.textContent = sync ? 'stale sync' : 'no sync';
  } else {
    b.classList.add(sync.errMs < 50 ? 'ok' : 'warn');
    // offset = true − device → device is ahead of true time by −offset
    b.textContent = `Phone ${fmtSigned(-sync.offsetMs, 0)} ms ±${Math.ceil(sync.errMs)}`;
  }
  $('sync-detail').textContent = sync
    ? `Device clock differs from true time by ${fmtSigned(-sync.offsetMs, 0)} ms (±${Math.ceil(sync.errMs)} ms, ` +
      `${sync.samples} samples, ${sync.server}). Last sync: ${fmtTime(sync.at, 0)}.`
    : 'Not synced yet.';
}

function doSync(): Promise<SyncResult | null> {
  syncing ??= (async () => {
    renderSync('busy');
    try {
      sync = await syncClock();
      await kvSet('lastSync', sync);
      renderSync('ok');
      return sync;
    } catch (e) {
      renderSync('err');
      toast(`Sync failed: ${(e as Error).message}`);
      return null;
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

async function freshSync(): Promise<SyncResult | null> {
  if (sync && Date.now() - sync.at < SYNC_MAX_AGE) return sync;
  return (await doSync()) ?? sync;
}

// ---------- Views ----------

type ViewName = 'measure' | 'entry' | 'history' | 'settings' | 'ref' | 'set';
const VIEWS: ViewName[] = ['measure', 'entry', 'history', 'settings', 'ref', 'set'];
let current: ViewName | null = null;

function show(name: ViewName) {
  if (current === name) return;
  const prev = current;
  current = name;
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
  $('nav').hidden = name === 'entry' || name === 'ref' || name === 'set';
  document.querySelectorAll<HTMLAnchorElement>('[data-nav]').forEach((a) => {
    a.classList.toggle('active', a.dataset.nav === name);
  });
  if (prev === 'measure') stopCamera(video);
  if (prev === 'ref') stopRef();
  if (prev === 'set') stopSet();
  if (name === 'measure') openMeasure();
  if (name === 'history') void renderHistory();
  if (name === 'settings') void renderSettings();
  if (name === 'ref') startRef();
  if (name === 'set') startSet();
}

function route() {
  const h = location.hash.slice(1) as ViewName;
  if (h === 'entry' && !entry) return void (location.hash = 'measure');
  if (h !== 'entry') entry = null;
  show(VIEWS.includes(h) ? h : 'measure');
}
window.addEventListener('hashchange', route);

// ---------- Measure ----------

async function openMeasure() {
  $('calib-banner').hidden = !calibMode;
  const msg = $('camera-msg');
  msg.hidden = true;
  void freshSync();
  try {
    await startCamera(video);
  } catch (e) {
    msg.hidden = false;
    msg.textContent = window.isSecureContext
      ? `Could not open the camera: ${(e as Error).message}`
      : 'The camera requires HTTPS.';
  }
}

$('shutter').addEventListener('click', async () => {
  const btn = $<HTMLButtonElement>('shutter');
  if (!video.srcObject) return;
  btn.disabled = true;
  try {
    const cap = await captureFrame(video);
    const s = await freshSync();
    if (!s) toast('No sync: using the uncorrected device clock.', 4000);
    await openEntry({
      mode: calibMode ? 'calib' : 'new',
      source: 'camera',
      photo: cap.blob,
      imgW: cap.width,
      imgH: cap.height,
      tDevice: cap.tDevice,
      offsetMs: s?.offsetMs ?? 0,
      offsetErrMs: s?.errMs ?? NaN,
      latencyMs: calibMode ? 0 : latencyMs,
    });
  } catch (e) {
    toast(`Capture failed: ${(e as Error).message}`);
  } finally {
    btn.disabled = false;
  }
});

$<HTMLInputElement>('file-input').addEventListener('change', async (ev) => {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const exif = await readExifTime(file);
    if (!exif) toast('No EXIF time, using the file date.', 4000);
    else if (!exif.hasSubSec) toast('No EXIF sub-seconds (±0.5 s).', 4000);
    const lastSync = sync ?? (await kvGet<SyncResult>('lastSync')) ?? null;
    await openEntry({
      mode: 'new',
      source: 'upload',
      photo: file,
      imgW: 0,
      imgH: 0,
      tDevice: exif?.ms ?? file.lastModified,
      offsetMs: lastSync?.offsetMs ?? 0,
      offsetErrMs: lastSync?.errMs ?? NaN,
      latencyMs: 0,
    });
  } catch (e) {
    toast(`Could not open the file: ${(e as Error).message}`);
  }
});

$('sync-badge').addEventListener('click', () => void doSync());
$('calib-cancel').addEventListener('click', () => {
  calibMode = false;
  $('calib-banner').hidden = true;
});

// ---------- Reading entry ----------

const watchInput = $<HTMLInputElement>('watch-input');
const offsetInput = $<HTMLInputElement>('offset-input');

const tTrueOf = (e: Entry) => e.tDevice + e.offsetMs - e.latencyMs;

async function openEntry(e: Entry, prefillWatch?: number) {
  entry = e;
  let bitmap: ImageBitmap | null = null;
  if (e.photo) {
    const dec = await decodeImage(e.photo);
    bitmap = dec.bitmap;
    e.photo = dec.jpeg;
    e.imgW = bitmap.width;
    e.imgH = bitmap.height;
    location.hash = 'entry';
    viewer.setImage(bitmap);
  } else {
    location.hash = 'entry';
  }
  const tTrue = tTrueOf(e);
  const pre = prefillWatch ?? Math.round(tTrue / 100) * 100;
  watchInput.value = fmtTod(pre - localMidnight(pre), 2);

  const isCalib = e.mode === 'calib';
  $('entry-label').textContent = isCalib ? 'Reference clock shown in the photo' : 'Watch shows';
  $('entry-extra').hidden = isCalib;
  $('upload-offset').hidden = e.source !== 'upload';
  offsetInput.value = String(Math.round(e.offsetMs) || 0);
  $<HTMLInputElement>('note-input').value = e.existing?.note ?? '';
  $<HTMLInputElement>('reset-input').checked = e.existing?.reset ?? (e.mode === 'new' && pendingReset);
  setAutoStatus(null);
  updateEntry();

  if (isCalib) return;
  if (e.existing?.auto) {
    e.auto = e.existing.auto;
    e.autoText = fmtTod(e.auto.todSeconds * 1000, 2);
    showAuto(e.auto);
  } else if (bitmap) {
    showHands(defaultOverlay(bitmap.width, bitmap.height));
    void runAuto(e, bitmap);
  }
}

const STAGE_LABEL: Record<string, string> = {
  center: 'finding the dial',
  ring: 'minute ticks',
  homography: 'perspective correction',
  rectify: 'perspective correction',
  orientation: '12 o\'clock direction',
  hands: 'hour/minute hands',
  'seconds-search': 'seconds hand',
  'seconds-refine': 'seconds hand (sub-pixel)',
};


function setAutoStatus(state: { kind: 'busy' | 'ok' | 'warn' | 'err'; html: string } | null) {
  const el = $('auto-status');
  el.hidden = !state;
  if (!state) return;
  el.className = `auto-status ${state.kind === 'busy' ? '' : state.kind}`;
  el.innerHTML = (state.kind === 'busy' ? '<span class="spin"></span>' : '') + state.html;
}

/** Hands drawn for whatever is in the input, so manual edits move them. */
function showHands(o: AutoOverlay) {
  viewer.setOverlay((ctx, px) => {
    const tod = parseTimeOfDay(watchInput.value);
    drawOverlay(ctx, o, px, tod === null ? null : tod / 1000);
  });
}

/** Dial placeholder centred on the photo, 12 at the top: used until (or if) the auto-read locates the dial. */
function defaultOverlay(w: number, h: number): AutoOverlay {
  const r = 0.4 * Math.min(w, h);
  return { H: [r, 0, w / 2, 0, r, h / 2, 0, 0, 1], theta12: -Math.PI / 2, lines: [] };
}

function showAuto(r: AutoResult) {
  showHands(r.overlay);
  const conf = Math.round(r.confidence * 100);
  const warn = r.warnings.length ? ` · ${r.warnings.map(escapeHtml).join(', ')}` : '';
  setAutoStatus({
    kind: r.warnings.length || r.confidence < GOOD_CONF ? 'warn' : 'ok',
    html: `Auto: <b>${fmtTod(r.todSeconds * 1000, 2)}</b> · confidence ${conf}%${warn}`,
  });
}

async function runAuto(e: Entry, bitmap: ImageBitmap) {
  const tTrue = tTrueOf(e);
  const refTod = (tTrue - localMidnight(tTrue)) / 1000;
  setAutoStatus({ kind: 'busy', html: 'Reading automatically…' });
  try {
    const r = await autoRead(bitmap, refTod, datePosition, (stage) => {
      if (entry === e) setAutoStatus({ kind: 'busy', html: `Reading automatically: ${STAGE_LABEL[stage] ?? stage}…` });
    });
    if (entry !== e) return;
    e.auto = r;
    e.autoText = fmtTod(r.todSeconds * 1000, 2);
    watchInput.value = e.autoText;
    showAuto(r);
    updateEntry();
  } catch (err) {
    if (entry === e) setAutoStatus({ kind: 'err', html: `Automatic reading failed: ${escapeHtml((err as Error).message)}. Adjust the time until the drawn hands match the watch.` });
  }
}

function currentWatch(): { tod: number; watchTime: number } | null {
  if (!entry) return null;
  const tod = parseTimeOfDay(watchInput.value);
  if (tod === null) return null;
  return { tod, watchTime: watchTimeFromTimeOfDay(tTrueOf(entry), tod) };
}

function updateEntry() {
  if (!entry) return;
  const tTrue = tTrueOf(entry);
  const src = SOURCE_LABEL[entry.source];
  const err = Number.isFinite(entry.offsetErrMs) ? `±${Math.ceil(entry.offsetErrMs)} ms` : 'unsynced';
  $('entry-info').textContent =
    `True capture time: ${fmtDate(tTrue)} ${fmtTime(tTrue, 3)} · ${src} · offset ${fmtSigned(entry.offsetMs, 0)} ms ${err}` +
    (entry.latencyMs ? ` · latency ${entry.latencyMs.toFixed(0)} ms` : '');

  const w = currentWatch();
  watchInput.classList.toggle('invalid', !w);
  viewer.redraw();
  const out = $('drift-out');
  if (!w) {
    out.textContent = 'Format: hh:mm:ss.f (e.g. 12:48:41.8)';
    return;
  }
  const d = (w.watchTime - tTrue) / 1000;
  if (entry.mode === 'calib') {
    out.innerHTML = `Camera latency: <b>${(-d * 1000).toFixed(0)} ms</b>`;
  } else {
    const dir = Math.abs(d) < 0.05 ? 'on time' : d > 0 ? 'fast' : 'slow';
    out.innerHTML = `Drift: <b>${fmtSigned(d, 2, ' s')}</b> <span class="muted">(${dir})</span>`;
  }
}

watchInput.addEventListener('input', updateEntry);
watchInput.addEventListener('focus', () => watchInput.select());
offsetInput.addEventListener('input', () => {
  if (!entry) return;
  const v = Number(offsetInput.value);
  if (Number.isFinite(v)) entry.offsetMs = v;
  updateEntry();
});

document.querySelectorAll<HTMLButtonElement>('.step').forEach((b) => {
  b.addEventListener('click', () => {
    const w = currentWatch();
    if (!w || !entry) return;
    watchInput.value = fmtTod(w.tod + Number(b.dataset.step), 2);
    updateEntry();
  });
});

$('entry-cancel').addEventListener('click', () => {
  const back = entry?.mode === 'edit' ? 'history' : entry?.mode === 'calib' ? 'settings' : 'measure';
  entry = null;
  location.hash = back;
});

$('entry-save').addEventListener('click', () => void saveEntry());

async function saveEntry() {
  if (!entry) return;
  const w = currentWatch();
  if (!w) return toast('Invalid time format.');
  const tTrue = tTrueOf(entry);

  if (entry.mode === 'calib') {
    const lat = tTrue - w.watchTime; // frame timestamp − true exposure time
    const samples = ((await kvGet<LatencySample[]>('latencySamples')) ?? []).slice(-9);
    samples.push({ at: Date.now(), latencyMs: lat, timeSource: 'camera' });
    await kvSet('latencySamples', samples);
    latencyMs = median(samples.map((s) => s.latencyMs));
    await kvSet('latencyMs', latencyMs);
    calibMode = false;
    entry = null;
    toast(`Latency sample ${lat.toFixed(0)} ms → median ${latencyMs.toFixed(0)} ms`);
    location.hash = 'settings';
    return;
  }

  const base = entry.existing;
  const m: Measurement = {
    id: base?.id ?? crypto.randomUUID(),
    createdAt: base?.createdAt ?? Date.now(),
    source: entry.source,
    tDevice: entry.tDevice,
    offsetMs: entry.offsetMs,
    offsetErrMs: entry.offsetErrMs,
    latencyMs: entry.latencyMs,
    tTrue,
    watchTime: w.watchTime,
    drift: (w.watchTime - tTrue) / 1000,
    imgW: entry.imgW,
    imgH: entry.imgH,
    photo: entry.photo,
    note: $<HTMLInputElement>('note-input').value.trim(),
    reset: $<HTMLInputElement>('reset-input').checked,
    method: entry.auto && watchInput.value.trim() === entry.autoText ? 'auto' : 'manual',
    auto: entry.auto,
  };
  await putMeasurement(m);
  if (!base && pendingReset) {
    pendingReset = false;
    await kvSet('pendingReset', false);
  }
  entry = null;
  toast(`Saved: ${fmtSigned(m.drift, 2, ' s')}`);
  location.hash = 'history';
}

// ---------- History ----------

const MIN_RATE_SPAN_DAYS = 0.25;
const SOURCE_LABEL: Record<Source, string> = { camera: 'camera', upload: 'file', import: 'import' };

async function renderHistory() {
  const all = await allMeasurements();
  const segs = segments(all);
  const cur = segs[segs.length - 1] ?? [];
  const rawFit = linearFit(cur);
  // Over spans shorter than 6 h the reading error (±0.2 s) makes the rate meaningless.
  const fit = rawFit && rawFit.spanDays >= MIN_RATE_SPAN_DAYS ? rawFit : null;

  const sum = $('summary');
  if (cur.length === 0) {
    sum.innerHTML = '<p class="muted">No measurements yet. <a href="#measure" class="link">Take the first one</a></p>';
  } else {
    const last = cur[cur.length - 1];
    const rate = fit
      ? `${fmtSigned(fit.rate, 1)}${Number.isFinite(fit.rateErr) ? `<span class="small muted"> ±${fit.rateErr.toFixed(1)}</span>` : ''}`
      : '—';
    const span = rawFit ? `${rawFit.spanDays.toFixed(1)} days` : '—';
    sum.innerHTML = `
      <div class="stats">
        <div class="stat"><div class="v">${rate}</div><div class="k">s/day (current series)</div></div>
        <div class="stat"><div class="v">${fmtSigned(last.drift, 1)}</div><div class="k">last drift (s)</div></div>
        <div class="stat"><div class="v">${cur.length}</div><div class="k">measurements · ${span}</div></div>
      </div>
      <p class="muted small" style="margin:10px 0 0">
        Rolex Superlative Chronometer spec: −2 / +2 s/day (COSC: −4 / +6).
        ${!fit || fit.spanDays < 2 ? 'For a reliable rate, leave at least 1–2 days between measurements.' : ''}
      </p>`;
  }
  renderChart($('chart'), cur, fit);

  const list = $('list');
  list.innerHTML = '';
  for (const m of [...all].reverse()) {
    const li = document.createElement('li');
    li.className = 'item';
    li.innerHTML = `
      <div>
        <div class="when">${fmtDate(m.tTrue)} ${fmtTime(m.tTrue, 1)}${m.reset ? '<span class="tag">set</span>' : ''}</div>
        <div class="meta">watch ${fmtTime(m.watchTime, 2)} · ${SOURCE_LABEL[m.source]}${m.method === 'auto' ? ' · auto' : m.method === 'manual' && m.auto ? ' · corrected manually' : ''}${m.note ? ' · ' + escapeHtml(m.note) : ''}</div>
      </div>
      <div>
        <div class="d">${fmtSigned(m.drift, 2, ' s')}</div>
        <div class="ops"><button data-edit="${m.id}">Edit</button><button data-del="${m.id}">Delete</button></div>
      </div>`;
    list.appendChild(li);
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

$('list').addEventListener('click', async (ev) => {
  const t = ev.target as HTMLElement;
  const del = t.dataset.del;
  const edit = t.dataset.edit;
  if (del) {
    if (!confirm('Delete this measurement?')) return;
    await deleteMeasurement(del);
    void renderHistory();
  } else if (edit) {
    const m = await getMeasurement(edit);
    if (!m) return;
    await openEntry(
      {
        mode: 'edit',
        source: m.source,
        photo: m.photo,
        imgW: m.imgW,
        imgH: m.imgH,
        tDevice: m.tDevice,
        offsetMs: m.offsetMs,
        offsetErrMs: m.offsetErrMs,
        latencyMs: m.latencyMs,
        existing: m,
      },
      m.watchTime,
    );
  }
});

// ---------- Settings ----------

async function renderSettings() {
  renderSync(sync ? 'ok' : 'err');
  $<HTMLInputElement>('datepos-input').value = String(datePosition);
  $<HTMLInputElement>('latency-input').value = latencyMs.toFixed(0);
  const samples = (await kvGet<LatencySample[]>('latencySamples')) ?? [];
  $('latency-samples').textContent = samples.length
    ? `Samples: ${samples.map((s) => s.latencyMs.toFixed(0)).join(', ')} ms`
    : 'No calibration samples yet (assuming 0 ms).';
}

$('sync-now').addEventListener('click', () => void doSync());
$<HTMLInputElement>('datepos-input').addEventListener('change', async (ev) => {
  const v = Math.round(Number((ev.target as HTMLInputElement).value));
  if (!(v >= 1 && v <= 12)) return;
  datePosition = v;
  await kvSet('datePosition', v);
});
$<HTMLInputElement>('latency-input').addEventListener('change', async (ev) => {
  const v = Number((ev.target as HTMLInputElement).value);
  if (!Number.isFinite(v)) return;
  latencyMs = v;
  await kvSet('latencyMs', v);
  toast(`Latency set to ${v} ms.`);
});
$('calib-start').addEventListener('click', () => {
  calibMode = true;
  location.hash = 'measure';
});

$('export-csv').addEventListener('click', async () => {
  const csv = toCsv(await allMeasurements());
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `watch-logger-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$<HTMLInputElement>('import-csv').addEventListener('change', async (ev) => {
  const input = ev.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  const existing = new Set((await allMeasurements()).map((m) => m.id));
  const rows = fromCsv(await f.text()).filter((m) => !existing.has(m.id));
  for (const m of rows) await putMeasurement(m);
  toast(`Imported ${rows.length} measurements.`);
});

$('delete-all').addEventListener('click', async () => {
  if (!confirm('Permanently delete all measurements?')) return;
  await clearMeasurements();
  toast('All measurements deleted.');
});

// ---------- Reference clock ----------

let refRaf = 0;
let wakeLock: { release(): Promise<void> } | null = null;

function acquireWakeLock() {
  (navigator as unknown as { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock
    ?.request('screen')
    .then((l) => (wakeLock = l))
    .catch(() => undefined);
}

function releaseWakeLock() {
  void wakeLock?.release();
  wakeLock = null;
}

function startRef() {
  void freshSync();
  const tEl = $('ref-time');
  const msEl = $('ref-ms');
  const info = $('ref-info');
  const tick = () => {
    const now = Date.now() + (sync?.offsetMs ?? 0);
    tEl.textContent = fmtTime(now, 0);
    msEl.textContent = '.' + String(Math.floor(now % 1000)).padStart(3, '0');
    info.textContent = sync ? `sync ±${Math.ceil(sync.errMs)} ms` : 'no sync!';
    refRaf = requestAnimationFrame(tick);
  };
  tick();
  acquireWakeLock();
}

function stopRef() {
  cancelAnimationFrame(refRaf);
  releaseWakeLock();
}

// ---------- Set the watch ----------

type SetPhase = 'prep' | 'armed' | 'done';
let setPhase: SetPhase = 'prep';
let setTarget = 0;
let setRaf = 0;
let setScheduled = false;
let setLastSec = 0;
const pips = new Pips();
const trueNow = () => Date.now() + (sync?.offsetMs ?? 0);
const hhmm = (ms: number) => fmtTime(ms, 0).slice(0, 5);

function startSet() {
  void freshSync();
  enterSetPrep();
  acquireWakeLock();
  cancelAnimationFrame(setRaf);
  setRaf = requestAnimationFrame(tickSet);
}

function stopSet() {
  cancelAnimationFrame(setRaf);
  pips.close();
  releaseWakeLock();
  $('view-set').classList.remove('flash', 'pulse', 'armed');
}

function enterSetPrep() {
  setPhase = 'prep';
  setTarget = nextSetTarget(trueNow());
  pips.cancel();
  renderSetPhase();
}

function renderSetPhase() {
  const view = $('view-set');
  view.classList.toggle('armed', setPhase !== 'prep');
  const help = $('set-help');
  const cancel = $('set-cancel');
  const ready = $('set-ready');
  if (setPhase === 'prep') {
    $('set-step').textContent = '1 · Get ready';
    help.innerHTML =
      `Pull the crown out so the seconds hand stops at 12. Set the hands to <b>${hhmm(setTarget)}</b>. ` +
      `Tap when ready: short pips during the last ${PIP_COUNT} seconds, a long pip on the exact second.`;
    cancel.textContent = 'Cancel';
    ready.textContent = 'Ready';
  } else if (setPhase === 'armed') {
    $('set-step').textContent = '2 · Wait';
    help.innerHTML = 'Push the crown in on the <b>long pip</b>.';
    cancel.textContent = 'Cancel';
  } else {
    $('set-step').textContent = 'Running';
    help.innerHTML =
      'The watch is running. The next measurement will be marked as a <b>new series</b>. ' +
      'Take a photo in a few minutes to measure the initial offset.';
    cancel.textContent = 'Again';
    ready.textContent = 'Done';
  }
  ready.hidden = setPhase === 'armed';
}

function tickSet() {
  const now = trueNow();
  let rem = setTarget - now;
  const view = $('view-set');

  if (setPhase === 'prep' && rem < (PIP_COUNT + 3) * 1000) {
    // Not enough time left for all pips after pressing Ready → move to the next 5 minutes.
    setTarget += SET_STEP_MS;
    rem += SET_STEP_MS;
    renderSetPhase();
  }

  if (setPhase === 'armed') {
    if (!setScheduled && rem < (PIP_COUNT + 2) * 1000) {
      pips.schedule(setTarget, trueNow);
      setScheduled = true;
    }
    const sec = Math.ceil(rem / 1000);
    if (sec !== setLastSec && sec >= 1 && sec <= PIP_COUNT) {
      view.classList.add('pulse');
      setTimeout(() => view.classList.remove('pulse'), 150);
    }
    setLastSec = sec;
    if (rem <= 0) {
      setPhase = 'done';
      pendingReset = true;
      void kvSet('pendingReset', true);
      view.classList.add('flash');
      setTimeout(() => view.classList.remove('flash'), 700);
      renderSetPhase();
    }
  }

  $('set-target').textContent = fmtTime(setTarget, 0);
  $('set-count').textContent = setPhase === 'done' ? `+${fmtCountdown(-rem)}` : fmtCountdown(rem);
  $('set-now').textContent =
    `Now ${fmtTime(now, 1)} · ` + (sync ? `sync ±${Math.ceil(sync.errMs)} ms` : 'no sync!');
  setRaf = requestAnimationFrame(tickSet);
}

$('set-ready').addEventListener('click', async () => {
  if (setPhase === 'done') return void (location.hash = 'measure');
  if (setPhase !== 'prep') return;
  setPhase = 'armed';
  setScheduled = false;
  setLastSec = 0;
  renderSetPhase();
  const ok = await pips.unlock();
  if (!ok) toast('Audio unavailable; follow the on-screen countdown.', 5000);
});

$('set-cancel').addEventListener('click', () => {
  if (setPhase === 'done') return enterSetPrep();
  location.hash = 'measure';
});

// ---------- Startup ----------

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void freshSync();
});

(async () => {
  sync = (await kvGet<SyncResult>('lastSync')) ?? null;
  latencyMs = (await kvGet<number>('latencyMs')) ?? 0;
  datePosition = (await kvGet<number>('datePosition')) ?? 3;
  pendingReset = (await kvGet<boolean>('pendingReset')) ?? false;
  renderSync(sync ? 'ok' : 'err');
  route();
  void doSync();
})();
