# ADR 0002 — Executor dentro do processo, estado no SQLite

**Decisão:** o executor roda como thread dentro do servidor, com todo estado persistido no SQLite e reconciliação com o ComfyUI ao iniciar.

**Motivos:** um processo só para iniciar e parar no Windows; o trabalho continua com a página fechada; a durabilidade vem do banco, não do processo.

**Revisão:** separar em processo próprio se o servidor precisar reiniciar com frequência durante gerações.
