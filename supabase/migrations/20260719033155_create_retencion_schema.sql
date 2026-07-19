/*
# Esquema de la base de datos para Comprobantes de Retención de IVA

## Resumen

Crea el esquema completo para persistir los comprobantes de retención de IVA,
los proveedores (sujetos retenidos) y los datos del agente de retención.
Aplicación de un solo inquilino (sin inicio de sesión): los datos son
compartidos y las políticas permiten acceso anónimo y autenticado.

## 1. Tablas nuevas

### `empresa` (fila única)
Configuración del agente de retención. Solo existe una fila (id = 1).
- `id` integer, clave primaria, por defecto 1, con restricción CHECK (id = 1)
- `nombre` text, no nulo — razón social del agente
- `rif` text, no nulo — registro de información fiscal
- `direccion` text, no nulo — dirección fiscal
- `next_seq` integer, no nulo, por defecto 1 — secuencial del Nro. de comprobante

### `proveedores`
Listado de sujetos retenidos.
- `id` uuid, clave primaria
- `nombre` text, no nulo
- `rif` text, no nulo
- `created_at` timestamptz, por defecto now()

### `comprobantes`
Comprobantes emitidos. Las líneas de operaciones se guardan como JSON
(`lineas`) porque siempre se leen/escriben junto con el comprobante.
- `id` uuid, clave primaria
- `numero` text, no nulo, único (formato AAAAMM + secuencial de 8 dígitos)
- `periodo` text, no nulo (formato AAAAMM)
- `fecha` text, no nulo (formato visible dd/mm/yyyy)
- `proveedor_id` uuid, referencia a proveedores(id) ON DELETE SET NULL
- `proveedor_nombre` text, no nulo — snapshot histórico
- `proveedor_rif` text, no nulo — snapshot histórico
- `lineas` jsonb, no nulo, por defecto '[]' — operaciones/facturas
- `created_at` timestamptz, por defecto now()

## 2. Índices
- `comprobantes` por `periodo`
- `comprobantes` por `created_at` descendente
- `proveedores` por `rif`

## 3. Seguridad (RLS)
Aplicación de un solo inquilino SIN inicio de sesión: los datos son
intencionalmente compartidos, por lo que todas las políticas usan
`TO anon, authenticated` con `USING (true)` / `WITH CHECK (true)`.
RLS habilitado en las tres tablas, con 4 políticas (SELECT, INSERT,
UPDATE, DELETE) por tabla.

## 4. Datos iniciales
Se inserta la fila de `empresa` con los valores por defecto
(AUTO VIDRIOS DUGLARIS, C.A., RIF J-313620220).

## 5. Notas
- Sin columnas `user_id` ni `auth.uid()` porque no hay autenticación.
- `proveedor_id` usa ON DELETE SET NULL para conservar el comprobante
  aunque se elimine el proveedor; los snapshots de nombre/RIF aseguran
  que el comprobante impreso siempre muestre los datos correctos.
*/

CREATE TABLE IF NOT EXISTS empresa (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  nombre text NOT NULL DEFAULT 'AUTO VIDRIOS DUGLARIS, C.A.',
  rif text NOT NULL DEFAULT 'J-313620220',
  direccion text NOT NULL DEFAULT 'CALLE SUCRE LOCAL Nº 15-A, SECTOR BARRIO SUCRE, BARCELONA EDO. ANZOATEGUI',
  next_seq integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS proveedores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  rif text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comprobantes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  numero text NOT NULL UNIQUE,
  periodo text NOT NULL,
  fecha text NOT NULL,
  proveedor_id uuid REFERENCES proveedores(id) ON DELETE SET NULL,
  proveedor_nombre text NOT NULL,
  proveedor_rif text NOT NULL,
  lineas jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS comprobantes_periodo_idx ON comprobantes (periodo);
CREATE INDEX IF NOT EXISTS comprobantes_created_at_idx ON comprobantes (created_at DESC);
CREATE INDEX IF NOT EXISTS proveedores_rif_idx ON proveedores (rif);

ALTER TABLE empresa ENABLE ROW LEVEL SECURITY;
ALTER TABLE proveedores ENABLE ROW LEVEL SECURITY;
ALTER TABLE comprobantes ENABLE ROW LEVEL SECURITY;

-- empresa policies
DROP POLICY IF EXISTS "anon_select_empresa" ON empresa;
CREATE POLICY "anon_select_empresa" ON empresa FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_empresa" ON empresa;
CREATE POLICY "anon_insert_empresa" ON empresa FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_empresa" ON empresa;
CREATE POLICY "anon_update_empresa" ON empresa FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_empresa" ON empresa;
CREATE POLICY "anon_delete_empresa" ON empresa FOR DELETE
  TO anon, authenticated USING (true);

-- proveedores policies
DROP POLICY IF EXISTS "anon_select_proveedores" ON proveedores;
CREATE POLICY "anon_select_proveedores" ON proveedores FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_proveedores" ON proveedores;
CREATE POLICY "anon_insert_proveedores" ON proveedores FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_proveedores" ON proveedores;
CREATE POLICY "anon_update_proveedores" ON proveedores FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_proveedores" ON proveedores;
CREATE POLICY "anon_delete_proveedores" ON proveedores FOR DELETE
  TO anon, authenticated USING (true);

-- comprobantes policies
DROP POLICY IF EXISTS "anon_select_comprobantes" ON comprobantes;
CREATE POLICY "anon_select_comprobantes" ON comprobantes FOR SELECT
  TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "anon_insert_comprobantes" ON comprobantes;
CREATE POLICY "anon_insert_comprobantes" ON comprobantes FOR INSERT
  TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_comprobantes" ON comprobantes;
CREATE POLICY "anon_update_comprobantes" ON comprobantes FOR UPDATE
  TO anon, authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "anon_delete_comprobantes" ON comprobantes;
CREATE POLICY "anon_delete_comprobantes" ON comprobantes FOR DELETE
  TO anon, authenticated USING (true);

-- Fila inicial de empresa
INSERT INTO empresa (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
