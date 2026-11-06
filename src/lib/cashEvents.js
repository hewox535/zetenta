// Avisa a quien muestre el estado de la caja (el interruptor del menú, el POS)
// que cambió: se abrió, se cerró o se movió plata.
export const CASH_EVENT = 'zt:cash';
export const notifyCashChanged = () => window.dispatchEvent(new Event(CASH_EVENT));
