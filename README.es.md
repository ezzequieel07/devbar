# devbar

**Una barrita de desarrollo para el sitio que estás haciendo. Señalás algo, decís qué cambiar, y tu agente de código lo
toma. Y editás los textos desde la propia página.**

[Read in English](README.md)

Mientras corre tu servidor de desarrollo, devbar suma una barrita en la esquina del sitio:

- **Marcar** un elemento (clic), una **Zona** (arrastrando) o un texto seleccionado, y escribir qué cambiar. Si ayuda,
  pegás o arrastrás una imagen de referencia.
- Cada pedido queda guardado como un JSON en `.devbar/pending/`, con todo lo que un agente necesita para encontrarlo en
  el código: la página, el tamaño de la ventana, el scroll, un selector CSS, el texto y el HTML del elemento.
- **Avisar a Claude** (o al agente que uses): si tu agente está corriendo `npx devbar listen`, se despierta y hace los
  pedidos. La barrita muestra si está atento, cuándo está haciendo cada pedido y cuándo lo terminó.
- **Editar**: tocás cualquier texto de la página y lo cambiás ahí mismo. devbar lo guarda donde vive ese texto (un
  archivo JSON, un borrador de Sanity, o tu propia fuente con un adaptador). Los textos que viven en el código se
  convierten en un pedido.

Sin capturas para anotar, sin «el segundo botón de la izquierda, el azul». Y sin claves de API: funciona con el agente
que ya usás (Claude Code, Codex, Cursor, Aider…) a través de archivos comunes.

devbar solo corre con el servidor de desarrollo. En el build de producción la barrita no se muestra (ni siquiera se
descarga) y las rutas responden 404.

## Instalación (Next.js)

```bash
npm install devbar
npx devbar init
```

`init` suma `.devbar/` al `.gitignore` y las instrucciones para el agente a `CLAUDE.md` / `AGENTS.md`.

**1. Las rutas** — `app/devbar/[...devbar]/route.ts`:

```ts
import {createDevbarHandler} from 'devbar/server';

export const {GET, POST, PATCH, DELETE} = createDevbarHandler();
```

**2. La barrita** — en el layout principal (`app/layout.tsx`), dentro de `<body>`:

```tsx
import {Devbar} from 'devbar';

{process.env.NODE_ENV === 'development' && <Devbar locale="es" />}
```

Corré `next dev`, abrí el sitio y vas a ver la barrita abajo a la derecha.

| Atajo | |
| --- | --- |
| `Alt+C` | Marcar un elemento (o el texto seleccionado) |
| `Alt+E` | Modo Editar |
| `Alt+H` | Esconder / mostrar la barrita (por ejemplo, para grabar el sitio) |
| `Esc` | Cancelar |
| `⌘ Enter` | Enviar |

## Con tu agente

Los pedidos son archivos JSON, así que cualquier agente los puede leer. La línea de comandos lo hace más cómodo:

```bash
npx devbar list            # pedidos abiertos, legibles
npx devbar start <id>      # la barrita muestra «Claude lo está haciendo»
npx devbar done <id>       # lo pasa a .devbar/done/ (sale del contador)
npx devbar listen          # espera el «Avisar», muestra los pedidos y termina
```

**El circuito con Claude Code:** pedile a Claude que corra `npx devbar listen` en segundo plano. Marcás cosas en el
sitio y apretás **Avisar a Claude**: el proceso termina, Claude se despierta con la lista, hace los cambios, marca cada
uno como hecho y vuelve a escuchar. ¿No está escuchando? Apretá Avisar igual y después escribile «revisá los pedidos de
devbar».

`npx devbar init` deja estas instrucciones en `CLAUDE.md` / `AGENTS.md` para que el agente sepa cómo trabajar. También
podés verlas con `npx devbar instructions`. El nombre del agente en la barrita se cambia con `<Devbar agent="Codex" />`.

En el [README en inglés](README.md#working-with-your-agent) hay un ejemplo completo de un pedido.

## Modo Editar

Pasale un adaptador de contenido y la barrita suma el botón **Editar**. Pasá el mouse por cualquier texto: azul es que
se edita desde acá; gris, que vive en el código (al tocarlo te ofrece «Pedir el cambio»). **Otros textos** lista lo que
no aparece en la página, como títulos SEO o textos de mails.

Al guardar, la página se recarga en el mismo lugar y comprueba que el texto nuevo se vea. **Deshacer** vuelve el último
cambio.

### Archivos JSON

Traducciones, textos del sitio, cualquier archivo con textos. Guardar escribe el archivo directo (respetando la
sangría); git es tu historial.

```ts
import {jsonAdapter} from 'devbar/adapters/json';
import {createDevbarHandler} from 'devbar/server';

export const {GET, POST, PATCH, DELETE} = createDevbarHandler({
  content: jsonAdapter({
    files: ['messages/en.json', {file: 'messages/es.json', path: '/es'}],
    scope: {'hero.': '#hero', 'footer.': 'footer'},
  }),
});
```

### Sanity

Como el Studio, guardar escribe un **borrador** (`drafts.<id>`): en el sitio publicado no cambia nada hasta que
apretás **Publicar…**, que muestra cada cambio sin publicar (antes → después) y los publica o los descarta. Si algo
cambió en el Studio mientras tanto, no lo pisa.

```ts
import {createClient} from '@sanity/client';
import {sanityAdapter} from 'devbar/adapters/sanity';
import {createDevbarHandler} from 'devbar/server';

const client = createClient({
  projectId: process.env.SANITY_PROJECT_ID,
  dataset: 'production',
  apiVersion: '2025-01-01',
  token: process.env.SANITY_WRITE_TOKEN, // un token que pueda escribir; solo se usa en el servidor
  useCdn: false,
});

export const {GET, POST, PATCH, DELETE} = createDevbarHandler({
  content: sanityAdapter({
    client,
    documents: [
      {type: 'siteSettings', id: 'siteSettings', title: 'Sitio', fields: [
        'hero.title',
        {path: 'hero.intro', multiline: true, max: 180},
        'nav.links[].label',
        {path: 'seo.description', onPage: false},
      ]},
      {type: 'post', filter: 'defined(slug.current)', path: doc => `/blog/${(doc.slug as {current: string}).current}`},
    ],
  }),
});
```

- Sin `fields`, se edita cualquier texto del documento (menos los campos del sistema, slugs, referencias y URLs).
- Los bloques de Portable Text (párrafos, títulos, ítems, citas) se editan con formato simple: `**negrita**`,
  `*itálica*`, `[link](https://…)`.
- **Tu sitio tiene que mostrar los borradores en desarrollo** (por ejemplo `perspective: 'drafts'` cuando
  `NODE_ENV === 'development'`); si no, no vas a ver lo que editás antes de publicarlo.
- ¿Querés ver lo que está en la web sin tus borradores? Leé una cookie al pedir los datos (ej. `devbar_view=published`
  → `perspective: 'published'`) y pasale el nombre a la barrita: `<Devbar viewCookie="devbar_view" />` suma
  **Ver publicado** / **Ver borradores**.

### Tu propia fuente

Un adaptador es un objeto chico con `list`, `set` y, si querés, `undo` y `drafts`. Mirá el ejemplo en el
[README en inglés](README.md#your-own-source).

## Ayudarle a encontrar los textos

El modo Editar encuentra el texto tocado comparando lo que muestra la página con los textos guardados. Cuando no
alcanza:

- **`data-devbar="<bind>"`** en un elemento edita ese texto directo (en JSON, la clave: `hero.title`; en Sanity, la
  `_key` del bloque de Portable Text).
- **`scope`** (opción del adaptador): prefijo de la clave → selector CSS de dónde se muestra.
- **`data-devbar-code`** en un elemento (o `<Devbar codeZones=".grafico" />`) marca partes cuyo texto vive en el código.
- **`data-devbar-bound`** en un elemento (o `<Devbar boundZones=".nota" />`) marca partes que se editan solo por
  `data-devbar` (ej. un cuerpo de Portable Text con la `_key` en cada bloque): adentro no se adivina por el texto.

## Opciones de la barrita

```tsx
<Devbar endpoint="/devbar" locale="es" agent="Claude" position="left" codeZones=".grafico" boundZones=".nota" viewCookie="devbar_view" />
```

## Seguridad

- Las rutas responden **solo en desarrollo**; si no, 404.
- **Solo hosts locales** (127.0.0.1, localhost, [::1], *.localhost).
- Cada escritura necesita el encabezado de la barrita y el **mismo origen**: otras webs abiertas en tu navegador no
  pueden crear pedidos ni cambiar textos.
- Los adaptadores no confían en lo que manda el navegador y no pisan un texto que cambió desde que se abrió.

## Licencia

MIT
