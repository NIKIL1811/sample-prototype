TRUNCATE TABLE ai_decisions, booking_events, provider_reservations, idempotency_keys, holds, booking_items, bookings, inventory CASCADE;

-- Flight IX-6534: 3 seats total (BLR -> GOI)
INSERT INTO inventory (inventory_id, route, departure_time, arrival_time, price_inr, total_quantity, available_quantity, held_quantity, confirmed_quantity)
VALUES ('IX-6534', 'BLR-GOI', '2026-09-25 06:10:00+05:30', '2026-09-25 07:25:00+05:30', 4120.00, 3, 3, 0, 0);

-- Recovery alternatives
INSERT INTO inventory (inventory_id, route, departure_time, arrival_time, price_inr, total_quantity, available_quantity, held_quantity, confirmed_quantity)
VALUES 
('IX-6538', 'BLR-GOI', '2026-09-25 09:40:00+05:30', '2026-09-25 10:55:00+05:30', 4410.00, 2, 2, 0, 0),
('6E-511',  'BLR-GOI', '2026-09-25 13:05:00+05:30', '2026-09-25 14:20:00+05:30', 4860.00, 5, 5, 0, 0);
