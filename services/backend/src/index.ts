import Fastify from 'fastify';
import { Pool } from 'pg';
import Redis from 'ioredis';
import { BookingState, InventoryRow } from './types';

const fastify = Fastify({ logger: true });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://bookguard:bookguard_secret@localhost:5432/bookguard'
});

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

// 1. Availability endpoint (reads from read-only view)
fastify.get('/api/availability', async (request, reply) => {
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT * FROM v_inventory');
    return { inventory: result.rows };
  } finally {
    client.release();
  }
});

// 2. Hold endpoint (Postgres row lock + Redis hold TTL)
fastify.post('/api/hold', async (request, reply) => {
  const { inventory_id, traveller_name, contact_phone, language = 'en' } = request.body as any;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Row-level lock on inventory
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

    // Decrement available, increment held
    await client.query(
      `UPDATE inventory 
       SET available_quantity = available_quantity - 1, 
           held_quantity = held_quantity + 1 
       WHERE inventory_id = $1`,
      [inventory_id]
    );

    const bookingId = 'BG-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const holdId = 'HOLD-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min TTL

    // Create booking in HELD state
    await client.query(
      `INSERT INTO bookings (booking_id, state, traveller_name, contact_phone, language, total_amount)
       VALUES ($1, 'HELD', $2, $3, $4, $5)`,
      [bookingId, traveller_name, contact_phone, language, inv.price_inr]
    );

    // Store hold record
    await client.query(
      `INSERT INTO holds (hold_id, booking_id, inventory_id, qty, expires_at, state)
       VALUES ($1, $2, $3, 1, $4, 'ACTIVE')`,
      [holdId, bookingId, inventory_id, expiresAt]
    );

    // Append audit log
    await client.query(
      `INSERT INTO booking_events (booking_id, from_state, to_state, reason, evidence)
       VALUES ($1, 'PENDING', 'HELD', 'Traveller initiated hold', $2)`,
      [bookingId, JSON.stringify({ holdId, expiresAt })]
    );

    // Store Redis expiring key (10 minutes)
    await redis.set(`hold:${bookingId}`, holdId, 'EX', 600);

    await client.query('COMMIT');

    return {
      booking_id: bookingId,
      hold_id: holdId,
      expires_at: expiresAt.toISOString(),
      state: 'HELD'
    };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error(err);
    return reply.code(500).send({ error: 'Internal reservation failure' });
  } finally {
    client.release();
  }
});

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
