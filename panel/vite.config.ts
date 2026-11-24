import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// En desarrollo, las llamadas a la API van al core local (npm run dev:core en la raíz).
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/empresas': 'http://localhost:3000', '/auth': 'http://localhost:3000' } },
});
