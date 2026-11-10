// =====================================================================
// Funciones compartidas entre el formulario (app-nube.js) y el panel.
// =====================================================================

// Debe coincidir con la lista de firestore.rules
export const ADMINS = ['eldiego87@gmail.com'];

export const SEDES_SELECTS = ['nefroargINPUT', 'itacINPUT', 'sancaINPUT', 'militarINPUT'];

// "Nefrología Argentina " -> "NEFROLOGIA-ARGENTINA" (sirve como id en la base)
export function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function claveSede(empresa, sede) {
  return `${normalizar(empresa)}__${normalizar(sede) || 'GENERAL'}`;
}

// ---------------------------------------------------------------------
// Qué se mide: id del campo -> nombre para mostrar y unidad
// ---------------------------------------------------------------------
export const PRESIONES_PRE = [
  ['pressBomba', 'Bomba presurizadora'],
  ['pressFS', 'Filtro sedimentos'],
  ['pressFCA1', 'Carbón activado 1'],
  ['pressFCA2', 'Carbón activado 2'],
  ['pressFARC', 'Ablandador'],
  ['pressFDRA', 'Desnitrificador'],
  ['pressFPRE', 'Pre ósmosis']
];
export const PRESIONES_OSMOSIS = [
  ['pressALIM', 'Alimentación'],
  ['pressINMEM', 'Entrada membrana'],
  ['pressOUTMEM', 'Salida membrana'],
  ['pressLOOP', 'Loop'],
  ['pressRETORNO', 'Retorno']
];

// Umbrales: los mismos que usa el PDF para los íconos OK / peligro / falla
export const UMBRALES = {
  // valor >= desde → estado
  rechazo: [{ desde: 96, estado: 'ok' }, { desde: 90, estado: 'peligro' }, { desde: -Infinity, estado: 'falla' }],
  // valor <= hasta → estado
  condOUT: [{ hasta: 10, estado: 'ok' }, { hasta: 20, estado: 'medio' }, { hasta: 30, estado: 'peligro' }, { hasta: Infinity, estado: 'falla' }],
  dureza:  [{ hasta: 20, estado: 'ok' }, { hasta: 60, estado: 'peligro' }, { hasta: Infinity, estado: 'falla' }],
  cloro:   [{ hasta: 0.05, estado: 'ok' }, { hasta: 0.15, estado: 'peligro' }, { hasta: Infinity, estado: 'falla' }]
};

export function estadoDe(medida, valor) {
  if (valor == null || isNaN(valor)) return null;
  const tabla = UMBRALES[medida];
  if (!tabla) return null;
  const fila = 'desde' in tabla[0]
    ? tabla.find(f => valor >= f.desde)
    : tabla.find(f => valor <= f.hasta);
  return fila ? fila.estado : null;
}

// ---------------------------------------------------------------------
// Formulario (campos crudos) -> registro para el historial
// ---------------------------------------------------------------------
function numero(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

// "NEG" → 0 ; número → número ; otra cosa → null
function quimico(v) {
  const t = String(v || '').trim().toUpperCase();
  if (t === 'NEG') return 0;
  return numero(t);
}

// Identifica empresa + sede. "frecuente" = elegida de los desplegables.
export function sedeDelFormulario(campos, sedesConOpciones) {
  const empTxt = (campos.nombreEmpresa || '').trim();
  const empSel = campos.empresaINPUT || '';
  const sedeTxt = (campos.nombreClinica || '').trim();
  const sedeSel = SEDES_SELECTS.map(id => campos[id]).find(Boolean) || '';
  const empresa = empTxt || empSel;
  const sede = sedeTxt || sedeSel;
  const empresaTieneSedes = sedesConOpciones.has(empSel);
  const frecuente = !empTxt && !!empSel && !sedeTxt && (!!sedeSel || !empresaTieneSedes);
  return { empresa, sede, frecuente, sedeKey: claveSede(empresa, sede), empresaKey: normalizar(empresa) };
}

export function registroDelFormulario(campos) {
  const v = {};
  [...PRESIONES_PRE, ...PRESIONES_OSMOSIS].forEach(([id]) => { v[id] = numero(campos[id]); });
  v.condIN = numero(campos.condIN);
  v.condOUT = numero(campos.condOUT);

  // Rechazo: solo si entrada y salida están en la misma unidad
  const mismaUnidad = (campos.unidadcondIN || 'µS/cm') === (campos.unidadcondOUT || 'µS/cm');
  v.rechazo = (mismaUnidad && v.condIN > 0 && v.condOUT != null)
    ? Math.round(((v.condIN - v.condOUT) / v.condIN) * 1000) / 10
    : null;
  // Rechazo que muestra el equipo (campo "Rechazo registrado")
  v.rechazoEquipo = numero(campos.rechazo);

  // Caudales: todo a litros por hora
  const aLh = (valor, unidad) => valor == null ? null : (unidad === 'L/m' ? valor * 60 : valor);
  v.caudalPERM = aLh(numero(campos.caudalPERM), campos.unidadCaudalPerm || 'L/m');
  v.caudalCONC = aLh(numero(campos.caudalCONC), campos.unidadCaudalConc || 'L/m');

  v.cloro = quimico(campos.CLORO);
  v.dureza = quimico(campos.DUREZA);

  return {
    fecha: campos.fecha || '',
    hora: campos.hora || '',
    v,
    unidades: {
      condIN: campos.unidadcondIN || 'µS/cm',
      condOUT: campos.unidadcondOUT || 'µS/cm'
    },
    estados: {
      caudal: campos.estadoCAUDAL || '',
      uvOI: campos.estadoUVOI || '',
      uvLoop: campos.estadoUVLOOP || '',
      ozono: campos.estadoOZONO || ''
    },
    textos: {
      cloro: campos.CLORO || '',
      dureza: campos.DUREZA || '',
      nitratos: campos.NITRATOS || '',
      cloraminas: campos.CLORAMINAS || '',
      uvOI: campos.UVOI || '',
      uvLoop: campos.UVLOOP || '',
      ozono: campos.OZONO || '',
      comentarios: campos.comentarios || ''
    }
  };
}
