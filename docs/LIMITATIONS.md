# Known limitations and remaining work

- **Single process for live streaming.** Runs execute inside the web process. A second instance can serve reconnects by polling the event log and can cancel through the database flag, but runs are not picked up by another instance if their process dies; they are marked `INTERRUPTED`. A queue worker (for example pg-boss) is the next step for horizontal scaling.
- **Costs are estimates.** Token counts come from providers; prices come from the per-connection pricing you enter, or conservative fallback rates. No payment collection or subscription billing exists.
- **Monthly budget** is checked when a run starts; a run already in progress is bounded by its own cost limit.
- **Capabilities.** Tool calling is assumed for OpenAI-compatible servers, Ollama and OpenRouter and will fail at the provider if a model lacks it. Vision, file input and reasoning summaries are not implemented.
- **Model override per conversation** applies to the lead agent only; subagents use their own model.
- **Delegation events** appear live; after a refresh the delegation shows as a tool row.
- **Ownership transfer** of a workspace is not implemented.
- **Row-level security, CSP, 2FA**: see SECURITY.md.
- **Active workspace** is stored per user, so two tabs on different workspaces share one selection.
- **Email**: without `SMTP_URL`, production refuses to send mail; sign-up then fails when verification is required.
