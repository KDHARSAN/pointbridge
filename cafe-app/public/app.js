const $ = (id) => document.getElementById(id);
const rupees = (n) => `₹${n}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const loyalty = PointBridge.mount($('pointbridge'), { app: 'cafe', feedEl: $('feed') });

// Thin line drawings in the house style: grey strokes, one pink detail.
const STROKE = 'fill="none" stroke="#4a4a4a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  cup: `<svg viewBox="0 0 56 56" aria-hidden="true"><g ${STROKE}><path d="M12 22h28l-3 22a5 5 0 0 1-5 4H20a5 5 0 0 1-5-4z"/><path d="M40 27h4a5 5 0 0 1 0 10h-5"/></g><path d="M22 16c-2-3 2-5 0-8M29 16c-2-3 2-5 0-8" fill="none" stroke="#ff0083" stroke-width="2" stroke-linecap="round"/></svg>`,
  glass: `<svg viewBox="0 0 56 56" aria-hidden="true"><g ${STROKE}><path d="M15 12h26l-4 34a4 4 0 0 1-4 3H23a4 4 0 0 1-4-3z"/><path d="M33 6l-4 18"/></g><rect x="21" y="26" width="6" height="6" rx="1.5" fill="none" stroke="#ff0083" stroke-width="2"/><rect x="28" y="32" width="6" height="6" rx="1.5" fill="none" stroke="#ff0083" stroke-width="2"/></svg>`,
  pastry: `<svg viewBox="0 0 56 56" aria-hidden="true"><g ${STROKE}><path d="M14 30h28l-4 16H18z"/><path d="M12 30c0-9 7-15 16-15s16 6 16 15"/></g><circle cx="22" cy="22" r="1.8" fill="#ff0083"/><circle cx="30" cy="20" r="1.8" fill="#ff0083"/><circle cx="35" cy="25" r="1.8" fill="#ff0083"/></svg>`,
  sandwich: `<svg viewBox="0 0 56 56" aria-hidden="true"><g ${STROKE}><path d="M8 34L28 14l20 20z"/><path d="M8 34v6h40v-6"/></g><path d="M14 34c4-3 8 3 12 0s8 3 12 0 6 2 8 0" fill="none" stroke="#ff0083" stroke-width="2" stroke-linecap="round"/></svg>`,
};
const iconFor = (name) => /brew/i.test(name) ? ICONS.glass
  : /muffin|brownie/i.test(name) ? ICONS.pastry
  : /sandwich/i.test(name) ? ICONS.sandwich : ICONS.cup;

// The barista's line in the chat bubble.
function say(text) {
  const bubble = $('bubble');
  bubble.textContent = text;
  bubble.style.animation = 'none';
  void bubble.offsetWidth;
  bubble.style.animation = '';
}
setTimeout(() => say("Hi, I'm Bea! What can I get you today?"), 900);

addEventListener('scroll', () => document.querySelector('.nav').classList.toggle('scrolled', scrollY > 8), { passive: true });
let menu = [];
const cart = new Map(); // menuId -> qty

function renderCart() {
  const lines = [...cart].map(([id, qty]) => ({ item: menu.find((m) => m.id === id), qty }));
  $('cart').innerHTML = lines.length
    ? lines.map(({ item, qty }) => `
        <li><span>${esc(item.name)}</span>
          <span class="qty">
            <button data-dec="${item.id}" aria-label="Remove one ${esc(item.name)}">−</button>${qty}<button data-inc="${item.id}" aria-label="Add one ${esc(item.name)}">+</button>
          </span><span>${rupees(item.price * qty)}</span></li>`).join('')
    : '<li class="empty">Nothing here yet. Tap something on the menu.</li>';
  $('total').textContent = rupees(lines.reduce((s, l) => s + l.item.price * l.qty, 0));
  $('place').disabled = lines.length === 0;
}

function change(id, delta) {
  const qty = (cart.get(id) ?? 0) + delta;
  if (qty <= 0) cart.delete(id); else cart.set(id, Math.min(qty, 20));
  renderCart();
}

$('menu').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-add]');
  if (!btn) return;
  const first = cart.size === 0;
  change(Number(btn.dataset.add), 1);
  btn.classList.remove('bump');
  void btn.offsetWidth;
  btn.classList.add('bump');
  if (first) say('Great choice! Add anything else, then pop in a phone number to collect points.');
});
$('cart').addEventListener('click', (e) => {
  if (e.target.dataset.inc) change(Number(e.target.dataset.inc), 1);
  if (e.target.dataset.dec) change(Number(e.target.dataset.dec), -1);
});

const STATUS = { ok: ['ok', 'points applied'], failed: ['failed', 'points not applied'], none: ['none', 'guest'], pending: ['failed', 'pending'] };

async function loadOrders() {
  const orders = await (await fetch('/api/orders')).json();
  $('orders').innerHTML = orders.map((o) => {
    const [cls, label] = STATUS[o.loyaltyStatus] ?? ['none', o.loyaltyStatus];
    return `<tr>
      <td>#${o.id}</td>
      <td>${o.items.map((i) => `${i.qty}× ${esc(i.name)}`).join(', ')}</td>
      <td>${rupees(o.total)}</td><td>${o.pointsUsed}</td><td>${rupees(o.paid)}</td><td>${o.pointsEarned}</td>
      <td><span class="badge ${cls}">${label}</span></td></tr>`;
  }).join('') || '<tr><td colspan="7">No orders yet. The first cup is on its way.</td></tr>';
}

function banner(text) {
  $('banner').textContent = text ?? '';
  $('banner').hidden = !text;
}

$('place').addEventListener('click', async () => {
  banner(null);
  $('place').disabled = true;
  const { phone, name, usePoints } = loyalty.customer();
  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, name, usePoints, items: [...cart].map(([menuId, qty]) => ({ menuId, qty })) }),
  }).catch(() => null);
  const data = res ? await res.json().catch(() => ({})) : { error: 'Cannot reach the café server' };
  $('place').disabled = false;
  if (!res?.ok) return banner(data.error ?? 'Order failed');

  const { order, member } = data;
  loyalty.update(member);
  loyalty.reset();
  if (member) loyalty.refresh();
  cart.clear();
  renderCart();
  $('receipt').hidden = false;
  $('receipt').innerHTML = `
    <h2>Order #${order.id} is on its way</h2>
    <div class="row"><span>Total</span><span>${rupees(order.total)}</span></div>
    <div class="row"><span>PointBridge points used</span><span>− ${rupees(order.pointsUsed)}</span></div>
    <div class="row strong"><span>Paid</span><span>${rupees(order.paid)}</span></div>
    <div class="row"><span>Points earned</span><span>+ ${order.pointsEarned}</span></div>
    ${order.loyaltyStatus === 'failed' ? '<p class="warn">Loyalty service was offline, so points were not applied to this order.</p>' : ''}`;
  say(order.pointsEarned
    ? `All done! That earned ${order.pointsEarned} points, and you can spend them at the cinema too.`
    : 'All done! Your order is on its way.');
  loadOrders();
});

(async () => {
  menu = await (await fetch('/api/menu')).json();
  $('menu').innerHTML = menu.map((m) => `
    <button class="item" data-add="${m.id}" aria-label="Add ${esc(m.name)}, ${rupees(m.price)}">
      ${iconFor(m.name)}
      <span class="name">${esc(m.name)}</span>
      <span class="price">${rupees(m.price)}</span>
      <span class="add" aria-hidden="true">+</span>
    </button>`).join('');
  renderCart();
  loadOrders();
})();
