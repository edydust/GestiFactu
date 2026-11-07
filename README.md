# GestiFactu - Gestión y facturación para Autónomos

Plataforma de gestión integral y facturación profesional para autónomos con control de acceso y seguridad.

---

## 🔐 Credenciales de Acceso por defecto

* **Usuario / Email:** `admin@gestifactu.com`
* **Contraseña:** `admin`

*(Una vez dentro, puedes cambiar tanto el usuario como la contraseña desde la pestaña **"Ajustes & Banco"**)*.

---

## 🚀 Características incluidas

* **🔒 Control de Acceso y Seguridad:** Pantalla de inicio de sesión con tokens de sesión protegidos.
* **📊 Panel de Control (Dashboard):** Métricas clave de facturación anual, mensual, pendientes de cobro y gastos.
* **💶 Ventas & Facturación:**
  * Numeración correlativa automática por series (ejemplo: `1-26-000001`).
  * Cálculo automático de IVA (21%) y retención IRPF (1% / 15%).
  * Generación y descarga directa de **Facturas en PDF** de alta calidad.
  * Envío directo por email con plantilla formateada.
  * Control de estado de cobro (*Pendiente* / *Cobrada*).
* **🛒 Compras & Gastos:** Registro de facturas y tickets recibidos con desgravación de IVA e IRPF.
* **👥 Clientes & Contactos:** Gestión de clientes y proveedores con datos fiscales completos.
* **📦 Servicios & Catálogo:** Catálogo de productos y servicios con impuestos y tarifas asociadas.
* **⏱️ Control Horario & Fichaje:** Botones de un clic para registrar Entrada, Pausa y Salida (cumple normativa de registro de jornada laboral).
* **📈 Informes Fiscales:** Cálculo automático trimestral para liquidación de IVA (Modelo 303) e IRPF (Modelo 130).
* **⚙️ Ajustes:** Personalización completa de datos fiscales de la empresa, logotipo, IBAN bancario y cambio de contraseña.

---

## 🛠️ Puesta en marcha

### Opción A: Con Docker (Recomendado)

1. Abre una terminal en la carpeta del proyecto.
2. Ejecuta:
   ```bash
   docker compose up -d --build
   ```
3. Accede desde tu navegador web a:
   ```
   http://localhost:8090
   ```
   *(o `http://IP_DE_TU_SERVIDOR:8090`)*

### Opción B: Con Node.js directo

1. Requiere Node.js 18 o superior instalado.
2. Instala dependencias y arranca:
   ```bash
   npm install
   npm start
   ```
3. Abre tu navegador en:
   ```
   http://localhost:8090
   ```

---

## 💾 Persistencia de datos

Todos los datos (facturas, clientes, gastos, empresa, credenciales, etc.) se almacenan en formato JSON en la carpeta `./data/database.json`. Al iniciar por primera vez, el sistema se inicializa con los valores de plantilla de `seed_data.json`.
Puedes cambiar tus datos de empresa y tu IBAN directamente desde la pestaña **"Ajustes & Banco"** del panel web.
