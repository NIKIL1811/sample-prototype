export type BookingState = 
  | 'PENDING' 
  | 'HELD' 
  | 'RECONCILING' 
  | 'CONFIRMED' 
  | 'EXPIRED' 
  | 'FAILED' 
  | 'CANCELLED';

export interface InventoryRow {
  inventory_id: string;
  route: string;
  departure_time: string;
  arrival_time: string;
  price_inr: string;
  total_quantity: number;
  available_quantity: number;
  held_quantity: number;
  confirmed_quantity: number;
}
