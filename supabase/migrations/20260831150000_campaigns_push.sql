/*
# Capability de campañas + notificaciones push del navegador

1) capabilities.campaigns: controla si el módulo Clientes muestra las campañas.
   Activa por defecto (negocios existentes y nuevos); el admin de la
   plataforma la apaga por negocio desde el modal de módulos.

2) Push:
   - profiles.notification_prefs: qué tipos de notificación quiere recibir el
     usuario ({"sale": bool, "low_stock": bool}); por defecto todo activo.
   - push_subscriptions: una fila por dispositivo/navegador suscrito
     (endpoint + llaves del navegador). El usuario gestiona solo las suyas;
     la Edge Function 'notify' las lee con service role para enviar.
*/

-- ---------- Campañas ----------
UPDATE businesses SET capabilities = capabilities || '{"campaigns":true}'::jsonb;
ALTER TABLE businesses ALTER COLUMN capabilities
  SET DEFAULT '{"retentions": true, "inventory": true, "orders": true, "stats": true, "customers": true, "campaigns": true}';

-- ---------- Preferencias de notificación ----------
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS notification_prefs jsonb
  NOT NULL DEFAULT '{"sale": true, "low_stock": true}';

-- ---------- Suscripciones push ----------
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid REFERENCES businesses(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions (user_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_business ON push_subscriptions (business_id);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY push_subs_select ON push_subscriptions FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY push_subs_insert ON push_subscriptions FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
CREATE POLICY push_subs_update ON push_subscriptions FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY push_subs_delete ON push_subscriptions FOR DELETE TO authenticated
  USING (user_id = auth.uid());
