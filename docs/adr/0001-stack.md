# ADR 0001 — Stack

**Decisão:** Python 3.11 + FastAPI + Pydantic v2 + SQLite (stdlib) no servidor; React 18 + TypeScript + Vite na interface; build estático servido pelo FastAPI.

**Motivos:** validação de contratos com tipos, ecossistema de IA em Python, tipos ponta a ponta no frontend, instalação local simples (o Node só é necessário para desenvolver a interface).

**Consequências:** o frontend compilado (`frontend/dist`) acompanha o projeto; `scripts/instalar.ps1` cria o ambiente Python.
