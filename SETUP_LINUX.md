# Setup em Linux e Git

Este guia descreve como:

- preparar o repositório para versionamento em Git;
- clonar o projeto em outra máquina Linux;
- configurar frontend e backend;
- subir a aplicação em desenvolvimento e em modo build servido pelo FastAPI.

## 1. Pré-requisitos

Instale na máquina Linux:

- `git`
- `node` 18+ e `npm`
- `python3`
- `python3-venv`
- `pip`

Confirmação rápida:

```bash
git --version
node --version
npm --version
python3 --version
```

## 2. Subir o repositório no Git

Se o projeto ainda não estiver ligado a um remoto:

```bash
git init
git add .
git commit -m "Initial project import"
git branch -M main
git remote add origin <URL_DO_REPOSITORIO>
git push -u origin main
```

Se o remoto já existir:

```bash
git status
git remote -v
git add .
git commit -m "Describe your change"
git push
```

Arquivos que devem continuar fora do Git:

- `backend/.env`
- `public/runtime-config.local.json`
- `.runtime/`

## 3. Clonar em outra máquina Linux

```bash
git clone <URL_DO_REPOSITORIO>
cd webapp_otc
```

Instale as dependências do frontend:

```bash
npm install
```

Crie o ambiente virtual do backend:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

## 4. Configuração obrigatória

### Frontend local

Crie `.env.development` a partir do exemplo:

```bash
cp .env.development.example .env.development
```

O valor esperado para desenvolvimento local é:

```bash
VITE_APP_BACKEND_ORIGIN=http://127.0.0.1:8000
```

### Runtime config público

Crie o arquivo local:

```bash
cp public/runtime-config.example.br.json public/runtime-config.local.json
```

Se o repositório não tiver o exemplo no `public/`, crie manualmente `public/runtime-config.local.json` com base no `README.md`.

Para modo real no browser, mantenha same-origin nas bases públicas:

```json
{
  "backend": {
    "clientsDbBaseUrl": "",
    "didit": {
      "apiBaseUrl": "",
      "callbackUrl": "",
      "waitingUrl": "",
      "documentVerificationWorkflowId": "",
      "biometricValidationWorkflowId": "",
      "documentVerificationValidityDays": 365,
      "sdkMode": "modal"
    }
  },
  "endpoints": {
    "quoteBaseUrl": "",
    "orderBaseUrl": ""
  }
}
```

Importante:

- não coloque `DIDIT_API_KEY` no frontend;
- prefira não expor `callbackUrl`, `waitingUrl` e workflow IDs da Didit no JSON público;
- esses valores agora podem ficar no `backend/.env`.

### Backend

Crie o arquivo de ambiente:

```bash
cp backend/.env.example backend/.env
```

Preencha os campos necessários.

#### Obrigatórios em ambiente real

```bash
DIDIT_API_KEY=
DIDIT_CALLBACK_URL=
DIDIT_WAITING_URL=
DIDIT_DOCUMENT_VERIFICATION_WORKFLOW_ID=
DIDIT_BIOMETRIC_VALIDATION_WORKFLOW_ID=
```

#### Opcionais mais comuns

```bash
DIDIT_API_BASE_URL=https://verification.didit.me
CLIENTS_DATABASE_API_BASE_URL=
OTC_UPSTREAM_API_BASE_URL=
FRONTEND_DIST_DIR=dist
PROXY_ALLOW_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
LOG_LEVEL=INFO
SEND_EMAIL_URL=
REDIS_URL=redis://localhost:6379/0
RATE_LIMIT_ENABLED=true
IP_BLACKLIST_ENABLED=true
AUDIT_LOG_ENABLED=true
RATE_LIMIT_DEFAULT_REQUESTS=120
RATE_LIMIT_DEFAULT_WINDOW_SECONDS=60
RATE_LIMIT_SEND_EMAIL_REQUESTS=5
RATE_LIMIT_SEND_EMAIL_WINDOW_SECONDS=300
RATE_LIMIT_DIDIT_SESSION_REQUESTS=10
RATE_LIMIT_DIDIT_SESSION_WINDOW_SECONDS=300
RATE_LIMIT_CREATE_ORDER_REQUESTS=10
RATE_LIMIT_CREATE_ORDER_WINDOW_SECONDS=300
RATE_LIMIT_GET_PRICING_REQUESTS=120
RATE_LIMIT_GET_PRICING_WINDOW_SECONDS=60
RATE_LIMIT_VERIFY_OTP_REQUESTS=10
RATE_LIMIT_VERIFY_OTP_WINDOW_SECONDS=300
IP_AUTO_BLOCK_ENABLED=true
IP_AUTO_BLOCK_THRESHOLD=30
IP_AUTO_BLOCK_WINDOW_SECONDS=300
IP_AUTO_BLOCK_TTL_SECONDS=3600
OTP_TTL_SECONDS=600
AUDIT_LOG_DIR=storage/logs
AUDIT_LOG_TIMEZONE=America/Sao_Paulo
AUDIT_REDIS_QUEUE_KEY=audit:queue
AUDIT_WORKER_BLOCK_SECONDS=5
ADMIN_SECURITY_TOKEN=
ORDER_UPDATES_TTL_MS=3600000
BIOMETRIC_RATE_LIMIT_PER_IP_PER_DAY=3
BIOMETRIC_RATE_LIMIT_FILE=.runtime/biometric_rate_limits.json
HTTP_LOG_REQUEST_BODY_MAX_CHARS=8192
HTTP_LOG_RESPONSE_BODY_MAX_CHARS=8192
HTTP_LOG_RESPONSE_BUFFER_MAX_BYTES=524288
```

## 5. Rodar em desenvolvimento

Terminal 1, backend:

```bash
source .venv/bin/activate
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Terminal 2, frontend:

```bash
npm run dev
```

Fluxo esperado:

- browser fala com `localhost:5173`;
- Vite faz proxy para `127.0.0.1:8000`;
- FastAPI encaminha chamadas para Didit, OTC e `clients_database`.

## 6. Rodar build servido pelo backend

Gere o build:

```bash
npm run build
```

Com `FRONTEND_DIST_DIR=dist`, o mesmo FastAPI passa a servir os arquivos estáticos:

```bash
source .venv/bin/activate
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

## 7. Logs e observabilidade

O projeto registra:

- requests do browser para o backend no logger `didit_proxy.http`;
- requests do backend para Didit no logger `didit_proxy.upstream`;
- requests do backend para OTC em `didit_proxy.otc_upstream`;
- requests do backend para `clients_database` em `didit_proxy.clients_database_upstream`.

Os logs HTTP agora usam `request_id` para correlacionar entrada e saída.

## 8. Checklist de smoke test

Depois de subir tudo:

1. Abra `http://127.0.0.1:8000/health` e confirme `{"status":"ok"}`.
2. Verifique os logs do backend no arranque.
3. Abra a aplicação no navegador e confirme que os requests de dados usam same-origin:
   - `/otc/...`
   - `/webhook/didit/...`
   - `/webhook/clients_database`
   - `/api/order-updates/...`
4. Confirme que `.runtime/` pode ser criada e escrita pelo processo Python.
5. Se biometria real estiver ativa, valide que os workflows e URLs da Didit vieram do `backend/.env`, não do JSON público.

## 9. Problemas comuns

### O frontend sobe, mas as APIs falham

Revise:

- `.env.development`
- `backend/.env`
- `PROXY_ALLOW_ORIGINS`
- `CLIENTS_DATABASE_API_BASE_URL`
- `OTC_UPSTREAM_API_BASE_URL`

### A aplicação abre, mas a configuração falha

Confira se existe `public/runtime-config.local.json`.

### O build abre sem frontend

Confirme:

- `npm run build` executado com sucesso;
- `dist/index.html` existe;
- `FRONTEND_DIST_DIR` aponta para `dist`.
 