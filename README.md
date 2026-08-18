# Catálogo Nu Skin Argentina

PWA instalable con catálogo, favoritos, Mis Kits, envío único de $8.100 para kits personalizados, simulación de tarjeta y verificación de precios contra Nu Skin Argentina.

## Precios

- El botón **Actualizar precios** llama a `/api/sync-prices`.
- La función consulta páginas oficiales de Nu Skin Argentina y solo guarda precios que puede identificar como valores en ARS.
- La actualización se hace por SKU en lotes pequeños.
- Si un SKU no puede verificarse, conserva el último precio disponible o queda pendiente; no se reemplaza por cero.
- Los precios verificados se guardan en `localStorage` del dispositivo.
- Se mantiene la edición manual como respaldo. Una sincronización posterior reemplaza una corrección manual solo cuando logra verificar oficialmente ese SKU.

## Simulador

- Envío: $8.100.
- 3 cuotas: +7,4%.
- 6 cuotas: +14,6%.
- 12 cuotas: +32,7%.
- En **Mis Kits**, el envío se suma una sola vez al conjunto completo.

## Ejecutar localmente con la API

La consulta de precios necesita un servidor (no funciona abriendo `index.html` con `file://`).

Con Vercel CLI:

```bash
npx vercel dev
```

Luego abrir la URL local indicada por Vercel.

## Git / Vercel

El repositorio está listo para subir directamente. Vercel sirve el sitio estático y detecta la función `api/sync-prices.js`.
