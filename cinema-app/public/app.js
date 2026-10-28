const $ = (id) => document.getElementById(id);
const rupees = (n) => `₹${n}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const loyalty = PointBridge.mount($('pointbridge'), { app: 'cinema', feedEl: $('feed') });
let movies = [];
let selected = null; // { movie, show }
let seats = 2;

function renderMovies() {
  $('movies').innerHTML = movies.map((m) => `
    <article class="movie">
      <div class="poster" aria-hidden="true">${m.poster}</div>
      <div class="info">
        <h3>${esc(m.title)}</h3>
        <p class="muted">${esc(m.genre)} · ${Math.floor(m.minutes / 60)}h ${m.minutes % 60}m</p>
        <div class="times">
          ${m.shows.map((s) => `
            <button class="time ${selected?.show.id === s.id ? 'on' : ''}" data-show="${s.id}" ${s.seatsLeft === 0 ? 'disabled' : ''}>
              ${s.startsAt}<small>${rupees(s.price)} · ${s.seatsLeft} left</small>
            </button>`).join('')}
        </div>
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
  $('selection').innerHTML = `<strong>${movie.poster} ${esc(movie.title)}</strong><br><span class="muted">${show.startsAt} · ${rupees(show.price)} per seat · ${show.seatsLeft} left</span>`;
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
    return `<tr><td>${b.id}</td><td>${b.poster} ${esc(b.title)}</td><td>${b.startsAt}</td><td>${b.seats}</td>
      <td>${rupees(b.total)}</td><td>${b.pointsUsed}</td><td>${rupees(b.paid)}</td><td>${b.pointsEarned}</td>
      <td><span class="badge ${cls}">${label}</span></td></tr>`;
  }).join('') || '<tr><td colspan="9" class="muted">No bookings yet</td></tr>';
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
    <h2>Ticket · Booking #${booking.id}</h2>
    <div class="row"><span>${selected.movie.poster} ${esc(selected.movie.title)}</span><span>${selected.show.startsAt}</span></div>
    <div class="row"><span>${booking.seats} seat(s)</span><span>${rupees(booking.total)}</span></div>
    <div class="row"><span>PointBridge points used</span><span>− ${rupees(booking.pointsUsed)}</span></div>
    <div class="row strong"><span>Paid</span><span>${rupees(booking.paid)}</span></div>
    <div class="row"><span>Points earned</span><span>+ ${booking.pointsEarned}</span></div>
    ${booking.loyaltyStatus === 'failed' ? '<p class="warn">Loyalty service was offline, so points were not applied to this booking.</p>' : ''}`;
  loadMovies();
  loadBookings();
});

loadMovies();
loadBookings();
