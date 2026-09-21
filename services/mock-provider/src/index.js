const fastify = require('fastify')({ logger: true });

let currentMode = 'SUCCESS'; // 'SUCCESS' | 'FAIL' | 'TIMEOUT' | 'DELAY'
const reservations = new Map();

// Mode control endpoint for demo switching
fastify.post('/provider/mode', async (request, reply) => {
  const { mode } = request.body;
  currentMode = mode || 'SUCCESS';
  return { status: 'ok', currentMode };
});

// Reserve seat endpoint
fastify.post('/provider/reserve', async (request, reply) => {
  const { booking_id, flight_id } = request.body;

  if (currentMode === 'TIMEOUT') {
    // Sleep for 10 seconds to simulate a network timeout
    await new Promise((resolve) => setTimeout(resolve, 10000));
    return reply.code(504).send({ error: 'Gateway Timeout' });
  }

  if (currentMode === 'FAIL') {
    return reply.code(400).send({ error: 'Provider seat unavailable or declined' });
  }

  const reservationRef = 'MOCK-AIR-' + Math.random().toString(36).substring(2, 9).toUpperCase();
  reservations.set(booking_id, {
    reservationRef,
    flight_id,
    status: 'CONFIRMED',
    timestamp: new Date().toISOString()
  });

  return {
    status: 'CONFIRMED',
    provider_ref: reservationRef,
    booking_id
  };
});

// Status query endpoint for reconciliation worker
fastify.get('/provider/status/:booking_id', async (request, reply) => {
  const { booking_id } = request.params;
  if (reservations.has(booking_id)) {
    return { exists: true, ...reservations.get(booking_id) };
  }
  return reply.code(404).send({ exists: false, status: 'NOT_FOUND' });
});

// Cancel endpoint for compensation
fastify.post('/provider/cancel', async (request, reply) => {
  const { booking_id } = request.body;
  reservations.delete(booking_id);
  return { status: 'CANCELLED', booking_id };
});

const start = async () => {
  try {
    await fastify.listen({ port: 4000, host: '0.0.0.0' });
    console.log('Mock Provider running on port 4000');
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
