import http from 'k6/http';
import { check } from 'k6';

export const options = {
  vus: 10,
  iterations: 10,
};

export default function () {
  const payload = JSON.stringify({
    inventory_id: 'IX-6534',
    traveller_name: `Tester-${__VU}`,
    contact_phone: '+919999999999',
    language: 'en'
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const res = http.post('http://localhost:3000/api/hold', payload, params);

  check(res, {
    'status is 200 or 409': (r) => r.status === 200 || r.status === 409,
  });
}
