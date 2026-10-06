# Ligata.AI

A website assistant for Umbraco 17 sites, answered by a self-hosted **Gemma 4 12B** on the Ligata mini PC's RTX 3060 eGPU.

- `src/Ligata.AI`: the Umbraco package (backoffice section, settings, knowledge, chat bubble, public API).
- `gateway/`: the shared inference gateway (API keys, global queue, streaming, PDF text, status).
- `model/`: llama.cpp launch profile, memory probe and the benchmarks used to choose the quantization.

See [the plan](docs/PLAN.md). Setup and operations guides are added as the milestones land.
