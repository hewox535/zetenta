import { supabase } from './supabaseClient';

// Capa de acceso a datos. La BD usa snake_case; la app usa camelCase.
// Esta capa traduce entre ambos y centraliza el CRUD.

const DEFAULT_EMPRESA = {
  nombre: 'AUTO VIDRIOS DUGLARIS, C.A.',
  rif: 'J-313620220',
  direccion: 'CALLE SUCRE LOCAL Nº 15-A, SECTOR BARRIO SUCRE, BARCELONA EDO. ANZOATEGUI',
  nextSeq: 1,
};

// --- Empresa ---

export async function fetchEmpresa() {
  const { data, error } = await supabase
    .from('empresa')
    .select('id, nombre, rif, direccion, next_seq')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ...DEFAULT_EMPRESA };
  return {
    nombre: data.nombre,
    rif: data.rif,
    direccion: data.direccion,
    nextSeq: data.next_seq,
  };
}

export async function saveEmpresa(empresa) {
  const { error } = await supabase
    .from('empresa')
    .upsert({
      id: 1,
      nombre: empresa.nombre,
      rif: empresa.rif,
      direccion: empresa.direccion,
      next_seq: empresa.nextSeq,
    });
  if (error) throw error;
}

// --- Proveedores ---

export async function fetchProveedores() {
  const { data, error } = await supabase
    .from('proveedores')
    .select('id, nombre, rif, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((p) => ({
    id: p.id,
    nombre: p.nombre,
    rif: p.rif,
    createdAt: p.created_at,
  }));
}

export async function insertProveedor({ nombre, rif }) {
  const { data, error } = await supabase
    .from('proveedores')
    .insert({ nombre, rif })
    .select('id, nombre, rif, created_at')
    .single();
  if (error) throw error;
  return { id: data.id, nombre: data.nombre, rif: data.rif, createdAt: data.created_at };
}

export async function deleteProveedor(id) {
  const { error } = await supabase.from('proveedores').delete().eq('id', id);
  if (error) throw error;
}

// --- Comprobantes ---

export async function fetchComprobantes() {
  const { data, error } = await supabase
    .from('comprobantes')
    .select('id, numero, periodo, fecha, proveedor_id, proveedor_nombre, proveedor_rif, lineas, created_at')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((c) => ({
    id: c.id,
    numero: c.numero,
    periodo: c.periodo,
    fecha: c.fecha,
    proveedorId: c.proveedor_id,
    proveedorNombre: c.proveedor_nombre,
    proveedorRif: c.proveedor_rif,
    lineas: c.lineas || [],
    createdAt: c.created_at,
  }));
}

export async function insertComprobante(comprobante) {
  const { data, error } = await supabase
    .from('comprobantes')
    .insert({
      id: comprobante.id,
      numero: comprobante.numero,
      periodo: comprobante.periodo,
      fecha: comprobante.fecha,
      proveedor_id: comprobante.proveedorId,
      proveedor_nombre: comprobante.proveedorNombre,
      proveedor_rif: comprobante.proveedorRif,
      lineas: comprobante.lineas,
    })
    .select('id, numero, periodo, fecha, proveedor_id, proveedor_nombre, proveedor_rif, lineas, created_at')
    .single();
  if (error) throw error;
  return {
    id: data.id,
    numero: data.numero,
    periodo: data.periodo,
    fecha: data.fecha,
    proveedorId: data.proveedor_id,
    proveedorNombre: data.proveedor_nombre,
    proveedorRif: data.proveedor_rif,
    lineas: data.lineas || [],
    createdAt: data.created_at,
  };
}

export async function deleteComprobante(id) {
  const { error } = await supabase.from('comprobantes').delete().eq('id', id);
  if (error) throw error;
}
