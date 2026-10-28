const $ = (id) => document.getElementById(id);
const rupees = (n) => `₹${n}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const loyalty = PointBridge.mount($('pointbridge'), { app: 'cinema', feedEl: $('feed') });
let movies = [];
let selected = null; // { movie, show }
let seats = 2;

const monogram = (title) => title.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).slice(0, 2).map((w) => w[0]).join('');
const runtime = (min) => `${Math.floor(min / 60)}h ${min % 60}m`;

function renderMovies() {
  $('movie-count').textContent = `${movies.length} films · ${movies.reduce((n, m) => n + m.shows.length, 0)} shows`;
  $('movies').innerHTML = movies.map((m) => `
    <article class="movie" role="listitem">
      <div class="monogram" aria-hidden="true">${esc(monogram(m.title))}</div>
      <div>
        <h3>${esc(m.title)}</h3>
        <div class="meta"><span class="tag">${esc(m.genre)}</span><span>${runtime(m.minutes)}</span></div>
      </div>
      <div class="times">
        ${m.shows.map((s) => `
          <button class="time ${selected?.show.id === s.id ? 'on' : ''}" data-show="${s.id}" ${s.seatsLeft === 0 ? 'disabled' : ''}
            aria-pressed="${selected?.show.id === s.id}" aria-label="${esc(m.title)} at ${s.startsAt}, ${rupees(s.price)}, ${s.seatsLeft} seats left">
            ${s.startsAt}<small class="${s.seatsLeft <= 5 ? 'low' : ''}">${rupees(s.price)} · ${s.seatsLeft}</small>
          </button>`).join('')}
      </div>
    </article>`).join('');
}

function renderSelection() {
  $('seats').textContent = seats;
  if (!selected) {
    $('total').textContent = rupees(0);
    $('book').disabled = true;
    return;
  }
  const { movie, show } = selected;
  $('selection').classList.remove('muted');
  $('selection').innerHTML = `${esc(movie.title)} <span class="muted mono">· ${show.startsAt} · ${show.seatsLeft} left</span>`;
  $('total').textContent = rupees(show.price * seats);
  $('book').disabled = false;
}

$('movies').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-show]');
  if (!btn) return;
  const id = Number(btn.dataset.show);
  const movie = movies.find((m) => m.shows.some((s) => s.id === id));
  selected = { movie, show: movie.shows.find((s) => s.id === id) };
  renderMovies();
  renderSelection();
});
$('less').addEventListener('click', () => { seats = Math.max(1, seats - 1); renderSelection(); });
$('more').addEventListener('click', () => { seats = Math.min(10, seats + 1); renderSelection(); });

const STATUS = { ok: ['ok', 'points applied'], failed: ['failed', 'points not applied'], none: ['none', 'guest'], pending: ['failed', 'pending'] };

async function loadBookings() {
  const bookings = await (await fetch('/api/bookings')).json();
  $('bookings').innerHTML = bookings.map((b) => {
    const [cls, label] = STATUS[b.loyaltyStatus] ?? ['none', b.loyaltyStatus];
    return `<tr><td>BK-${b.id}</td><td>${esc(b.title)}</td><td class="mono">${b.startsAt}</td><td class="num">${b.seats}</td>
      <td class="num">${rupees(b.total)}</td><td class="num">${b.pointsUsed}</td><td class="num">${rupees(b.paid)}</td><td class="num">${b.pointsEarned}</td>
      <td><span class="badge ${cls}">${label}</span></td></tr>`;
  }).join('') || '<tr><td colspan="9" class="muted">No bookings yet. Pick a showtime above to create the first one.</td></tr>';
}

async function loadMovies() {
  movies = await (await fetch('/api/movies')).json();
  if (selected) {
    const movie = movies.find((m) => m.id === selected.movie.id);
    selected = { movie, show: movie.shows.find((s) => s.id === selected.show.id) };
  }
  renderMovies();
  renderSelection();
}

function banner(text) {
  $('banner').textContent = text ?? '';
  $('banner').hidden = !text;
}

$('book').addEventListener('click', async () => {
  banner(null);
  $('book').disabled = true;
  const { phone, name, usePoints } = loyalty.customer();
  const res = await fetch('/api/bookings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, name, usePoints, showId: selected.show.id, seats }),
  }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : { error: 'Cannot reach the cinema server' };
  $('book').disabled = false;
  if (!res?.ok) {
    banner(data.error ?? 'Booking failed');
    return loadMovies(); // seat counts may have changed
  }

  const { booking, member } = data;
  loyalty.update(member);
  loyalty.reset();
  if (member) loyalty.refresh();
  $('receipt').hidden = false;
  $('receipt').innerHTML = `
    <h2>Booked · BK-${booking.id}</h2>
    <div class="row"><span>${esc(selected.movie.title)}</span><span>${selected.show.startsAt}</span></div>
    <div class="row"><span>${booking.seats} seat(s)</span><span>${rupees(booking.total)}</span></div>
    <div class="row"><span>PointBridge points used</span><span>− ${rupees(booking.pointsUsed)}</span></div>
    <div class="row strong"><span>Paid</span><span>${rupees(booking.paid)}</span></div>
    <div class="row"><span>Points earned</span><span>+ ${booking.pointsEarned}</span></div>
    ${booking.loyaltyStatus === 'failed' ? '<p class="warn">Loyalty service was offline, so points were not applied to this booking.</p>' : ''}`;
  loadMovies();
  loadBookings();
});

// Enter books, like a keyboard-first app, unless the user is typing in a field.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.target.closest('input, button, textarea') && !$('book').disabled) $('book').click();
});

loadMovies();
loadBookings();
