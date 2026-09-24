import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Salida standalone para imagen Docker mínima en producción
  output: 'standalone',
};

export default nextConfig;
