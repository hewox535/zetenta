import { useCallback, useState } from 'react';
import { useBranch } from '../context/BranchContext';

// Filtro de sucursal para los listados (ventas, inventario, gastos, cuentas).
// Solo aparece si el usuario ve más de una sucursal; el servidor ya oculta las
// que no le corresponden, así que "Todas" son todas las suyas.
export function useBranchFilter() {
  const { viewBranches, branchById } = useBranch();
  const [value, setValue] = useState('all');
  const show = viewBranches.length > 1;
  const match = useCallback((id) => value === 'all' || id === value, [value]);
  const nameOf = useCallback((id) => branchById.get(id)?.name || '', [branchById]);
  return { show, value, setValue, match, nameOf, options: viewBranches, id: value === 'all' ? null : value };
}

export function BranchSelect({ filter, className = 'fin-select' }) {
  if (!filter.show) return null;
  return (
    <select className={className} value={filter.value} onChange={(e) => filter.setValue(e.target.value)} aria-label="Sucursal">
      <option value="all">Todas las sucursales</option>
      {filter.options.map((b) => <option key={b.id} value={b.id}>{b.name}{b.active ? '' : ' (inactiva)'}</option>)}
    </select>
  );
}
