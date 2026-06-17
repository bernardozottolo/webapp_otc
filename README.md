# OTC White Label Frontend

Fluxo frontend completo para OTC com:
- landing + formulario lateral
- cotacao com polling a cada 20s
- onboarding por popups (email, OTP, KYC, biometria)
- pagamento (cripto + KYT, chave local + validacao de titularidade)
- criacao de pedido e pagina `/order/:id` com polling
- white label + i18n (`pt-BR`, `es-CO`) + regra por pais (`PIX`/`Llave BREB-B`)

## Rodar

1. Instale Node.js (18+ recomendado)
2. Instale as dependencias:

```bash
npm install
```

3. Copie um exemplo de configuracao para o arquivo local usado pela aplicacao:

```bash
cp public/runtime-config.example.br.json public/runtime-config.local.json
```

4. Edite `public/runtime-config.local.json` com os dados da sua instalacao.
5. Rode a aplicacao:

```bash
npm run dev
```

## Configuracao local de runtime

O frontend agora carrega a configuracao a partir de `public/runtime-config.local.json` em tempo de execucao.

Isso evita editar `src/whitelabel/config.ts` ou `src/app/styles.css` a cada novo deploy.

### Arquivos disponiveis

- Arquivo real da instalacao: `public/runtime-config.local.json`
- Exemplo Brasil: `public/runtime-config.example.br.json`
- Exemplo Colombia: `public/runtime-config.example.co.json`

O arquivo `public/runtime-config.local.json` esta no `.gitignore` e deve ser preenchido localmente antes de publicar.

### Estrutura principal do JSON

- Dados da marca:
  - `id`
  - `companyName`
  - `logoUrl`
  - `headline`
  - `subheadline`
  - `secondarySubheadline` (opcional)
  - `supportEmail`
  - `legalDisclaimer`
- Parametros operacionais:
  - `fiatCurrency`
  - `transactionalCapFiat` (opcional no JSON — default 5000 no codigo): teto da soma utilizavel na perna fiat **antes do login**, em unidades de `fiatCurrency`. Depois da identificacao, o utilizavel efectivo é `Math.min(transactionalCapFiat, approved_kyc_limit - transacted_history_amount)` vindos dos endpoints OTC.
  - `primaryColor`
  - `defaultLocale`
  - `defaultCountry`
  - `enabledCountries`
  - `enabledPaymentKinds`
  - `bankLabelByCountry`
  - `documentTypesByCountry` — tipos de documento KYC (`type` + `pattern` regex opcional).
  - `pixKeyDefaultsByCountry` — defaults por pais para chave PIX no fluxo SELL:
    - `defaultBackType` — `backType` inicial no modal (ex.: `"phone"`).
    - `phoneDialCode` — DDI sem `+` (ex.: `"55"` para BR). Telefones sao persistidos e enviados ao OTC como `+55` + digitos nacionais (ex.: `+5521974092129`).
  - `pixKeyTypesByCountry` — tipos de chave PIX (mesmo espirito de `documentTypesByCountry`), cada item com:
    - `label` — texto no select do front.
    - `backType` — identificador estavel salvo em `PaymentData.bankKeyType` e em `wallet.network` no `clients_database`.
    - `pattern` — regex validada no valor **normalizado** (telefone: apenas digitos nacionais 10–11).
    - `normalize` — `digits` | `lowercase_trim` | `uuid` | `none`.
    - `format` — preset de mascara na digitacao: `phone_br`, `br_tax_id`, `uuid`, `none`.
    - `inputMode` (opcional) — `tel` | `email` | `text`.
  - `paymentFormTexts.pixKeyInvalid` — mensagem quando a chave nao passa no regex do tipo.
- Backend:
  - `backend.companyKey`
  - `backend.platform`
  - `backend.clientsDbBaseUrl`
  - `backend.otcKycValidityDays` (opcional): quantos dias um `counterparty_kyc` OTC aprovado continua valido no login. Use `0` para desabilitar a expiracao e nao forcar revalidacao.
  - `backend.localPaymentAssetByCountry`
  - `backend.didit.apiBaseUrl`
- `backend.didit.callbackUrl` (opcional no JSON publico; prefira configurar no backend via `DIDIT_CALLBACK_URL`)
- `backend.didit.waitingUrl` (opcional no JSON publico; prefira configurar no backend via `DIDIT_WAITING_URL`)
- `backend.didit.documentVerificationWorkflowId` (opcional no JSON publico; prefira configurar no backend via `DIDIT_DOCUMENT_VERIFICATION_WORKFLOW_ID`)
- `backend.didit.biometricValidationWorkflowId` (opcional no JSON publico; prefira configurar no backend via `DIDIT_BIOMETRIC_VALIDATION_WORKFLOW_ID`)
  - `backend.didit.documentVerificationValidityDays` (opcional): quantos dias uma verificação documental **aprovada** permanece válida para permitir apenas o fluxo de biometria facial (`biometric_validation`). Use `0` para desabilitar esse limite. Ex.: `365` = válido apenas se concluído dentro do último ano (quando a API Didit envia timestamps parseáveis).
  - `backend.didit.sdkMode`
- Endpoints reservados:
  - `endpoints.quoteBaseUrl` — para modo real no browser, use `""` (same-origin) ou `mock://quote`. O frontend chama `POST /otc/get_pricing` com `{ document, client_data }` (ambos `null` se anonimo) e tambem `POST /otc/get_transaction_history` / `POST /otc/get_counterparty_transactional_limit`. URLs absolutas para OTC deixaram de ser o fluxo suportado no browser.
  - `endpoints.customerBaseUrl`
  - `endpoints.paymentBaseUrl`
  - `endpoints.orderBaseUrl` — para persistencia e updates de `'/order/:id'`, use `""` em modo real (same-origin com FastAPI) ou `mock://order` se quiser desabilitar o polling remoto.
- Persistencia de pedidos:
  - `orderPersistence.ttlMs` — por quanto tempo `'/order/:id'` continua acessivel localmente e no backend temporario.
  - `orderPersistence.pollIntervalMs` — intervalo do polling da pagina do pedido para consultar updates no backend.
- Pagina do pedido:
  - `orderPage.backgroundColor`, `cardBackgroundColor`, `cardBorderColor`, `titleColor`, `textColor`, `mutedTextColor` — identidade visual da tela `/order/:id`, separada da tela inicial.
  - `orderPage.timer.durationSeconds` — duracao do countdown de pagamento.
  - `orderPage.timer.warningThresholdSeconds` — ponto em segundos para ativar o estado visual de urgencia do timer.
  - `orderPage.timer.normal` / `orderPage.timer.warning` — cores de fundo, borda e texto do timer nos estados normal e warning.
  - `orderPage.texts.*` — todos os textos principais da tela do pedido, incluindo labels, CTA de copiar PIX, `paymentSubmittedButtonLabel` / `undoPaymentSubmittedButtonLabel`, `sellDepositNetworkNotice`, `buyPaymentOwnershipNotice` e mensagens dos estados `payment_timeout`, `payment_submitted`, `payment_processing` e `order_concluded`.
  - Estados do card de status (`paymentSubmitted`, `paymentTimeout`, `paymentProcessing`, `orderConcluded`, `paymentUpdateTimeout`, `orderUpdateTimeout`, `paymentReproved`): use `title` no badge superior e `html` (HTML livre) no quadrante. `paymentSubmitted` = cliente marcou "Já realizei o pagamento" (ainda sem confirmação do backend). `paymentProcessing` = pagamento reconhecido pelo backend (`template: payment_processing`, `status: processing`). Placeholders no HTML: `{orderId}`, `{orderNumber}`, `{supportEmail}`, `{companyName}`, `{email}`, `{status}`, `{statusLabel}`, `{tradeSide}`, `{tradeSideLabel}`, `{asset}`, `{payValue}`, `{receiveValue}`, `{receivingData}` e `{undoPaymentSubmittedButton}`. O placeholder `{undoPaymentSubmittedButton}` injeta o botao real "Voltar ao pagamento" dentro do HTML configurado e so aparece quando o pedido estiver no estado local de `paymentSubmitted`; se nao for usado no HTML, o botao continua sendo renderizado abaixo do card como fallback. Configs antigas com `emoji` + `message` ou chave `paymentRecognized` continuam válidas para `paymentProcessing` (convertidas automaticamente).
- Tema visual:
  - `primaryColor`
  - `theme.cssVariables`

### CORS e desenvolvimento local

O browser **nao** deve chamar APIs externas diretamente. O fluxo suportado e:

- **producao / preview real**: Browser -> FastAPI da aplicacao -> upstreams externos
- **Vite dev (HMR)**: Browser -> Vite (`localhost:5173`) -> proxy para FastAPI local -> upstreams externos

Para `npm run dev`, criar `.env.development` na raiz (veja [.env.development.example](.env.development.example)) com:

- `VITE_APP_BACKEND_ORIGIN=http://127.0.0.1:8000`

Com isso o Vite encaminha **`/otc/*`**, **`/webhook/*`**, **`/api/*`** e **`/health`** para o FastAPI local. O `runtime-config.local.json` deve usar bases reais vazias (`"quoteBaseUrl": ""`, `backend.clientsDbBaseUrl: ""`, `backend.didit.apiBaseUrl: ""`, `endpoints.orderBaseUrl: ""`) ou `mock://...`.

**Nota:** `python -m http.server` ou outro servidor estatico isolado nao consegue fazer o papel de intermediario de dados. Para fluxos reais, sirva o build pelo FastAPI.

### Diagnostico OTC / CORS (checklist rapido)

1. Na aba **Rede**, chamadas de dados devem ir apenas para o mesmo origin da app: `/otc/...`, `/webhook/clients_database`, `/webhook/didit/...`, `/runtime-config...`.
2. **Uvicorn :8000**: no arranque devem aparecer logs como `OTC upstream enabled` e, se configurado, `clients_database upstream enabled`.
3. **Vite :5173**: confirme `.env.development` com `VITE_APP_BACKEND_ORIGIN` e bases reais vazias no runtime-config.
4. Se qualquer request de dados ainda mostrar `https://<dominio-externo>` na Rede, ainda existe bypass de configuracao no frontend.

## Páginas HTML estáticas (termos, políticas, etc.)
Cada instalação pode publicar páginas HTML próprias em `public/legal-pages/`.
- Coloque arquivos como `termos_de_uso.html` nessa pasta (o repositório base mantém a pasta vazia).
- O nome do arquivo vira a rota **sem** `.html`: `termos_de_uso.html` → `/termos_de_uso`.
- Use apenas letras minúsculas, números e underscore no nome (`a-z`, `0-9`, `_`).
- No footer (`footer.legalInfoRight` do runtime-config), link direto: `href="/termos_de_uso"`.
- Cada HTML pode ser um documento completo (`<!DOCTYPE html>`, `<head>`, estilos próprios); a app exibe o conteúdo em tela cheia.
Após adicionar ou remover HTML em desenvolvimento, o Vite recarrega automaticamente a lista de rotas disponíveis.

## Cores e tema

As cores ficam no bloco `theme.cssVariables` do JSON local. As chaves seguem os nomes das variaveis CSS globais do `:root` em `src/app/styles.css`.

Exemplos de variaveis que podem ser ajustadas:

- `--brand-color`
- `--nav-text-color`
- `--nav-text-muted-color`
- `--promo-headline-color`
- `--promo-text-color`
- `--promo-muted-color`
- `--promo-soft-color`
- `--form-text-color`
- `--form-secondary-text-color`
- `--form-muted-text-color`
- `--form-soft-text-color`
- `--form-accent-text-color`
- `--nav-background`
- `--page-background-start`
- `--page-background-end`
- `--page-background-image`
- `--page-background-image-opacity`
- `--page-background-overlay-color`
- `--page-background-overlay-opacity`
- `--text-primary`
- `--text-secondary`
- `--card-background`
- `--ghost-button-background`
- `--ghost-button-border`
- `--payment-slot-background`
- `--modal-overlay-background`

Para usar imagem de fundo com camada de cor por cima, preencha algo como:

```json
{
  "theme": {
    "cssVariables": {
      "--page-background-image": "url('/minha-imagem.jpg')",
      "--page-background-image-opacity": "100",
      "--page-background-overlay-color": "#000000",
      "--page-background-overlay-opacity": "50"
    }
  }
}
```

Regras praticas:

- `--nav-text-color` e `--nav-text-muted-color` controlam os textos da barra superior.
- `--promo-headline-color`, `--promo-text-color`, `--promo-muted-color` e `--promo-soft-color` controlam os textos da coluna esquerda.
- `--form-text-color`, `--form-secondary-text-color`, `--form-muted-text-color`, `--form-soft-text-color` e `--form-accent-text-color` controlam os textos do formulario, resumos e modais.
- `--page-background-image` define a imagem.
- `--page-background-image-opacity` controla a opacidade da imagem.
- `--page-background-overlay-color` define a cor que fica por cima da imagem.
- `--page-background-overlay-opacity` controla a opacidade dessa cor.
- Os campos de opacidade podem ser usados como `0.5` ou como `50`. O sistema converte `50` para `0.5`.

Exemplos:

- Apenas imagem: overlay transparente e opacidade da imagem em `100`.
- Apenas cor: imagem em `none` e overlay com opacidade em `100`.
- Imagem escurecida: imagem em `100`, overlay `#000000` e opacidade `50`.

## Desenvolvimento com exemplos

Se quiser abrir rapidamente um exemplo sem criar o arquivo local, rode o projeto em localhost e use:

- Brasil: [http://localhost:5173/?config=runtime-config.example.br.json](http://localhost:5173/?config=runtime-config.example.br.json)
- Colombia: [http://localhost:5173/?config=runtime-config.example.co.json](http://localhost:5173/?config=runtime-config.example.co.json)

Em localhost, se `public/runtime-config.local.json` nao existir, a aplicacao tambem cai automaticamente no exemplo padrao do Brasil.

## Backend FastAPI da Didit

O projeto pode usar um backend Python simples para:

- proxy da Didit (`/webhook/didit/…`)
- **API intermediaria OTC**: `POST /otc/get_pricing`, `POST /otc/get_transaction_history`, `POST /otc/get_counterparty_transactional_limit` com `OTC_UPSTREAM_API_BASE_URL` (o browser so fala com FastAPI — sem depender de CORS no servidor OTC).
- **API intermediaria clients_database**: `POST /webhook/clients_database` com `CLIENTS_DATABASE_API_BASE_URL` (mesma regra: browser nao fala direto com o upstream).
- `DIDIT_API_KEY` fora do frontend
- servir o build da aplicacao no mesmo processo

### Arquivos do backend

- `backend/logging_middleware.py`
- `backend/main.py`
- `backend/config.py`
- `backend/clients_database_client.py`
- `backend/didit_client.py`
- `backend/otc_client.py` (`OtcUpstreamClient` + logs `didit_proxy.otc_upstream`)
- `backend/routes/clients_database.py`
- `backend/routes/didit.py`
- `backend/routes/otc.py` (`POST /otc/…` face ao upstream OTC)
- `backend/routes/order_updates.py` (`POST/GET /api/order-updates`)
- `backend/order_store.py` (persistencia temporaria em memoria para snapshots e updates)
- `backend/requirements.txt`
- `backend/.env.example`

### Variaveis de ambiente do backend

- `DIDIT_API_KEY`
- `DIDIT_API_BASE_URL` (opcional, default `https://verification.didit.me`)
- `DIDIT_CALLBACK_URL` (recomendado em producao): callback server-side para criacao de sessoes Didit sem expor essa URL no `runtime-config`
- `DIDIT_WAITING_URL` (recomendado em producao): waiting URL server-side para nao expor esse valor ao browser
- `DIDIT_DOCUMENT_VERIFICATION_WORKFLOW_ID` (recomendado em producao): workflow documental server-side
- `DIDIT_BIOMETRIC_VALIDATION_WORKFLOW_ID` (recomendado em producao): workflow biometrico server-side
- `CLIENTS_DATABASE_API_BASE_URL` (opcional, default vazio): quando preenchido, o FastAPI aceita `POST /webhook/clients_database` e reenviara o JSON ao `{base}/webhook/clients_database`; para modo real no browser use `backend.clientsDbBaseUrl: ""`.
- `FRONTEND_DIST_DIR` (opcional, default `dist`)
- `OTC_UPSTREAM_API_BASE_URL` (opcional, default vazio): quando preenchido, o FastAPI aceita apenas **POST** nas rotas OTC suportadas (`/otc/get_pricing`, `/otc/get_transaction_history`, `/otc/get_counterparty_transactional_limit`, `/otc/pre_order_validation`, `/otc/create_order`, `/otc/counterparty_kyc`, `/otc/get_available_withdraw_networks`, `/otc/get_available_deposit_networks`, `/otc/check_wallet_risk`, `/otc/check_pix_key_owner`) e reenviando o JSON ao `{base}/otc/…`; use `"quoteBaseUrl": ""` (ou `otcViaSameOrigin`) no frontend para mesmo origin sem CORS no dominio OTC.
- `ORDER_UPDATES_TTL_MS` (opcional, default `3600000`): TTL em milissegundos para snapshots iniciais de `create_order` e updates recebidos em `/api/order-updates`. O `GET /api/order-updates/{orderId}` renova esse TTL enquanto a tela estiver sendo acompanhada ativamente, mas reaberturas depois desse prazo ainda exigem um valor maior no backend.
- `PROXY_ALLOW_ORIGINS` (opcional, default `http://localhost:5173,http://127.0.0.1:5173`)
- `LOG_LEVEL` (opcional, default `INFO`) nivel do logger `didit_proxy` (requisicoes HTTP de entrada em `didit_proxy.http`, saida para a API Didit em `didit_proxy.upstream`)
- `SEND_EMAIL_URL` (recomendado quando ha OTP por email): endpoint interno usado pelo backend para disparar o email com o codigo OTP
- `REDIS_URL` (recomendado em producao): necessario para OTP server-side; tambem sustenta rate limit, blacklist de IP e contadores de abuso
- `RATE_LIMIT_ENABLED` / `IP_BLACKLIST_ENABLED` / `AUDIT_LOG_ENABLED`: ligam a camada operacional; se Redis estiver ausente, rate limit e blacklist sobem desativados com warning, mas OTP por email passa a devolver `503`
- `RATE_LIMIT_*`: limites por rota (`SEND_EMAIL`, `VERIFY_OTP`, `DIDIT_SESSION`, `CREATE_ORDER`, `GET_PRICING`) e fallback `DEFAULT`
- `IP_AUTO_BLOCK_*`: threshold, janela e TTL do bloqueio automatico por abuso
- `OTP_TTL_SECONDS` (opcional, default `600`): validade do OTP guardado no Redis
- `AUDIT_LOG_DIR` (opcional, default `storage/logs`): pasta onde sao criados ficheiros diarios `audit-YYYY-MM-DD.jsonl`
- `AUDIT_LOG_TIMEZONE` (opcional, default `America/Sao_Paulo`): fuso para definir o dia do ficheiro (virada a meia-noite local)
- `AUDIT_REDIS_QUEUE_KEY` (opcional, default `audit:queue`): fila Redis para escrita sequencial assincrona
- `AUDIT_WORKER_BLOCK_SECONDS` (opcional, default `5`): timeout do `BLPOP` no worker de auditoria
- `ADMIN_SECURITY_TOKEN`: protege `GET/POST/DELETE /admin/security/blacklist` via header `X-Admin-Security-Token`
- `HTTP_LOG_REQUEST_BODY_MAX_CHARS` (opcional, default `8192`) tamanho maximo do trecho do corpo do pedido logado
- `HTTP_LOG_RESPONSE_BODY_MAX_CHARS` (opcional, default `8192`) tamanho maximo do trecho do corpo da resposta logada
- `HTTP_LOG_RESPONSE_BUFFER_MAX_BYTES` (opcional, default `524288`) limite de bytes da resposta agregada em memoria (so rotas com corpo completo no log; ver abaixo)

### Logs HTTP

**Frontend (browser):** ativo em desenvolvimento (`npm run dev`) ou quando `VITE_HTTP_LOG=true` no build. Cada `fetch` gera um grupo no console com metodo, URL completa, caminho (endpoint), preview do corpo enviado e da resposta (truncado; campos sensiveis redigidos). Em producao, ative `VITE_HTTP_LOG` apenas para depuracao (impacto de performance e risco de dados no console).

```bash
VITE_HTTP_LOG=true npm run build
```

**Backend (FastAPI):** o middleware (`didit_proxy.http`) regista metodo, URL/caminho, `request_id`, preview redigido do corpo do pedido, status, tempo e IP. Para rotas de API (`/webhook/*`, `/otc/*`, `/api/*`, `/health`) o corpo da resposta tambem pode ser agregado, respeitando os limites acima. Chamadas HTTP de saida (Didit, OTC, clients_database, foto) aparecem em logs de upstream com o mesmo `request_id`, facilitando correlacao ponta-a-ponta.

**Auditoria JSONL:** quando `AUDIT_LOG_ENABLED=true`, cada evento e enfileirado no Redis (`RPUSH`) e um worker no processo drena a fila com `BLPOP` (FIFO), escrevendo uma linha JSON por evento em `storage/logs/audit-YYYY-MM-DD.jsonl` (dia em `AUDIT_LOG_TIMEZONE`). Sem Redis, a escrita e sincrona no ficheiro do dia com lock de ficheiro (`flock`). Consulta do dia atual: `tail -f storage/logs/audit-$(TZ=America/Sao_Paulo date +%F).jsonl`. Eventos: `otp_email_requested`, `otp_verified`, `didit_session_created`, `order_created`, `order_update_received`, blacklist e rate limit. QR/base64/blob e tokens admin sao removidos/redigidos antes da persistencia.

### Rodar o backend

1. Crie e ative um ambiente virtual Python.
2. Instale as dependencias:

```bash
pip install -r backend/requirements.txt
```

3. Exporte a chave da Didit e os upstreams que usar:

```bash
export DIDIT_API_KEY="sua_chave_didit"
export DIDIT_CALLBACK_URL="https://seu-backend/didit/callback"
export DIDIT_WAITING_URL="https://seu-backend/webhook/didit_waiting"
export DIDIT_DOCUMENT_VERIFICATION_WORKFLOW_ID="workflow-documental"
export DIDIT_BIOMETRIC_VALIDATION_WORKFLOW_ID="workflow-biometrico"
export OTC_UPSTREAM_API_BASE_URL="https://infiniteativosvirtuais.tec.br"
export CLIENTS_DATABASE_API_BASE_URL="https://origin-internal.com.br"
```

4. Rode o proxy:

```bash
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Se o frontend estiver buildado em `dist/`, esse mesmo processo tambem pode servir a aplicacao.

### Configuracao do frontend para usar o backend da app

No `public/runtime-config.local.json`, bases reais do browser devem ficar vazias para usar same-origin, por exemplo:

```json
{
  "backend": {
    "clientsDbBaseUrl": "",
    "otcKycValidityDays": 30,
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
  },
  "orderPersistence": {
    "ttlMs": 3600000,
    "pollIntervalMs": 15000
  },
  "orderPage": {
    "backgroundColor": "#f5f7fb",
    "titleColor": "#0f172a",
    "timer": {
      "durationSeconds": 900,
      "warningThresholdSeconds": 300
    },
    "texts": {
      "title": "Status do pedido"
    }
  }
}
```

Para reduzir exposicao de informacao sensivel no cliente, deixe `callbackUrl`, `waitingUrl` e os workflow IDs da Didit vazios no JSON publico e configure esses valores no `backend/.env`.

### Fluxo BUY real

No fluxo `BUY`, o browser continua falando apenas com a mesma origem da aplicacao, e o FastAPI encaminha para OTC / `clients_database`.

- `counterparty_kyc` roda no cadastro e tambem no login quando `backend.otcKycValidityDays` expira.
- Cliente com ultimo KYC nao aprovado nao consegue negociar.
- `get_available_withdraw_networks` abastece o modal de wallet com taxa no ativo e estimativa em BRL.
- `get_available_deposit_networks` abastece o dropdown de rede no fluxo de venda (SELL); a taxa reduz o valor exibido em "Você recebe".
- `check_wallet_risk` roda antes de salvar a wallet; a wallet so e persistida se `risk_result === "approved"`.
- `check_pix_key_owner` roda antes de salvar a chave PIX/bancária; a chave so e persistida se `key_owner_result === true`. O valor enviado ja passa por validacao regex e normalizacao conforme `pixKeyTypesByCountry` (telefone sempre com `+DDI`, ex.: `+55...`).
- No SELL, `pre_order_validation` e `create_order` enviam `network_info` e `payment_info.network` com o codigo da rede de deposito (ex.: `"BSC"`), e `payment_info.pix_key` com a chave cadastrada no clients_database (normalizada).
- `pre_order_validation` e `create_order` usam contrato **v2** (`version: "v2"`, `kyc_info` com `name`/`document`/`kyc_result`; resposta de pre-order com `input_*`, `output_*`, `fee_*`). `pre_order_validation` roda antes de `create_order`; se `price_is_valid` for falso, a UI chama `get_pricing` de novo, atualiza a cotacao e pede nova confirmacao.
- Quando `create_order` retorna com sucesso, o FastAPI guarda um snapshot temporario do pedido e a pagina `'/order/:id'` pode ser reaberta ate o TTL configurado.
- Updates posteriores do OTC podem ser enviados para `POST /api/order-updates` e a pagina `'/order/:id'` faz polling em `GET /api/order-updates/{orderId}` para consolidar status, `txHash` e metadados de pagamento.
- A tela `'/order/:id'` usa `order.createdAt + orderPage.timer.durationSeconds` para mostrar o countdown de pagamento e troca de visual quando o threshold configurado e atingido.
- Apenas updates mapeados mudam a estrutura da tela: `payment_timeout`/`cancelled`, `payment_processing`/`processing`, `order_concluded`/`concluded` e `payment_reproved`/`reproved` (reembolso após falha de processamento, ex. venda com KYT reprovado).
- O cliente pode marcar localmente "Já Realizei o Pagamento" (persistido no cache do pedido) para exibir `paymentSubmitted` antes do update do backend; pode desfazer enquanto o status continuar `waiting_for_payment`. Quando o backend confirmar, a tela passa para `paymentProcessing`.
- O contrato de `order_info` nos updates usa `input_asset`, `input_amount`, `output_asset`, `output_amount_gross`, `output_amount_net`, `fee_asset`, `fee_fiat`, `payment_instructions` (mesmo conteúdo do `payment_data` do create) e `payment_data_v2` (`payout_identifier`, `refund_identifier`).

### Simular updates manualmente

Durante desenvolvimento, o frontend expõe um helper global para aplicar updates localmente:

```js
window.__OTC_ORDER_UPDATE__?.({
  template: "payment_processing",
  orderInfo: {
    order_id: "203389547237282",
    status: "processing",
    input_asset: "BRL",
    input_amount: 1000,
    output_asset: "USDT",
    output_amount_net: 180.5,
    payment_instructions: {
      network: "BSC",
      wallet_address: "0xabc..."
    }
  }
});
```

Payload HTTP (`POST /api/order-updates`) usa snake_case em `order_info` (ex.: `order_info`, `payment_instructions`, `payment_data_v2`).

Se o frontend estiver sendo servido pelo mesmo FastAPI e no mesmo host, voce tambem pode usar:

```json
{
  "backend": {
    "didit": {
      "apiBaseUrl": "/"
    }
  }
}
```

## Cenarios mock para QA manual

### Cliente existente
- E-mail: `cliente@exemplo.com`
- Resultado esperado: pula OTP/KYC/biometria, carrega perfil e verifica pagamento.

### Cliente novo
- Use qualquer e-mail diferente do acima
- Resultado esperado: OTP -> KYC -> biometria -> pagamento -> confirmacao.

### Sem pagamento cadastrado
- Em ambos os casos, quando sem dados de pagamento: abrir popup de pagamento.

### Pedido
- Confirmar pedido no resumo final
- Redirecionar para `/order/:id`
- Status progride de `created` -> `processing` -> `completed`.
