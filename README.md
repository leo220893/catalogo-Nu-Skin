# Catálogo Nu Skin Argentina

PWA instalable con catálogo de la tienda **Nu Skin Argentina**, favoritos, Mis Kits, envío único de $8.100 para kits personalizados y simulación de tarjeta.

## Fuente de catálogo y precios

El botón **Actualizar precios** llama a `/api/sync-store`.

La función abre con un navegador Chromium la tienda oficial `https://www.nuskin.com/ar/es/`, descubre sus páginas actuales de catálogo/producto y lee los productos y precios que la tienda muestra para Argentina. Esto es necesario porque el storefront carga parte del contenido con JavaScript.

Al sincronizar:

- el catálogo de la app se reemplaza por los productos encontrados en la tienda AR;
- se incorporan productos nuevos y dejan de mostrarse los que ya no aparecen en esa tienda;
- los precios encontrados se guardan como precios oficiales verificados;
- favoritos y Mis Kits se conservan cuando el producto mantiene el mismo SKU/nombre;
- si Nu Skin no expone un precio durante la lectura, la app no inventa un valor.

La app también intenta una sincronización automática si la última lectura tiene más de 24 horas.

## Simulador

- Envío: $8.100.
- 3 cuotas: +7,4%.
- 6 cuotas: +14,6%.
- 12 cuotas: +32,7%.
- En **Mis Kits**, el envío se suma una sola vez al conjunto completo.

## Ejecutar localmente

No abras `index.html` con `file://` para probar la sincronización, porque la función de servidor no existe en ese modo.

Con Vercel CLI:

```bash
npx vercel dev
```

También podés usar `iniciar-local.bat` en Windows o `./iniciar-local.sh` en macOS/Linux.

## Git / Vercel

El contenido de esta carpeta se sube descomprimido a la raíz del repositorio. Vercel instalará `puppeteer-core` y `@sparticuz/chromium` y detectará `api/sync-store.mjs`.
