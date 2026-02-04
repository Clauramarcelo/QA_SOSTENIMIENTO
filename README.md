# CE Offline – Control de Calidad (Slump, T°, Resistencias y Pernos)

App web **100% offline (PWA)** para registro y control de calidad en interior mina:
- **Slump + Temperatura + Presión de aire**
- **Resistencias iniciales**
- **Instalación de pernos (Helicoidal / Swellex)**
- **Base de datos local por fecha**
- **Reporte con gráficos por labor**

✅ Funciona sin internet (una vez cargada)  
✅ Guarda los datos en tu dispositivo (IndexedDB)  
✅ Permite exportar/importar registros (JSON)

---

## ✨ Funcionalidades

### 1) Slump y T°
Formulario de registro:
- Fecha
- Hora del slump
- Labor
- Nivel
- Slump (mm)
- Temperatura (°C)
- Presión de aire
- Nro de Mixer / HS (hora de salida)
- H_LL (hora de llegada)
- Observaciones

### 2) Resistencias Iniciales
Registro de:
- Fecha, hora, labor, nivel
- Edad (ej. 30 min, 1 h, 3 h)
- Resistencia (MPa)
- Observaciones

### 3) Instalación de Pernos
Registro de:
- Fecha, hora, labor, nivel
- Checkboxes: P. Helicoidal / P. Swellex
- Cantidad por tipo
- Observaciones

### 4) Base de Datos
- Filtrado por rango de fechas
- Tablas de cada módulo
- Eliminación individual de registros
- Borrar toda la BD (con confirmación)

### 5) Reporte
Gráficos de barras por **Labor**:
- Slump promedio (mm)
- Temperatura promedio (°C)
- Presión de aire promedio
- Pernos instalados (Helicoidal + Swellex)

---

## 🗂 Estructura del proyecto

``
