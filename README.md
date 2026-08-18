# Catálogo Nu Skin Argentina

PWA de consulta rápida basada en la tienda oficial de Nu Skin Argentina.

## Funciones

- Catálogo Nu Skin Argentina.
- Favoritos guardados en el dispositivo.
- Mis Kits: combina productos, suma precios, agrega el envío una sola vez y simula 3/6/12 cuotas.
- Envío configurado: $8.100.
- Recargos configurados: 3 cuotas +7,4%, 6 cuotas +14,6%, 12 cuotas +32,7%.
- PWA instalable.
- Actualización manual mediante el botón **Actualizar precios**.

## Sincronización de tienda y precios

La versión v3 divide el proceso para evitar timeouts largos en Vercel:

1. `api/sync-store.mjs` lee el catálogo de `https://www.nuskin.com/ar/es/` y su catálogo de productos.
2. `api/sync-price-batch.mjs` consulta los productos sin precio en lotes pequeños.
3. La interfaz muestra progreso (`Verificando precios X/Y`) y cancela una solicitud si supera el tiempo máximo previsto.
4. Un precio viejo puede seguir visible como referencia, pero solo figura como **Verificado en Nu Skin** si fue confirmado en la sincronización actual.

La sincronización completa se ejecuta únicamente cuando el usuario toca **Actualizar precios**. No se dispara automáticamente al abrir la aplicación.

## Deploy

Proyecto listo para GitHub + Vercel. Vercel detecta los endpoints de `api/` y sirve el resto como sitio estático.
