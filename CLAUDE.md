# form3 — Orden de servicio de ósmosis (Casas TDA)

Formulario web para registrar las visitas de servicio a plantas de ósmosis inversa
(clínicas de diálisis, Argentina). Lo usa Diego (Casas Tratamiento de Agua) y sus técnicos,
mayormente desde iPhone. Interfaz y mensajes en español; los textos que ve el cliente
final van en **voseo** ("Iniciá sesión", "Revisá el resumen").

- Publicado: https://eldiego87.github.io/form3/ (GitHub Pages, rama `main`, raíz)
- Panel: https://eldiego87.github.io/form3/panel.html
- Repo: https://github.com/eldiego87/form3 (público; necesario para Pages gratis)
- Versión anterior (v2, sin nube, sigue en uso): `../form2` → eldiego87.github.io/form2

## Archivos

| Archivo | Qué es |
|---|---|
| `index.html` | Formulario completo (v2 + agregados v3). Contiene ~20 PNG en base64 (pesa ~690 KB): no imprimir líneas enteras, usar `cut -c1-200`. |
| `app-nube.js` | Módulo Firebase del formulario: login, guardar, lista de 20, solicitar firma, vista `?firma=`, historial. |
| `comun.js` | Compartido formulario/panel: admins, normalización de sedes, umbrales, armado del registro, cartuchos. |
| `panel.html` / `panel.js` | Panel de gráficos (Chart.js 4.4.1 de cdnjs). |
| `firestore.rules` | Reglas de seguridad. **Diego las pega a mano** en consola Firebase → Firestore → Reglas → Publicar. |
| `firebase-config.js` | Config pública del proyecto Firebase (no es secreta). |
| `logo.png` | Logo extraído del formulario, lo usa el panel. |

## Firebase

- Proyecto `casastda-formularios`, plan **Spark (gratis)**, Firestore en `southamerica-east1`.
- Auth: Google. Dominios autorizados: `localhost` y `eldiego87.github.io`.
- Admin: `eldiego87@gmail.com` — está en `ADMINS` de `comun.js` **y** en `esAdmin()` de `firestore.rules` (mantener ambos iguales).
- Nunca pasar a plan Blaze sin que Diego lo pida.
- SDK web 12.4.0 desde gstatic (módulos ES, sin build).

### Colecciones

- `formularios/{id}` — los **20 más recientes** con firmas; al guardar el 21 se borra el más viejo (aunque tenga PDF). Campos: `campos` (id→valor de todos los inputs), `firmasTecnico` / `firmasCliente` (JSON string), `estado` (`pendiente`|`firmado`), `fecha`, `hora`, `empresa`, `sede`, `orden`, `creado`, `actualizado`, `firmadoEn`, `autor`. El id aleatorio de 20 caracteres hace de "contraseña" del link de firma.
- `registros/{mismo id}` — **historial permanente** (no se borra con el límite de 20), sin firmas. `v` (números), `unidades`, `estados`, `textos`, `reemplazos`, `sedeKey`, `empresaKey`, `empresa`, `sede`, `frecuente`, `ts`.
- `sedes/{sedeKey}` — empresa + sede para el selector del panel; `frecuente: true` si viene de los desplegables.

### Reglas (resumen)

- `formularios`: `get` público (con el link); `list/create/delete` solo admin; `update` admin, o el cliente **solo** agregando `firmasCliente` + `estado: firmado` + `firmadoEn` una única vez.
- `registros` y `sedes`: solo admin. `empresaKey` existe para, más adelante, dar a cada cliente lectura de su empresa.

## Decisiones tomadas (no re-discutir sin motivo)

- **Sede = EMPRESA + SEDE siempre** (`claveSede()` normaliza: mayúsculas, sin tildes). Dos empresas pueden tener sede en la misma ciudad.
- Clientes frecuentes = desplegables del HTML. `sincronizarCatalogo()` los copia a `sedes` al iniciar sesión (guarda huella en localStorage). Ingresos manuales = "eventuales". Una sede quitada del HTML pasa a eventual, no se borra.
- Desplegables de sedes: cada `<select>` tiene `data-empresa`; solo se muestra el de la empresa elegida y los otros se vacían (si no, se superponían en el PDF).
- **Decimales**: los campos numéricos son `type="text" inputmode="decimal"`; la coma se convierte a punto al escribir (iPhone en español no escribía la coma en `type="number"`). Cloro y Dureza aceptan "NEG".
- **Rechazo**: solo vale el **calculado** ((entrada−salida)/entrada). Se quitó el campo manual "Rechazo registrado". Sin cálculo si las unidades de entrada y salida difieren.
- **Firmas**: se guardan como **trazos** (`pad.toData()` compacto: `{w,h,g:[{o,p:[[x,y,t,presión]]}]}`), no como imagen; se regeneran a SVG para el PDF (vector). Funciones en el primer `<script>` de `index.html`: `firmaDesdePad`, `obtenerFirma`, `svgDeFirma`, `svgDeClave`, `mostrarFirmaGuardada`, `padsPorClave`, `firmasGuardadas`.
- **Cambios de filtros** (sedimentos `REEMFS`, bacteriológico `REEMBACT`, pre ósmosis `REEMPO`; Hansen no): texto libre con sugerencias ES / BIG BLUE / XL. `tipoDeCartucho()` → tipo normalizado o `null` si "OK", "-", "N/A", "sin cambio"… Fecha de reemplazo = fecha del servicio.
- Vacío = **sin dato** (null), distinto de 0. "NEG" = 0 en cloro/dureza.
- Gráficos: un solo eje Y por gráfico; paleta categórica validada (orden fijo); franjas OK/medio/peligro/falla con los umbrales del PDF; punto lleno = dato, **círculo vacío** = visita sin dato entre dos mediciones.
- Fechas: el input nativo se ve según el idioma del navegador (MM/DD en Brave en inglés). Diego lo aceptó; los datos y el PDF usan DD/MM/AAAA. Opción pendiente si hiciera falta: campo propio con máscara.

## Umbrales (los mismos del PDF)

- Rechazo: ≥96 OK · ≥90 peligro · <90 falla
- Conductividad salida: ≤10 OK · ≤20 medio · ≤30 peligro · >30 falla
- Dureza: ≤20 OK · ≤60 peligro · >60 falla (NEG = OK)
- Cloro: NEG OK · 0,1 peligro · ≥0,2 falla

## Forma de trabajo con Diego

- Diego no es programador: explicar en simple, guiarlo paso a paso en la consola de Firebase (él hace esa parte; mandar capturas ayuda).
- Commits chicos, mensajes en español. Avisar antes de cada push salvo que él lo autorice en el pedido. Nunca `push --force`.
- Después del push: esperar el build de Pages (`gh api repos/eldiego87/form3/pages/builds/latest`) y verificar con curl.
- Cuando cambian las reglas: Diego las publica **antes** del push del código que las necesita.
- Probar sin login: servir la carpeta y usar un import map que reemplace los módulos de gstatic por stubs en memoria; capturas con `firefox --headless --screenshot` (Firefox es snap: no lee `/tmp`, usar una carpeta temporal en el home y borrarla al terminar). Para que la captura espere al JS, agregar una imagen servida con demora.
- Proyectos de Diego en `~/PROYECTOS/{ELECTRONICA,WEB}`.

## Ideas pendientes / futuras

- Acceso de clientes al panel (uno por empresa general), usando `empresaKey` en las reglas.
- Alertas de tendencia (ej.: rechazo bajando varios servicios seguidos).
- Varios técnicos con login propio (por ahora no).
