// PM2 processes for the Ligata AI gateway on the mini PC.
//   pm2 start C:\Code\Ligata.AI\gateway\ecosystem.config.cjs
//   pm2 save
// ligata-ai-llm runs llama-server (model/profile.json), ligata-ai is the public API in front of it.
// They are separate so gateway updates restart in a second without reloading the model.
const path = require('node:path');
const node = 'C:/Program Files/nodejs/node.exe';

const common = {
  cwd: __dirname,
  interpreter: node,
  instances: 1,
  exec_mode: 'fork',
  autorestart: true,
  watch: false,
  time: true,
  // Windows cannot deliver SIGINT like Unix; use PM2's IPC shutdown message.
  shutdown_with_message: true,
};

module.exports = {
  apps: [
    {
      ...common,
      name: 'ligata-ai-llm',
      script: 'src/llm-launcher.mjs',
      restart_delay: 10000,
      min_uptime: 60000,
      max_restarts: 50,
      kill_timeout: 20000,
      // CUDA unified memory would let allocations silently land in system RAM.
      env: { GGML_CUDA_ENABLE_UNIFIED_MEMORY: '' },
    },
    {
      ...common,
      name: 'ligata-ai',
      script: 'src/main.mjs',
      restart_delay: 3000,
      min_uptime: 10000,
      max_restarts: 100,
      kill_timeout: 10000,
      env: { LIGATA_AI_DATA: path.join(__dirname, 'data') },
    },
  ],
};
