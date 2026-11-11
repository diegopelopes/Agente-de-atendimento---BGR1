/**
 * Configuração PM2 para execução contínua em Produção (VPS Linux / Windows Server)
 * Uso: pm2 start ecosystem.config.cjs
 */
module.exports = {
  apps: [
    {
      name: 'bgr-agente-comercial',
      script: 'src/api/visual-server.ts',
      interpreter: 'node',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: 3090,
      },
    },
  ],
};
