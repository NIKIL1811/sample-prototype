import Fastify from 'fastify';
import { Pool } from 'pg';
import Redis from 'ioredis';
import crypto from 'crypto';
import { BookingState, InventoryRow } from './types';

const fastify = Fastify({ logger: true });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://bookguard:bookguard_secret@localhost:5432/bookguard'
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
const MOCK_PROVIDER_URL = process.env.MOCK_PROVIDER_URL || 'http://localhost:4000';

// 1. Availability View Lookup
fastify.get('/api/availability', async (request, reply) => {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM v_inventory');
    return { inventory: result.rows };
  } finally {
    client.release();
  }
});

// 2. Seat Hold (SELECT FOR UPDATE row-level lock)
fastify.post('/api/hold', async (request, reply) => {
  const { inventory_id, traveller_name, contact_phone, language = 'en' } = request.body as any;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const invRes = await client.query(
      'SELECT * FROM inventory WHERE inventory_id = $1 FOR UPDATE',
      [inventory_id]
    );

    if (invRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return reply.code(404).send({ error: 'Resource not found' });
    }

    const inv: InventoryRow = invRes.rows[0];
    if (inv.available_quantity < 1) {
      await client.query('ROLLBACK');
      return reply.code(409).send({ error: 'No seats available' });
    }

    await client.query(
      `UPDATE inventory 
       SET available_quantity = available_quantity - 1, 
           held_quantity = held_quantity + 1 
       WHERE inventory_id = $1`,
      [inventory_id]
    );

    const bookingId = 'BG-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const holdId = 'HOLD-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10-min hold

    await client.query(
      `INSERT INTO bookings (booking_id, state, traveller_name, contact_phone, language, total_amount)
       VALUES ($1, 'HELD', $2, $3, $4, $5)`,
      [bookingId, traveller_name, contact_phone, language, inv.price_inr]
    );

    await client.query(
      `INSERT INTO booking_items (booking_id, inventory_id, leg_order, status)
       VALUES ($1, $2, 1, 'HELD')`,
      [bookingId, inventory_id]
    );

    await client.query(
      `INSERT INTO holds (hold_id, booking_id, inventory_id, qty, expires_at, state)
       VALUES ($1, $2, $3, 1, $4, 'ACTIVE')`,
      [holdId, bookingId, inventory_id, expiresAt]
    );

    await client.query(
      `INSERT INTO booking_events (booking_id, from_state, to_state, reason, evidence)
       VALUES ($1, 'PENDING', 'HELD', 'User reserved hold', $2)`,
      [bookingId, JSON.stringify({ holdId, expiresAt })]
    );

    await redis.set(`hold:${bookingId}`, holdId, 'EX', 600);

    await client.query('COMMIT');
    return { booking_id: bookingId, hold_id: holdId, expires_at: expiresAt.toISOString(), state: 'HELD' };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error(err);
    return reply.code(500).send({ error: 'Hold transaction failed' });
  } finally {
    client.release();
  }
});

// 3. Confirm Booking with Idempotency Key & Provider Call
fastify.post('/api/confirm', async (request, reply) => {
  const { booking_id } = request.body as any;
  const idempotencyKey = request.headers['idempotency-key'] as string || `key-${bookingIdFallback(booking_id)}`;
  const reqHash = crypto.createHash('sha256').update(JSON.stringify(request.body)).digest('hex');

  const client = await pool.connect();
  try {
    // Check existing idempotency record
    const idemCheck = await client.query('SELECT * FROM idempotency_keys WHERE key = $1', [idempotencyKey]);
    if (idemCheck.rows.length > 0) {
      return reply.send(idemCheck.rows[0].response_body);
    }

    const bRes = await client.query('SELECT * FROM bookings WHERE booking_id = $1', [booking_id]);
    if (bRes.rows.length === 0) return reply.code(404).send({ error: 'Booking not found' });
    const booking = bRes.rows[0];

    if (booking.state !== 'HELD') {
      return reply.code(400).send({ error: `Cannot confirm booking in state ${booking.state}` });
    }

    // Call Mock Airline Provider with 3s timeout
    let providerSuccess = false;
    let providerRef = null;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const pRes = await fetch(`${MOCK_PROVIDER_URL}/provider/reserve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ booking_id, flight_id: 'IX-6534' }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (pRes.ok) {
        const data: any = await pRes.json();
        providerSuccess = true;
        providerRef = data.provider_ref;
      }
    } catch (e) {
      fastify.log.warn(`Provider call timed out or failed for ${booking_id}`);
    }

    await client.query('BEGIN');

    if (providerSuccess) {
      // Transition HELD -> CONFIRMED
      await client.query('UPDATE bookings SET state = $1, updated_at = NOW() WHERE booking_id = $2', ['CONFIRMED', booking_id]);
      await client.query(
        `UPDATE inventory SET held_quantity = held_quantity - 1, confirmed_quantity = confirmed_quantity + 1
         WHERE inventory_id = (SELECT inventory_id FROM booking_items WHERE booking_id = $1 LIMIT 1)`,
        [booking_id]
      );
      await client.query('UPDATE holds SET state = $1 WHERE booking_id = $2', ['REDEEMED', booking_id]);
      await client.query(
        'INSERT INTO provider_reservations (booking_id, provider, provider_ref, provider_status) VALUES ($1, $2, $3, $4)',
        [booking_id, 'AirIndiaExpress-Mock', providerRef, 'CONFIRMED']
      );
      await client.query(
        'INSERT INTO booking_events (booking_id, from_state, to_state, reason, evidence) VALUES ($1, $2, $3, $4, $5)',
        [booking_id, 'HELD', 'CONFIRMED', 'Provider reservation confirmed', JSON.stringify({ providerRef })]
      );

      const responseData = { status: 'CONFIRMED', booking_id, provider_ref: providerRef };
      await client.query(
        'INSERT INTO idempotency_keys (key, request_hash, booking_id, response_body) VALUES ($1, $2, $3, $4)',
        [idempotencyKey, reqHash, booking_id, responseData]
      );
      await client.query('COMMIT');
      return responseData;
    } else {
      // Transition HELD -> RECONCILING (Protected state for worker)
      await client.query('UPDATE bookings SET state = $1, updated_at = NOW() WHERE booking_id = $2', ['RECONCILING', booking_id]);
      await client.query(
        'INSERT INTO booking_events (booking_id, from_state, to_state, reason, evidence) VALUES ($1, $2, $3, $4, $5)',
        [booking_id, 'HELD', 'RECONCILING', 'Provider timeout - entering async reconciliation', JSON.stringify({})]
      );

      const responseData = { status: 'RECONCILING', booking_id, message: 'Verifying reservation status with airline' };
      await client.query(
        'INSERT INTO idempotency_keys (key, request_hash, booking_id, response_body) VALUES ($1, $2, $3, $4)',
        [idempotencyKey, reqHash, booking_id, responseData]
      );
      await client.query('COMMIT');
      return reply.code(202).send(responseData);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error(err);
    return reply.code(500).send({ error: 'Confirmation failed' });
  } finally {
    client.release();
  }
});

function bookingIdFallback(id: string) {
  return id || Math.random().toString(36).substring(2, 9);
}

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`BookGuard Backend running on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
