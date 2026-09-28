import { fileURLToPath } from "node:url";
import { defineConfig } from "astro/config";
import react from "@astrojs/react";

import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  integrations: [react()],

  // La página siguiente se pide al pasar el mouse o tocar el enlace: al hacer
  // clic ya está lista y el cambio de pantalla no espera al servidor.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: "hover",
  },

  // La sección se llama Desafíos y ahora la ruta también. Solo se redirige la
  // portada: el redirect estático pierde la query, así que las subpáginas
  // llegarían sin su `id`.
  redirects: {
    "/competencias": "/desafios",
  },

  server: {
    port: 4321,
    host: true,
  },

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
  },
});
