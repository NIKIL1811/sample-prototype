import React, { useState, useEffect } from 'react';
import en from './locales/en.json';
import kn from './locales/kn.json';

const translations: Record<string, any> = { en, kn };

export default function App() {
  const [lang, setLang] = useState<'en' | 'kn'>('kn');
  const [inventory, setInventory] = useState<any[]>([]);
  const [activeHold, setActiveHold] = useState<any>(null);
  const [timeLeft, setTimeLeft] = useState(600); // 10 min hold TTL
  const t = translations[lang];

  useEffect(() => {
    fetch('http://localhost:3000/api/availability')
      .then((res) => res.json())
      .then((data) => setInventory(data.inventory || []))
      .catch(() => {});
  }, []);

  const handleHold = async (item: any) => {
    const res = await fetch('http://localhost:3000/api/hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inventory_id: item.inventory_id,
        traveller_name: 'Priya S.',
        contact_phone: '+91 9876543210',
        language: lang
      })
    });
    const data = await res.json();
    if (res.ok) {
      setActiveHold(data);
      setTimeLeft(600);
    } else {
      alert(data.error || 'Failed to hold seat');
    }
  };

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 600, margin: '40px auto', padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>{t.title}</h2>
        <div>
          <button onClick={() => setLang('en')} style={{ fontWeight: lang === 'en' ? 'bold' : 'normal' }}>EN</button>
          <button onClick={() => setLang('kn')} style={{ marginLeft: 8, fontWeight: lang === 'kn' ? 'bold' : 'normal' }}>ಕನ್ನಡ</button>
        </div>
      </div>

      {!activeHold ? (
        <div>
          <h3>Bengaluru (BLR) → Goa (GOI)</h3>
          <p>Date: 25 Sep 2026</p>
          {inventory.map((item) => (
            <div key={item.inventory_id} style={{ border: '1px solid #ccc', padding: 16, borderRadius: 8, marginBottom: 12 }}>
              <h4>{item.inventory_id} · 06:10 → 07:25</h4>
              <p><strong>{item.available_quantity} {t.seatsLeft}</strong></p>
              <p>₹{item.price_inr}</p>
              <button 
                onClick={() => handleHold(item)}
                disabled={item.available_quantity < 1}
                style={{ padding: '8px 16px', cursor: 'pointer', background: '#0066cc', color: '#fff', border: 'none', borderRadius: 4 }}>
                {t.holdSeat}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ border: '1px solid #00aa00', padding: 20, borderRadius: 8, background: '#f0fff0' }}>
          <h3>1 seat · {t.heldMessage}</h3>
          <p>Booking ID: <strong>{activeHold.booking_id}</strong></p>
          <p>Expires in: <strong>{Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}</strong></p>
          <button style={{ padding: '10px 20px', background: '#28a745', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
            {t.confirmBooking}
          </button>
        </div>
      )}
    </div>
  );
}
