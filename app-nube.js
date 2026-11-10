// =====================================================================
// v3 · Formularios en la nube (Firebase)
//  - El administrador inicia sesión con Google, guarda formularios,
//    los lista (máximo 20; el más viejo se borra) y pide firmas por WhatsApp.
//  - El cliente abre el link ?firma=<id>, revisa el resumen, firma y
//    descarga el registro. No necesita cuenta.
// =====================================================================
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, orderBy, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

// Debe coincidir con la lista de firestore.rules
const ADMINS = ['eldiego87@gmail.com'];
const MAX_FORMULARIOS = 20;
// Límite de Firestore: 1 MiB por documento. Se deja margen.
const MAX_BYTES_FIRMAS = 700000;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const coleccion = collection(db, 'formularios');

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const idParaFirmar = params.get('firma');   // vista del cliente
let idActual = params.get('id');            // formulario abierto por el admin
let usuario = null;
let estadoActual = null;                    // 'pendiente' | 'firmado' | null

const SEDES = ['nefroargINPUT', 'itacINPUT', 'sancaINPUT', 'militarINPUT'];

// ---------------------------------------------------------------------
// Utilidades de interfaz
// ---------------------------------------------------------------------
let toastTimer;
function toast(texto, ms = 3500) {
  const el = $('toast');
  el.textContent = texto;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function esAdmin(u = usuario) {
  return !!u && ADMINS.includes((u.email || '').toLowerCase());
}

function escapar(t) {
  return String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fechaLegible(f) {
  if (!f) return '';
  const [a, m, d] = f.split('-');
  return `${d}/${m}/${a}`;
}

async function conBoton(boton, textoOcupado, accion) {
  const original = boton.textContent;
  boton.disabled = true;
  boton.textContent = textoOcupado;
  try { return await accion(); }
  finally { boton.disabled = false; boton.textContent = original; }
}

// ---------------------------------------------------------------------
// Campos del formulario <-> objeto
// ---------------------------------------------------------------------
function camposDelFormulario() {
  const campos = {};
  document.querySelectorAll('#entryPanels input[id], #entryPanels select[id], #entryPanels textarea[id]')
    .forEach(el => { campos[el.id] = el.value; });
  return campos;
}

function disparar(el) {
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}

function aplicarCampos(campos) {
  const especiales = new Set(['empresaINPUT', ...SEDES]);
  Object.entries(campos || {}).forEach(([id, valor]) => {
    const el = $(id);
    if (!el || especiales.has(id)) return;
    el.value = valor ?? '';
    disparar(el);
  });
  // Primero la empresa (filtra y vacía las sedes), después la sede elegida
  const empresa = $('empresaINPUT');
  empresa.value = campos.empresaINPUT ?? '';
  disparar(empresa);
  SEDES.forEach(id => { $(id).value = campos[id] ?? ''; disparar($(id)); });

  // Botones visuales (chips de estado y unidades) según el select oculto
  document.querySelectorAll('.chip-group[data-select], .unit-toggle[data-select]').forEach(grupo => {
    const valor = $(grupo.dataset.select)?.value ?? '';
    grupo.querySelectorAll('button').forEach(b => b.classList.toggle('is-active', b.dataset.value === valor));
  });
}

function datosParaLista(campos) {
  const sede = campos.nombreClinica || SEDES.map(id => campos[id]).find(Boolean) || '';
  return {
    fecha: campos.fecha || '',
    hora: campos.hora || '',
    empresa: campos.nombreEmpresa || campos.empresaINPUT || '',
    sede,
    orden: $('ordenNumero').textContent.trim()
  };
}

// ---------------------------------------------------------------------
// Firmas
// ---------------------------------------------------------------------
function firmasDe(claves) {
  const out = {};
  claves.forEach(c => { const f = obtenerFirma(c); if (f) out[c] = f; });
  return out;
}

function cargarFirmas(jsonTexto) {
  if (!jsonTexto) return;
  try {
    Object.entries(JSON.parse(jsonTexto)).forEach(([clave, f]) => {
      firmasGuardadas[clave] = f;
    });
  } catch (e) { console.warn('Firmas ilegibles', e); }
}

function reiniciarFirmas() {
  Object.keys(padsPorClave).forEach(clave => {
    padsPorClave[clave].pad.clear();
    delete firmasGuardadas[clave];
    mostrarFirmaGuardada(clave);
    $(padsPorClave[clave].txt).textContent = 'pendiente';
  });
  $('barFirma').textContent = 'Firma: pendiente';
}

function refrescarVistasDeFirmas() {
  Object.keys(padsPorClave).forEach(mostrarFirmaGuardada);
  window.dispatchEvent(new Event('resize'));
}

// ---------------------------------------------------------------------
// Guardar (admin)
// ---------------------------------------------------------------------
async function guardar() {
  if (!esAdmin()) {
    toast('Para guardar en la nube iniciá sesión con tu cuenta de Google (arriba).');
    return;
  }
  const campos = camposDelFormulario();
  const tecnico = firmasDe(['firmaTecnico', 'apellidoTecnico']);
  const cliente = firmasDe(['firmaCliente', 'apellidoCliente']);
  const firmasTecnico = JSON.stringify(tecnico);
  const firmasCliente = cliente.firmaCliente ? JSON.stringify(cliente) : '';
  if (firmasTecnico.length + firmasCliente.length > MAX_BYTES_FIRMAS) {
    toast('Las firmas son demasiado grandes para guardarse. Probá limpiarlas y firmar más simple.', 6000);
    return;
  }
  const datos = {
    campos,
    ...datosParaLista(campos),
    firmasTecnico,
    firmasCliente,
    estado: firmasCliente ? 'firmado' : 'pendiente',
    actualizado: serverTimestamp(),
    autor: usuario.email
  };

  try {
    if (idActual) {
      await updateDoc(doc(coleccion, idActual), datos);
    } else {
      const ref = doc(coleccion);              // id aleatorio de 20 caracteres
      await setDoc(ref, { ...datos, creado: serverTimestamp() });
      idActual = ref.id;
      history.replaceState(null, '', `?id=${idActual}`);
      await recortarAlMaximo();
    }
    estadoActual = datos.estado;
    actualizarBotones();
    toast(datos.estado === 'firmado' ? 'Guardado (firmado) ✓' : 'Guardado ✓ — falta la firma del cliente');
    if (!$('panelLista').hidden) await mostrarLista();
  } catch (e) {
    console.error(e);
    if (e.code === 'not-found') {
      idActual = null;
      toast('Ese formulario ya no existe en la nube (se borró). Tocá Guardar de nuevo para crearlo otra vez.', 6000);
    } else {
      toast('No se pudo guardar: ' + (e.message || e), 6000);
    }
  }
}

// Mantiene como máximo 20 formularios: borra los más viejos
async function recortarAlMaximo() {
  const snap = await getDocs(query(coleccion, orderBy('creado', 'desc')));
  const sobrantes = snap.docs.slice(MAX_FORMULARIOS);
  await Promise.all(sobrantes.map(d => deleteDoc(d.ref)));
  if (sobrantes.length) toast(`Se borró el formulario más viejo (límite de ${MAX_FORMULARIOS}).`);
}

// ---------------------------------------------------------------------
// Lista de formularios (admin)
// ---------------------------------------------------------------------
async function mostrarLista() {
  const ul = $('nubeLista');
  $('panelLista').hidden = false;
  ul.innerHTML = '<li class="nube-vacio">Cargando…</li>';
  try {
    const snap = await getDocs(query(coleccion, orderBy('creado', 'desc')));
    if (snap.empty) {
      ul.innerHTML = '<li class="nube-vacio">Todavía no hay formularios guardados.</li>';
      return;
    }
    ul.innerHTML = snap.docs.map(d => {
      const f = d.data();
      const firmado = f.estado === 'firmado';
      return `<li class="nube-item${d.id === idActual ? ' is-actual' : ''}" data-id="${d.id}">
        <div class="nube-item__info">
          <div class="nube-item__titulo">${escapar(f.empresa || 'Sin empresa')}${f.sede ? ' · ' + escapar(f.sede) : ''}
            <span class="badge badge--${firmado ? 'firmado' : 'pendiente'}">${firmado ? 'firmado' : 'pendiente'}</span></div>
          <div class="nube-item__sub">${escapar(f.orden || '')} · ${fechaLegible(f.fecha)} ${escapar(f.hora || '')}</div>
        </div>
        <div class="nube-item__acciones">
          <button type="button" class="btn btn--ghost" data-accion="abrir">Abrir</button>
          ${firmado ? '' : '<button type="button" class="btn btn--ghost" data-accion="firma">Solicitar firma</button>'}
          <button type="button" class="ghost-btn" data-accion="borrar">Borrar</button>
        </div>
      </li>`;
    }).join('');
    $('btnLista').textContent = `Guardados (${snap.size})`;
  } catch (e) {
    console.error(e);
    ul.innerHTML = `<li class="nube-vacio">No se pudo cargar la lista: ${escapar(e.message || e)}</li>`;
  }
}

$('nubeLista').addEventListener('click', async ev => {
  const boton = ev.target.closest('button[data-accion]');
  if (!boton) return;
  const item = boton.closest('.nube-item');
  const id = item.dataset.id;
  const titulo = item.querySelector('.nube-item__titulo').firstChild.textContent.trim();
  if (boton.dataset.accion === 'abrir') {
    location.href = `?id=${id}`;
  } else if (boton.dataset.accion === 'firma') {
    solicitarFirma(id, titulo, item.querySelector('.nube-item__sub').textContent.trim());
  } else if (boton.dataset.accion === 'borrar') {
    if (!confirm(`¿Borrar definitivamente "${titulo}"?`)) return;
    await conBoton(boton, '…', () => deleteDoc(doc(coleccion, id)));
    if (id === idActual) { idActual = null; history.replaceState(null, '', location.pathname); actualizarBotones(); }
    toast('Formulario borrado');
    await mostrarLista();
  }
});

// ---------------------------------------------------------------------
// Abrir un formulario guardado (admin)
// ---------------------------------------------------------------------
async function abrir(id) {
  const snap = await getDoc(doc(coleccion, id));
  if (!snap.exists()) {
    toast('Ese formulario ya no existe (puede haberse borrado por el límite de 20).', 6000);
    idActual = null;
    history.replaceState(null, '', location.pathname);
    return;
  }
  const f = snap.data();
  reiniciarFirmas();
  aplicarCampos(f.campos);
  cargarFirmas(f.firmasTecnico);
  cargarFirmas(f.firmasCliente);
  idActual = id;
  estadoActual = f.estado;
  window.formUI.mostrarResumen();
  refrescarVistasDeFirmas();
  actualizarBotones();
}

// ---------------------------------------------------------------------
// Pedir firma por WhatsApp
// ---------------------------------------------------------------------
function linkDeFirma(id) {
  return `${location.origin}${location.pathname}?firma=${id}`;
}

function solicitarFirma(id = idActual, titulo, detalle) {
  if (!id) { toast('Primero guardá el formulario.'); return; }
  if (!titulo) {
    const d = datosParaLista(camposDelFormulario());
    titulo = [d.empresa, d.sede].filter(Boolean).join(' · ');
    detalle = `${d.orden} · ${fechaLegible(d.fecha)} ${d.hora}`;
  }
  const texto = `Hola, te envío la orden de servicio de Casas TDA para revisar y firmar la conformidad.\n` +
    `${titulo}\n${detalle}\n\n${linkDeFirma(id)}`;
  window.open('https://wa.me/?text=' + encodeURIComponent(texto), '_blank');
}

// ---------------------------------------------------------------------
// Vista del cliente: ?firma=<id>
// ---------------------------------------------------------------------
function avisar(titulo, texto) {
  const el = $('avisoFirma');
  el.innerHTML = `<b>${escapar(titulo)}</b>${escapar(texto)}`;
  el.hidden = false;
}

async function iniciarModoFirma() {
  document.body.classList.add('modo-firma');
  $('entryPanels').hidden = true;
  avisar('Cargando orden de servicio…', '');
  let snap;
  try {
    snap = await getDoc(doc(coleccion, idParaFirmar));
  } catch (e) {
    console.error(e);
    avisar('No se pudo abrir la orden', 'Revisá tu conexión y volvé a abrir el link.');
    return;
  }
  if (!snap.exists()) {
    avisar('Esta orden ya no está disponible', 'Pedile a Casas TDA que te envíe un link nuevo.');
    document.querySelector('.actionbar').hidden = true;
    return;
  }
  const f = snap.data();
  aplicarCampos(f.campos);
  cargarFirmas(f.firmasTecnico);
  estadoActual = f.estado;
  if (f.estado === 'firmado') {
    cargarFirmas(f.firmasCliente);
    avisar('Orden firmada ✓', 'Ya registramos tu conformidad. Podés descargar el registro.');
  } else {
    avisar('Revisá el resumen y firmá la conformidad', 'Al final de la página están los recuadros de firma y aclaración. Después tocá "Guardar firma".');
  }
  window.formUI.mostrarResumen();
  refrescarVistasDeFirmas();
  $('btnGuardarFirma').hidden = f.estado === 'firmado';
  $('btnDescargar').hidden = f.estado !== 'firmado';
}

async function guardarFirmaCliente() {
  const cliente = firmasDe(['firmaCliente', 'apellidoCliente']);
  if (!cliente.firmaCliente || !cliente.apellidoCliente) {
    toast('Completá la firma y la aclaración antes de guardar.');
    return;
  }
  const json = JSON.stringify(cliente);
  if (json.length > MAX_BYTES_FIRMAS / 2) {
    toast('La firma es demasiado grande. Limpiala y probá de nuevo.');
    return;
  }
  try {
    await updateDoc(doc(coleccion, idParaFirmar), {
      firmasCliente: json,
      estado: 'firmado',
      firmadoEn: serverTimestamp()
    });
  } catch (e) {
    console.error(e);
    toast(e.code === 'permission-denied'
      ? 'Esta orden ya fue firmada o no está disponible.'
      : 'No se pudo guardar la firma: ' + (e.message || e), 6000);
    return;
  }
  Object.assign(firmasGuardadas, cliente);
  estadoActual = 'firmado';
  $('btnGuardarFirma').hidden = true;
  $('btnDescargar').hidden = false;
  avisar('¡Gracias! Firma guardada ✓', 'Ya podés descargar el registro en PDF.');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------------
// Sesión y botones (admin)
// ---------------------------------------------------------------------
function actualizarBotones() {
  const admin = esAdmin();
  $('btnLogin').hidden = !!usuario;
  $('btnLogout').hidden = !usuario;
  $('btnLista').hidden = !admin;
  $('btnNuevo').hidden = !admin;
  $('btnSolicitarFirma').hidden = !(admin && idActual && estadoActual === 'pendiente');
  if (!usuario) {
    $('nubeEstado').innerHTML = 'Sin sesión · <span>los datos no se guardan en la nube</span>';
  } else if (!admin) {
    $('nubeEstado').innerHTML = `<b>${escapar(usuario.email)}</b> · sin permiso para guardar`;
  } else {
    $('nubeEstado').innerHTML = `<b>${escapar(usuario.email)}</b>` +
      (idActual ? ` · <span>${estadoActual === 'firmado' ? 'firmado' : 'guardado'}</span>` : ' · <span>nuevo formulario</span>');
  }
}

$('btnLogin').addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
  } catch (e) {
    if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
      console.error(e);
      toast('No se pudo iniciar sesión: ' + (e.code || e.message), 6000);
    }
  }
});
$('btnLogout').addEventListener('click', () => signOut(auth));
$('btnLista').addEventListener('click', () => {
  if ($('panelLista').hidden) mostrarLista(); else $('panelLista').hidden = true;
});
$('btnCerrarLista').addEventListener('click', () => { $('panelLista').hidden = true; });
$('btnNuevo').addEventListener('click', () => { location.href = location.pathname; });
$('btnSolicitarFirma').addEventListener('click', () => solicitarFirma());
// "Guardar" sigue mostrando el resumen (código v2) y además guarda en la nube
$('btnGuardar').addEventListener('click', ev => conBoton(ev.currentTarget, 'Guardando…', guardar));
$('btnGuardarFirma').addEventListener('click', ev => conBoton(ev.currentTarget, 'Guardando…', guardarFirmaCliente));
$('btnDescargar').addEventListener('click', ev => conBoton(ev.currentTarget, 'Generando…', () => exportarPDF()));

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
if (idParaFirmar) {
  iniciarModoFirma();
} else {
  let primeraVez = true;
  onAuthStateChanged(auth, async u => {
    usuario = u;
    actualizarBotones();
    if (primeraVez && idActual) {
      primeraVez = false;
      if (esAdmin()) await abrir(idActual);
      else toast('Iniciá sesión para abrir el formulario guardado.');
    } else if (primeraVez) {
      primeraVez = false;
    } else if (esAdmin() && idActual && estadoActual === null) {
      await abrir(idActual);   // inició sesión después de abrir un link ?id=
    }
  });
}
