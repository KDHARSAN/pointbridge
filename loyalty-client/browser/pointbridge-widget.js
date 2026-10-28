// PointBridge member widget: the browser half of loyalty-client. Every partner app serves this file
// and mounts it, so customers get the same loyalty card everywhere. It only talks to its host app's
// own server (/api/member, /api/live); the host server is what calls the Loyalty Service.
(() => {
  const APPS = { cafe: 'Café', cinema: 'Cinema' };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function describe(evt) {
    const who = esc(evt.member?.name ?? evt.phone);
    const where = APPS[evt.source] ?? esc(evt.source);
    const pts = Number(evt.points) || 0; // the bus accepts any JSON, so never trust event fields as HTML
    if (evt.type === 'PointsEarned') return `<b>${who}</b> earned <b>${pts}</b> pts at ${where}`;
    if (evt.type === 'PointsRedeemed') return `<b>${who}</b> spent <b>${pts}</b> pts at ${where}`;
    if (evt.type === 'MemberEnrolled') return `<b>${who}</b> joined PointBridge at ${where}`;
    return esc(evt.type);
  }

  function mount(el, { app, feedEl }) {
    el.classList.add('pb');
    el.innerHTML = `
      <div class="pb-head"><span class="pb-logo">◆ PointBridge</span><span class="pb-live"><span class="pb-dot"></span><span class="pb-live-text">connecting…</span></span></div>
      <label class="pb-field">Customer phone
        <input class="pb-phone" inputmode="numeric" maxlength="10" placeholder="10-digit mobile" autocomplete="off" />
      </label>
      <div class="pb-card" hidden>
        <div><div class="pb-name"></div><span class="pb-tier"></span></div>
        <div class="pb-balance-wrap"><div class="pb-balance">0</div><div class="pb-unit">points</div></div>
      </div>
      <label class="pb-field pb-new" hidden>New to PointBridge? Name to join
        <input class="pb-name-input" placeholder="Customer name" />
      </label>
      <label class="pb-use"><input type="checkbox" class="pb-use-box" /> Use points (1 pt = ₹1 off)</label>
      <div class="pb-msg" role="status"></div>`;

    const $ = (s) => el.querySelector(s);
    let phone = '';
    let member = null;

    function show(next, { flash = false } = {}) {
      member = next;
      $('.pb-card').hidden = !member;
      $('.pb-new').hidden = !!member || phone.length !== 10;
      if (!member) return;
      $('.pb-name').textContent = member.name;
      $('.pb-tier').textContent = member.tier;
      $('.pb-tier').className = `pb-tier ${member.tier === 'Gold' ? 'gold' : ''}`;
      $('.pb-balance').textContent = member.balance;
      if (flash) {
        $('.pb-card').classList.remove('pb-flash');
        void $('.pb-card').offsetWidth; // restart the animation
        $('.pb-card').classList.add('pb-flash');
      }
    }

    const message = (text) => { $('.pb-msg').textContent = text ?? ''; };

    async function lookup() {
      message('');
      if (phone.length !== 10) return show(null);
      const res = await fetch(`/api/member/${phone}`).catch(() => null);
      if (!res) return message(`Can't reach the ${APPS[app]} server.`);
      if (res.status === 404) { show(null); return message('Not a member yet — add a name and they join on checkout.'); }
      if (!res.ok) { show(null); return message('Loyalty service offline — orders still go through, without points.'); }
      show(await res.json());
    }

    $('.pb-phone').addEventListener('input', (e) => {
      e.target.value = e.target.value.replace(/\D/g, '');
      phone = e.target.value;
      lookup();
    });

    // Live updates relayed by this app's server from the Event Bus.
    const feed = [];
    const source = new EventSource('/api/live');
    source.onmessage = (msg) => {
      const evt = JSON.parse(msg.data);
      if (evt.type === 'BusStatus') {
        $('.pb-dot').classList.toggle('on', evt.connected);
        $('.pb-live-text').textContent = evt.connected ? 'live' : 'offline';
        if (evt.connected) lookup(); // catch up on anything missed while disconnected
        return;
      }
      if (evt.phone === phone && evt.member) show(evt.member, { flash: evt.source !== app });
      if (!feedEl) return;
      feed.unshift(evt);
      feed.length = Math.min(feed.length, 15);
      feedEl.innerHTML = feed.map((e) => `
        <li class="${e.source === app ? 'pb-own' : 'pb-partner'}">
          <span class="pb-src">${APPS[e.source] ?? esc(e.source)}</span> ${describe(e)}
          <small>${new Date(e.at).toLocaleTimeString()}</small>
        </li>`).join('');
    };
    source.onerror = () => { $('.pb-dot').classList.remove('on'); $('.pb-live-text').textContent = 'offline'; };

    return {
      customer: () => ({ phone, name: $('.pb-name-input').value.trim(), usePoints: $('.pb-use-box').checked && !!member }),
      update: (next) => { if (next) show(next); },
      refresh: lookup,
      reset() {
        $('.pb-use-box').checked = false;
        $('.pb-name-input').value = '';
      },
    };
  }

  window.PointBridge = { mount };
})();
