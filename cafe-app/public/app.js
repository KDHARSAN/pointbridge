const $ = (id) => document.getElementById(id);
const rupees = (n) => `₹${n}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const loyalty = PointBridge.mount($('pointbridge'), { app: 'cafe', feedEl: $('feed') });
let menu = [];
const cart = new Map(); // menuId -> qty

function renderCart() {
  const lines = [...cart].map(([id, qty]) => ({ item: menu.find((m) => m.id === id), qty }));
  $('cart').innerHTML = lines.length
    ? lines.map(({ item, qty }) => `
        <li><span>${item.emoji} ${esc(item.name)}</span>
          <span class="qty">
            <button data-dec="${item.id}" aria-label="Remove one ${esc(item.name)}">−</button>${qty}<button data-inc="${item.id}" aria-label="Add one ${esc(item.name)}">+</button>
          </span><span>${rupees(item.price * qty)}</span></li>`).join('')
    : '<li class="muted">Tap a menu item to add it.</li>';
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
  if (btn) change(Number(btn.dataset.add), 1);
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
      <td>${o.id}</td>
      <td>${o.items.map((i) => `${i.qty}× ${esc(i.name)}`).join(', ')}</td>
      <td>${rupees(o.total)}</td><td>${o.pointsUsed}</td><td>${rupees(o.paid)}</td><td>${o.pointsEarned}</td>
      <td><span class="badge ${cls}">${label}</span></td></tr>`;
  }).join('') || '<tr><td colspan="7" class="muted">No orders yet</td></tr>';
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
    <h2>Receipt · Order #${order.id}</h2>
    <div class="row"><span>Total</span><span>${rupees(order.total)}</span></div>
    <div class="row"><span>PointBridge points used</span><span>− ${rupees(order.pointsUsed)}</span></div>
    <div class="row strong"><span>Paid</span><span>${rupees(order.paid)}</span></div>
    <div class="row"><span>Points earned</span><span>+ ${order.pointsEarned}</span></div>
    ${order.loyaltyStatus === 'failed' ? '<p class="warn">Loyalty service was offline, so points were not applied to this order.</p>' : ''}`;
  loadOrders();
});

(async () => {
  menu = await (await fetch('/api/menu')).json();
  $('menu').innerHTML = menu.map((m) => `
    <button class="item" data-add="${m.id}">
      <span class="emoji" aria-hidden="true">${m.emoji}</span>
      <span class="name">${esc(m.name)}</span>
      <span class="price">${rupees(m.price)}</span>
    </button>`).join('');
  renderCart();
  loadOrders();
})();
