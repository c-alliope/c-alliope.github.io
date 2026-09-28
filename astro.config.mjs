// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
// User site: https://c-alliope.github.io — must serve from root, no base path.
export default defineConfig({
  site: 'https://c-alliope.github.io',
  vite: {
    plugins: [tailwindcss()],
  },
});
