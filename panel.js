// =====================================================================
// Panel de registros: historial por empresa + sede, con gráficos.
// =====================================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDocs, deleteDoc, query, where
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';
import { ADMINS, PRESIONES_PRE, PRESIONES_OSMOSIS, UMBRALES, FILTROS, estadoDe } from './comun.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const $ = id => document.getElementById(id);

let sedesLista = [];        // [{id, empresa, sede, frecuente}]
let registrosSede = [];     // todos los de la sede elegida, ordenados por fecha
let meses = 12;
const graficos = {};        // Chart.js por clave

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
let toastTimer;
function toast(texto, ms = 3500) {
  const el = $('toast');
  el.textContent = texto; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const css = nombre => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
const fmtFecha = ms => { const d = new Date(ms); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`; };
const fmtNum = (n, dec = 1) => n == null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: dec });
const nombreSede = s => s.sede ? `${s.empresa} · ${s.sede}` : s.empresa;

const ETIQUETA_ESTADO = { ok: ['✓', 'OK'], medio: ['•', 'Medio'], peligro: ['!', 'Peligro'], falla: ['✕', 'Falla'] };
function chipEstado(estado) {
  if (!estado) return '';
  const [icono, texto] = ETIQUETA_ESTADO[estado];
  return `<span class="estado estado--${estado}"><i aria-hidden="true">${icono}</i>${texto}</span>`;
}

function mostrar(vista) {
  ['vistaLogin', 'vistaSinPermiso', 'vistaCargando', 'vistaPanel'].forEach(v => { $(v).hidden = v !== vista; });
}

// ---------------------------------------------------------------------
// Sesión
// ---------------------------------------------------------------------
$('btnLogin').addEventListener('click', async () => {
  try { await signInWithPopup(auth, new GoogleAuthProvider()); }
  catch (e) {
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') toast('No se pudo iniciar sesión: ' + (e.code || e.message), 6000);
  }
});
$('btnSalir').addEventListener('click', () => signOut(auth));

onAuthStateChanged(auth, async u => {
  $('usuario').textContent = u ? u.email : '';
  $('btnSalir').hidden = !u;
  if (!u) { mostrar('vistaLogin'); return; }
  if (!ADMINS.includes((u.email || '').toLowerCase())) {
    $('txtSinPermiso').textContent = `La cuenta ${u.email} no tiene acceso al panel.`;
    mostrar('vistaSinPermiso');
    return;
  }
  mostrar('vistaPanel');
  await cargarSedes();
});

// ---------------------------------------------------------------------
// Sedes
// ---------------------------------------------------------------------
async function cargarSedes() {
  try {
    const snap = await getDocs(collection(db, 'sedes'));
    sedesLista = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => nombreSede(a).localeCompare(nombreSede(b), 'es'));
  } catch (e) {
    console.error(e);
    toast('No se pudieron cargar las sedes: ' + (e.code || e.message), 6000);
    return;
  }
  const sel = $('selSede');
  const frecuentes = sedesLista.filter(s => s.frecuente);
  const eventuales = sedesLista.filter(s => !s.frecuente);
  const porEmpresa = {};
  frecuentes.forEach(s => { (porEmpresa[s.empresa] ||= []).push(s); });
  let html = '<option value="">— Elegí empresa y sede —</option>';
  Object.keys(porEmpresa).sort((a, b) => a.localeCompare(b, 'es')).forEach(emp => {
    html += `<optgroup label="${esc(emp)}">` +
      porEmpresa[emp].map(s => `<option value="${esc(s.id)}">${esc(s.sede || emp)}</option>`).join('') +
      '</optgroup>';
  });
  if (eventuales.length) {
    html += '<optgroup label="Clientes eventuales">' +
      eventuales.map(s => `<option value="${esc(s.id)}">${esc(nombreSede(s))}</option>`).join('') + '</optgroup>';
  }
  sel.innerHTML = html;

  let guardada = '';
  try { guardada = localStorage.getItem('panelSede') || ''; } catch (e) {}
  if (guardada && sedesLista.some(s => s.id === guardada)) sel.value = guardada;
  await cargarRegistros();
}

$('selSede').addEventListener('change', () => {
  try { localStorage.setItem('panelSede', $('selSede').value); } catch (e) {}
  cargarRegistros();
});

$('rango').addEventListener('click', ev => {
  const b = ev.target.closest('button[data-meses]');
  if (!b) return;
  meses = Number(b.dataset.meses);
  $('rango').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  render();
});

// ---------------------------------------------------------------------
// Registros
// ---------------------------------------------------------------------
async function cargarRegistros() {
  const id = $('selSede').value;
  registrosSede = [];
  if (!id) { render(); return; }
  try {
    const snap = await getDocs(query(collection(db, 'registros'), where('sedeKey', '==', id)));
    registrosSede = snap.docs.map(d => ({ id: d.id, ...d.data(), ms: d.data().ts?.toMillis?.() ?? 0 }))
      .sort((a, b) => a.ms - b.ms);
  } catch (e) {
    console.error(e);
    toast('No se pudieron cargar los registros: ' + (e.code || e.message), 6000);
  }
  render();
}

function registrosEnRango() {
  if (!meses) return registrosSede;
  const desde = new Date();
  desde.setMonth(desde.getMonth() - meses);
  return registrosSede.filter(r => r.ms >= desde.getTime());
}

// ---------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------
function render() {
  const id = $('selSede').value;
  const regs = registrosEnRango();
  const sede = sedesLista.find(s => s.id === id);
  $('sinDatos').hidden = true;
  $('contenido').hidden = true;
  if (!id) {
    $('txtSinDatos').textContent = sedesLista.length
      ? 'Elegí una empresa y sede para ver su historial.'
      : 'Todavía no hay sedes. Aparecen solas al iniciar sesión en el formulario o al guardar el primer servicio.';
    $('sinDatos').hidden = false;
    return;
  }
  if (!regs.length) {
    $('txtSinDatos').textContent = registrosSede.length
      ? `${nombreSede(sede)}: no hay registros en este período. Probá con un período más largo.`
      : `${nombreSede(sede)}: todavía no tiene registros. Se agregan solos al guardar un formulario de esta sede.`;
    $('sinDatos').hidden = false;
    return;
  }
  $('contenido').hidden = false;
  renderTiles(regs);
  renderGraficos(regs);
  renderCambios(regs);
  renderTabla(regs, sede);
}

function ultimoCon(regs, campo) {
  for (let i = regs.length - 1; i >= 0; i--) if (regs[i].v?.[campo] != null) return regs[i];
  return null;
}

function renderTiles(regs) {
  const rRech = ultimoCon(regs, 'rechazo');
  const rCond = ultimoCon(regs, 'condOUT');
  const ult = regs[regs.length - 1];
  const tile = (label, valor, extra) => `<div class="tile"><div class="tile__label">${label}</div><div class="tile__valor">${valor}</div><div class="tile__extra">${extra}</div></div>`;
  $('tiles').innerHTML =
    tile('Último rechazo',
      rRech ? `${fmtNum(rRech.v.rechazo)}<small>%</small>` : '—',
      rRech ? `${chipEstado(estadoDe('rechazo', rRech.v.rechazo))} · ${fmtFecha(rRech.ms)}` : 'sin dato') +
    tile('Última conductividad de salida',
      rCond ? `${fmtNum(rCond.v.condOUT)}<small>${esc(rCond.unidades?.condOUT || 'µS/cm')}</small>` : '—',
      rCond ? `${chipEstado(estadoDe('condOUT', rCond.v.condOUT))} · ${fmtFecha(rCond.ms)}` : 'sin dato') +
    tile('Servicios en el período', String(regs.length), meses ? `últimos ${meses} meses` : 'todo el historial') +
    tile('Último servicio', fmtFecha(ult.ms), esc(ult.hora || ''));
}

// Bandas de estado detrás de las líneas (mismos umbrales que el PDF)
const pluginBandas = {
  id: 'bandas',
  beforeDatasetsDraw(chart, _args, opts) {
    const bandas = opts?.lista;
    if (!bandas?.length) return;
    const { ctx, chartArea: a, scales: { y } } = chart;
    ctx.save();
    bandas.forEach(b => {
      const y1 = Math.max(a.top, Math.min(a.bottom, y.getPixelForValue(Math.min(b.hasta, y.max))));
      const y2 = Math.max(a.top, Math.min(a.bottom, y.getPixelForValue(Math.max(b.desde, y.min))));
      if (y2 - y1 < 1) return;
      ctx.globalAlpha = 0.10;
      ctx.fillStyle = css(`--st-${b.estado}`);
      ctx.fillRect(a.left, y1, a.right - a.left, y2 - y1);
      ctx.globalAlpha = 1;
      // Etiqueta en el margen derecho, fuera del área de datos (no tapa puntos)
      if (y2 - y1 >= 12) {
        ctx.fillStyle = css('--ink-faint');
        ctx.font = '600 10.5px system-ui, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(ETIQUETA_ESTADO[b.estado][1], a.right + 6, (y1 + y2) / 2);
      }
    });
    ctx.restore();
  }
};

// Línea vertical en el punto que se está mirando
const pluginCruz = {
  id: 'cruz',
  afterDatasetsDraw(chart) {
    const act = chart.tooltip?.getActiveElements?.();
    if (!act?.length) return;
    const { ctx, chartArea: a } = chart;
    const x = act[0].element.x;
    ctx.save();
    ctx.strokeStyle = css('--axis');
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, a.top); ctx.lineTo(x, a.bottom); ctx.stroke();
    ctx.restore();
  }
};

// Convierte una tabla de umbrales en bandas con desde/hasta
function bandasDe(medida) {
  const t = UMBRALES[medida];
  if ('desde' in t[0]) {
    return t.map((f, i) => ({ estado: f.estado, desde: f.desde, hasta: i === 0 ? Infinity : t[i - 1].desde }));
  }
  return t.map((f, i) => ({ estado: f.estado, desde: i === 0 ? -Infinity : t[i - 1].hasta, hasta: f.hasta }));
}

const DEF = {
  rechazo: { titulo: 'Rechazo', unidad: '%', series: [['rechazo', 'Rechazo']], bandas: 'rechazo', dec: 1 },
  condOUT: { titulo: 'Conductividad de salida', unidadDe: 'condOUT', series: [['condOUT', 'Salida']], bandas: 'condOUT', dec: 1, min0: true },
  condIN: { titulo: 'Conductividad de entrada', unidadDe: 'condIN', series: [['condIN', 'Entrada']], dec: 0, min0: true },
  caudales: { titulo: 'Caudales', unidad: 'L/h', series: [['caudalPERM', 'Permeado'], ['caudalCONC', 'Concentrado']], dec: 0, min0: true },
  presPre: { titulo: 'Presiones · pretratamiento', unidad: 'bar', series: PRESIONES_PRE, dec: 1, min0: true, nota: 'Tocá un nombre de la leyenda para ocultarlo o mostrarlo.' },
  presOsm: { titulo: 'Presiones · ósmosis y loop', unidad: 'bar', series: PRESIONES_OSMOSIS, dec: 1, min0: true, nota: 'Tocá un nombre de la leyenda para ocultarlo o mostrarlo.' },
  cloro: { titulo: 'Cloro', unidad: 'ppm', series: [['cloro', 'Cloro']], bandas: 'cloro', dec: 2, min0: true, nota: 'NEG se grafica como 0.' },
  dureza: { titulo: 'Dureza', unidad: 'ppm', series: [['dureza', 'Dureza']], bandas: 'dureza', dec: 0, min0: true, nota: 'NEG se grafica como 0.' }
};

function renderGraficos(regs) {
  const tinta = css('--ink-muted'), tenue = css('--ink-faint'), grilla = css('--grid'), eje = css('--axis'), sup = css('--surface');
  document.querySelectorAll('.graf[data-graf]').forEach(card => {
    const clave = card.dataset.graf;
    const d = DEF[clave];
    graficos[clave]?.destroy();
    delete graficos[clave];

    // Unidad: fija, o la de los registros (avisando si se mezclan)
    let unidad = d.unidad, nota = d.nota || '';
    if (d.unidadDe) {
      const usadas = [...new Set(regs.filter(r => r.v?.[d.unidadDe] != null).map(r => r.unidades?.[d.unidadDe] || 'µS/cm'))];
      unidad = usadas.length ? usadas.join(' / ') : 'µS/cm';
      if (usadas.length > 1) nota = 'Atención: en este período hay mediciones en µS/cm y en ppm. Revisá la unidad de cada punto en la tabla.';
    }

    let hayFaltantes = false;
    const datasets = d.series.map(([campo, nombre], i) => {
      const color = css(`--series-${i + 1}`);
      return {
        label: nombre,
        data: conFaltantes(regs, campo),
        borderColor: color, backgroundColor: color,
        borderWidth: 2, tension: 0, spanGaps: true,
        // Dato medido: punto lleno y grande. Visita sin dato: círculo vacío sobre la línea.
        pointRadius: c => c.raw?.faltante ? 4 : 5.5,
        pointHoverRadius: c => c.raw?.faltante ? 5.5 : 7.5,
        pointBackgroundColor: c => c.raw?.faltante ? sup : color,
        pointBorderColor: c => c.raw?.faltante ? color : sup,
        pointHoverBackgroundColor: c => c.raw?.faltante ? sup : color,
        pointHoverBorderColor: c => c.raw?.faltante ? color : sup,
        pointBorderWidth: 2, pointHoverBorderWidth: 2, pointHitRadius: 12,
        borderJoinStyle: 'round', borderCapStyle: 'round'
      };
    }).filter(ds => ds.data.some(p => !p.faltante));
    hayFaltantes = datasets.some(ds => ds.data.some(p => p.faltante));
    if (hayFaltantes) nota = ['○ círculo vacío = visita sin ese dato.', nota].filter(Boolean).join(' ');

    const total = datasets.reduce((n, ds) => n + ds.data.filter(p => !p.faltante).length, 0);
    card.innerHTML = `<h2>${esc(d.titulo)} <span class="sub" style="font-weight:400">(${esc(unidad)})</span></h2>` +
      (total ? `<div class="lienzo"><canvas aria-label="${esc(d.titulo)}" role="img"></canvas></div>` : '<div class="vacio">Sin datos en este período</div>') +
      (nota ? `<div class="nota">${esc(nota)}</div>` : '');
    if (!total) return;

    const valores = datasets.flatMap(ds => ds.data.filter(p => !p.faltante).map(p => p.y));
    const yOpts = { grid: { color: grilla }, border: { color: eje }, ticks: { color: tenue, font: { size: 11 } } };
    if (clave === 'rechazo') { yOpts.suggestedMin = Math.min(85, ...valores); yOpts.suggestedMax = 100; yOpts.max = Math.max(100, ...valores); }
    else if (d.min0) yOpts.beginAtZero = true;
    if (clave === 'condOUT') yOpts.suggestedMax = Math.max(12, ...valores) * 1.1;
    if (clave === 'cloro') yOpts.suggestedMax = Math.max(0.3, ...valores);
    if (clave === 'dureza') yOpts.suggestedMax = Math.max(80, ...valores) * 1.1;

    const xs = regs.map(r => r.ms);
    const margen = xs.length > 1 ? (xs[xs.length - 1] - xs[0]) * 0.03 : 86400000 * 3;

    graficos[clave] = new Chart(card.querySelector('canvas'), {
      type: 'line',
      data: { datasets },
      plugins: [pluginBandas, pluginCruz],
      options: {
        responsive: true, maintainAspectRatio: false, animation: false, locale: 'es-AR',
        layout: { padding: { right: d.bandas ? 50 : 4 } },
        interaction: { mode: 'nearest', axis: 'x', intersect: false },
        scales: {
          x: {
            type: 'linear', min: xs[0] - margen, max: xs[xs.length - 1] + margen,
            grid: { display: false }, border: { color: eje },
            ticks: { color: tenue, font: { size: 11 }, maxTicksLimit: 6, callback: v => fmtFecha(v) }
          },
          y: yOpts
        },
        plugins: {
          bandas: { lista: d.bandas ? bandasDe(d.bandas) : [] },
          legend: {
            display: datasets.length > 1,
            position: 'top', align: 'start',
            labels: { color: tinta, usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, font: { size: 12 } }
          },
          tooltip: {
            mode: 'x', intersect: false,
            backgroundColor: css('--surface'), titleColor: css('--ink'), bodyColor: tinta,
            borderColor: eje, borderWidth: 1, padding: 10, usePointStyle: true, boxWidth: 8, boxHeight: 8,
            callbacks: {
              title: items => fmtFecha(items[0].parsed.x),
              label: item => {
                if (item.raw?.faltante) return ` ${item.dataset.label}: sin dato`;
                const val = item.parsed.y;
                let txt = ` ${item.dataset.label}: ${fmtNum(val, d.dec)} ${unidad}`;
                if (d.bandas) {
                  const est = estadoDe(d.bandas, val);
                  if (est) txt += ` · ${ETIQUETA_ESTADO[est][1]}`;
                }
                return txt;
              }
            }
          }
        }
      }
    });
  });
}

// ---------------------------------------------------------------------
// Cambios de filtros
// ---------------------------------------------------------------------
const DIA = 86400000;
const msDeFecha = f => { const t = new Date(`${f}T00:00`).getTime(); return isNaN(t) ? null : t; };

function renderCambios(regs) {
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  $('cambiosFiltros').innerHTML = FILTROS.map(([clave, , nombre]) => {
    // Último cambio: de todo el historial; el resto, del período elegido
    const todos = registrosSede.filter(r => r.reemplazos?.[clave]);
    const enPeriodo = regs.filter(r => r.reemplazos?.[clave]);
    const ultimo = todos[todos.length - 1];
    if (!ultimo) {
      return `<div class="tile"><div class="tile__label">${esc(nombre)}</div><div class="tile__valor">—</div><div class="tile__extra">Sin cambios registrados</div></div>`;
    }
    const rep = ultimo.reemplazos[clave];
    const msUlt = msDeFecha(rep.fecha) ?? ultimo.ms;
    const dias = Math.max(0, Math.round((hoy - msUlt) / DIA));
    const fechas = enPeriodo.map(r => msDeFecha(r.reemplazos[clave].fecha) ?? r.ms);
    const intervalos = fechas.slice(1).map((f, i) => (f - fechas[i]) / DIA);
    const promedio = intervalos.length ? Math.round(intervalos.reduce((a, b) => a + b, 0) / intervalos.length) : null;
    const tipos = {};
    enPeriodo.forEach(r => { const t = r.reemplazos[clave].tipo; tipos[t] = (tipos[t] || 0) + 1; });
    const tiposTxt = Object.entries(tipos).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${esc(t)} ×${n}`).join(' · ') || '—';
    return `<div class="tile">
      <div class="tile__label">${esc(nombre)}</div>
      <div class="tile__valor">${fmtFecha(msUlt)}<span class="tile__tipo">${esc(rep.tipo)}</span></div>
      <div class="tile__extra">último cambio · hace ${dias} día${dias === 1 ? '' : 's'}</div>
      <div class="tile__filas">
        <span>Cambios en el período: <b>${enPeriodo.length}</b></span>
        <span>Cada cuánto, en promedio: <b>${promedio == null ? '—' : promedio + ' días'}</b></span>
        <span>Cartuchos usados: <b>${tiposTxt}</b></span>
      </div>
    </div>`;
  }).join('');

  const filas = [];
  regs.forEach(r => FILTROS.forEach(([clave, , nombre]) => {
    const rep = r.reemplazos?.[clave];
    if (rep) filas.push({ ms: msDeFecha(rep.fecha) ?? r.ms, nombre, tipo: rep.tipo });
  }));
  filas.sort((a, b) => b.ms - a.ms);
  $('tablaCambios').innerHTML = filas.length
    ? `<thead><tr><th>Fecha de reemplazo</th><th style="text-align:left">Filtro</th><th style="text-align:left">Tipo de cartucho</th></tr></thead><tbody>` +
      filas.map(f => `<tr><td>${fmtFecha(f.ms)}</td><td style="text-align:left">${esc(f.nombre)}</td><td style="text-align:left">${esc(f.tipo)}</td></tr>`).join('') + '</tbody>'
    : '<tbody><tr><td style="text-align:left;color:var(--ink-faint)">No hay cambios de filtros en este período.</td></tr></tbody>';
}

// Puntos de una serie. Las visitas sin dato que quedan ENTRE dos mediciones
// se marcan como "faltante" sobre la línea (posición interpolada) para que
// se vea que ese día no se midió. Antes de la primera o después de la última
// medición no hay línea, así que no se marcan.
function conFaltantes(regs, campo) {
  const medidos = regs.map((r, i) => r.v?.[campo] != null ? i : -1).filter(i => i >= 0);
  if (!medidos.length) return [];
  const desde = medidos[0], hasta = medidos[medidos.length - 1];
  const puntos = [];
  for (let i = desde; i <= hasta; i++) {
    const r = regs[i], valor = r.v?.[campo];
    if (valor != null) { puntos.push({ x: r.ms, y: valor }); continue; }
    const ant = regs[medidos.filter(j => j < i).pop()];
    const sig = regs[medidos.find(j => j > i)];
    const t = sig.ms === ant.ms ? 0 : (r.ms - ant.ms) / (sig.ms - ant.ms);
    puntos.push({ x: r.ms, y: ant.v[campo] + (sig.v[campo] - ant.v[campo]) * t, faltante: true });
  }
  return puntos;
}

// Columnas de la tabla y del CSV
function columnas() {
  return [
    ['rechazo', 'Rechazo %', 1],
    ['condIN', 'Cond. entrada', 1], ['condOUT', 'Cond. salida', 1],
    ['caudalPERM', 'Permeado L/h', 0], ['caudalCONC', 'Concentrado L/h', 0],
    ...PRESIONES_PRE.map(([id, n]) => [id, `${n} bar`, 1]),
    ...PRESIONES_OSMOSIS.map(([id, n]) => [id, `${n} bar`, 1]),
    ['cloro', 'Cloro ppm', 2], ['dureza', 'Dureza ppm', 0]
  ];
}

function renderTabla(regs, sede) {
  $('tituloTabla').textContent = `${nombreSede(sede)} · ${regs.length} registro${regs.length === 1 ? '' : 's'}`;
  const cols = columnas();
  const filas = [...regs].reverse().map(r => {
    const unidad = campo => (campo === 'condIN' || campo === 'condOUT') && r.unidades?.[campo] === 'ppm' ? ' ppm' : '';
    return `<tr><td>${fmtFecha(r.ms)} ${esc(r.hora || '')}</td>` +
      cols.map(([c, , dec]) => `<td>${fmtNum(r.v?.[c], dec)}${unidad(c)}</td>`).join('') +
      `<td><button type="button" class="link-danger" data-borrar="${esc(r.id)}">Borrar</button></td></tr>`;
  }).join('');
  $('tabla').innerHTML = `<thead><tr><th>Fecha</th>${cols.map(([, n]) => `<th>${esc(n)}</th>`).join('')}<th></th></tr></thead><tbody>${filas}</tbody>`;
}

$('tabla').addEventListener('click', async ev => {
  const b = ev.target.closest('button[data-borrar]');
  if (!b) return;
  const r = registrosSede.find(x => x.id === b.dataset.borrar);
  if (!confirm(`¿Borrar del historial el registro del ${fmtFecha(r.ms)} ${r.hora || ''}?\n\nNo se puede deshacer.`)) return;
  b.disabled = true;
  try {
    await deleteDoc(doc(db, 'registros', r.id));
    registrosSede = registrosSede.filter(x => x.id !== r.id);
    toast('Registro borrado');
    render();
  } catch (e) {
    b.disabled = false;
    toast('No se pudo borrar: ' + (e.code || e.message), 6000);
  }
});

// CSV con ; y coma decimal (lo abre bien el Excel en español)
$('btnCSV').addEventListener('click', () => {
  const regs = registrosEnRango();
  const sede = sedesLista.find(s => s.id === $('selSede').value);
  if (!sede || !regs.length) { toast('No hay registros para exportar.'); return; }
  const cols = columnas();
  const celda = v => {
    if (v == null) return '';
    const t = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lineas = [
    ['Fecha', 'Hora', 'Empresa', 'Sede', ...cols.map(c => c[1]), 'Unidad cond. entrada', 'Unidad cond. salida', 'Cloro (texto)', 'Dureza (texto)',
      ...FILTROS.map(([, , n]) => `Cambio ${n.replace('Filtro ', '')} (cartucho)`), 'Comentarios'].map(celda).join(';'),
    ...regs.map(r => [
      r.fecha, r.hora, r.empresa, r.sede,
      ...cols.map(([c]) => r.v?.[c] ?? null),
      r.unidades?.condIN, r.unidades?.condOUT, r.textos?.cloro, r.textos?.dureza,
      ...FILTROS.map(([clave]) => r.reemplazos?.[clave]?.tipo || ''), r.textos?.comentarios
    ].map(celda).join(';'))
  ];
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Registros - ${nombreSede(sede)}.csv`.replace(/[\\/:*?"<>|]/g, '-');
  a.click();
  URL.revokeObjectURL(a.href);
});

// Redibujar si cambia el modo claro/oscuro
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { if (!$('contenido').hidden) render(); });
