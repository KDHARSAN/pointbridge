// Fire-and-forget: a dead event bus must never fail a points change (the ledger already has it).
export function createPublisher(busUrl) {
  return (evt) => {
    fetch(`${busUrl}/publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(evt),
    }).catch((err) => console.warn(`[publish] ${evt.type} ${evt.phone} not delivered: ${err.message}`));
  };
}
