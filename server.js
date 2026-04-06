const express = require('express');
const app = express();

app.use(express.json());

// ==================== CONFIGURAÇÕES (MESMAS DO HTML) ====================
const SUPABASE_URL = 'https://vxrilimkplnraqkvvbov.supabase.co';
const ANON_KEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ4cmlsaW1rcGxucmFxa3Z2Ym92Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM0NzU5NDEsImV4cCI6MjA4OTA1MTk0MX0.ZrRkSosCAclqxOHVFpJSisXroipEArHX1bW5qRzfSAU';

const EMAIL = 'developermax2maker@gmail.com';
const SENHA = 'max123ZICO';

const paymentConfigs = {
  mpesa: {
    method: "mpesa",
    amount: 1,
    customer_name: "Developermax2maker",
    customer_email: "developermax2maker@gmail.com"
  },
  emola: {
    method: "emola",
    amount: 296.97,
    customer_name: "de",
    customer_email: "developermax2maker@gmail.com"
  }
};

// ==================== FUNÇÕES AUXILIARES ====================
async function login() {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`
    },
    body: JSON.stringify({ email: EMAIL, password: SENHA })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Erro no login');
  return data.access_token;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ==================== ENDPOINT PRINCIPAL ====================
app.post('/pagar', async (req, res) => {
  try {
    let { method, numero, silent = true } = req.body;

    // Validações básicas
    if (!method || !['mpesa', 'emola'].includes(method)) {
      return res.status(400).json({ success: false, error: 'Método inválido. Use "mpesa" ou "emola"' });
    }
    if (!numero || typeof numero !== 'string' || numero.length < 9) {
      return res.status(400).json({ success: false, error: 'Número inválido' });
    }

    // Validação do prefixo conforme sua regra
    const prefix = numero.substring(0, 2);
    if (method === 'mpesa' && !['84', '85'].includes(prefix)) {
      return res.status(400).json({ success: false, error: 'Para M-Pesa o número deve começar com 84 ou 85' });
    }
    if (method === 'emola' && !['86', '87'].includes(prefix)) {
      return res.status(400).json({ success: false, error: 'Para Emola o número deve começar com 86 ou 87' });
    }

    console.log(`[PAY] Iniciando pagamento ${method.toUpperCase()} → ${numero}`);

    const token = await login();

    // Monta payload
    const config = paymentConfigs[method];
    const payload = {
      ...config,
      msisdn: numero,
      customer_phone: numero,
      reference_description: "Verificação Tigrinho",
      payment_link_id: "d81740c3-0708-4e9a-a7f4-96d4a55f405e",
      order_bump_accepted: false,
      order_bump_amount: 0,
      silent: silent,
      notify_user: !silent,
      send_message: !silent,
      tracking_params: {
        src: null, sck: null, utm_source: null, utm_campaign: null,
        utm_medium: null, utm_content: null, utm_term: null
      }
    };

    // 1. Envia o pagamento
    const payRes = await fetch(`${SUPABASE_URL}/functions/v1/debito-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': ANON_KEY,
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload)
    });

    const payData = await payRes.json();
    if (!payRes.ok) throw new Error(payData.message || 'Erro ao enviar pagamento');

    const reference = payData.debito_reference || payData.reference;
    console.log(`[PAY] Pagamento enviado! Reference: ${reference}`);

    // 2. Polling de status (mesma regra do HTML)
    let attempts = 0;
    const MAX_ATTEMPTS = 40; // ~2 minutos

    while (attempts < MAX_ATTEMPTS) {
      attempts++;
      await sleep(3000); // 3 segundos

      const statusRes = await fetch(
        `${SUPABASE_URL}/functions/v1/debito-status?reference=${reference}&tracking_params=%7B%22src%22%3Anull%2C%22sck%22%3Anull%2C%22utm_source%22%3Anull%2C%22utm_campaign%22%3Anull%2C%22utm_medium%22%3Anull%2C%22utm_content%22%3Anull%2C%22utm_term%22%3Anull%7D`,
        {
          headers: {
            'apikey': ANON_KEY,
            'Authorization': `Bearer ${await login()}`
          }
        }
      );

      const statusData = await statusRes.json();

      console.log(`[STATUS] Tentativa ${attempts} → debito_status: ${statusData.debito_status} | provider: ${statusData.provider_response_code}`);

      // REGRA EXATA QUE VOCÊ PEDIU
      if (statusData.debito_status !== "PROCESSING" && statusData.provider_response_code !== "PENDING") {
        const isSuccess = 
          statusData.success === true ||
          statusData.debito_status === "SUCCESS" ||
          statusData.debito_status === "COMPLETED" ||
          statusData.provider_response_code === "SUCCESS";

        return res.json({
          success: true,
          final_status: statusData.debito_status,
          provider_code: statusData.provider_response_code,
          provider_reference: statusData.provider_reference,
          message: statusData.message || (isSuccess ? "Pagamento aprovado" : "Pagamento não aprovado"),
          isApproved: isSuccess,
          data: statusData
        });
      }
    }

    // Timeout
    return res.json({
      success: false,
      error: "Timeout: pagamento ainda em processamento após 2 minutos",
      reference
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor de pagamentos rodando no Render' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
