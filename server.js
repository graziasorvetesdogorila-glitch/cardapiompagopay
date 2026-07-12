// server.js
// Servidor backend para Grazia Sorvetes - Integração Mercado Pago
// Compatível com mercadopago SDK v2.x

const express = require('express');
const cors = require('cors');
const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');

const app = express();
const PORT = process.env.PORT || 3000;

// ===================================================================
//  CONFIGURACAO DO MERCADO PAGO (v2.x)
//  Crie sua Access Token em: https://www.mercadopago.com.br/developers
// ===================================================================
const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN || 'SUA_ACCESS_TOKEN_AQUI'
});

const preferenceClient = new Preference(client);
const paymentClient = new Payment(client);

app.use(cors());
app.use(express.json());

// Rota de teste
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        loja: 'Grazia Sorvetes - O Sorvete do Gorila',
        mensagem: 'Backend funcionando. Use POST /criar-preferencia para gerar pagamentos.'
    });
});

// ===================================================================
//  ROTA: CRIAR PREFERENCIA DE PAGAMENTO NO MERCADO PAGO
// ===================================================================
app.post('/criar-preferencia', async (req, res) => {
    try {
        const { orderId, clientName, deliveryType, address, ref, paymentMethod, items, total, deliveryFee } = req.body;

        if (!items || items.length === 0) {
            return res.status(400).json({ error: 'Carrinho vazio' });
        }

        if (!clientName) {
            return res.status(400).json({ error: 'Nome do cliente obrigatorio' });
        }

        // Monta os itens para o Mercado Pago
        const mpItems = items.map(item => ({
            title: item.name,
            quantity: item.qty,
            unit_price: parseFloat(item.unitPrice.toFixed(2)),
            currency_id: 'BRL'
        }));

        // Adiciona taxa de entrega como item se houver
        if (deliveryFee > 0) {
            mpItems.push({
                title: 'Taxa de Entrega (3km)',
                quantity: 1,
                unit_price: 6.00,
                currency_id: 'BRL'
            });
        }

        // Determina metodos de pagamento excluidos
        let excludedPaymentTypes = [];

        if (paymentMethod === 'pix') {
            excludedPaymentTypes = ['credit_card', 'debit_card', 'ticket', 'atm', 'bank_transfer'];
        } else if (paymentMethod === 'debito') {
            excludedPaymentTypes = ['credit_card', 'ticket', 'atm', 'bank_transfer'];
        } else if (paymentMethod === 'credito') {
            excludedPaymentTypes = ['debit_card', 'ticket', 'atm', 'bank_transfer'];
        }

        const descricaoItens = items.map(i => `${i.qty}x ${i.name}`).join(', ');
        const tipoEntrega = deliveryType === 'entrega' ? 'Entrega' : 'Retirada';

        // Cria a preferência usando o SDK v2
        const preferenceBody = {
            items: mpItems,
            payer: {
                name: clientName
            },
            external_reference: orderId || 'GZ-' + Date.now(),
            statement_descriptor: 'GRAZIA SORVETES',
            back_urls: {
                success: 'https://graziasorvetes.com.br/sucesso',
                failure: 'https://graziasorvetes.com.br/erro',
                pending: 'https://graziasorvetes.com.br/pendente'
            },
            auto_return: 'approved',
            payment_methods: {
                excluded_payment_types: excludedPaymentTypes,
                installments: 1
            },
            shipments: {
                mode: 'not_specified'
            },
            metadata: {
                client_name: clientName,
                delivery_type: tipoEntrega,
                address: address || '',
                reference_point: ref || '',
                order_description: descricaoItens,
                total: total
            }
        };

        console.log(`[${new Date().toISOString()}] Criando preferencia para pedido ${orderId} - Cliente: ${clientName} - Total: R$ ${total}`);

        const response = await preferenceClient.create({ body: preferenceBody });

        console.log(`[${new Date().toISOString()}] Preferencia criada: ${response.id} - Init Point: ${response.init_point}`);

        res.json({
            id: response.id,
            init_point: response.init_point,
            sandbox_init_point: response.sandbox_init_point
        });

    } catch (error) {
        console.error('Erro ao criar preferencia:', error);
        res.status(500).json({
            error: 'Erro ao criar preferencia de pagamento',
            details: error.message
        });
    }
});

// ===================================================================
//  WEBHOOK - Recebe notificacoes do Mercado Pago
// ===================================================================
app.post('/webhook', async (req, res) => {
    try {
        const { type, data } = req.body;

        if (type === 'payment' && data && data.id) {
            const paymentId = data.id;
            console.log(`[${new Date().toISOString()}] Webhook recebido - Pagamento: ${paymentId}`);

            const payment = await paymentClient.get({ id: paymentId });
            const { status, external_reference, transaction_amount } = payment;

            console.log(`[${new Date().toISOString()}] Pedido ${external_reference} - Status: ${status} - Valor: R$ ${transaction_amount}`);
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Erro no webhook:', error);
        res.status(200).send('OK');
    }
});

// ===================================================================
//  CONSULTAR STATUS DO PAGAMENTO
// ===================================================================
app.get('/pagamento/:paymentId', async (req, res) => {
    try {
        const payment = await paymentClient.get({ id: req.params.paymentId });
        res.json({
            id: payment.id,
            status: payment.status,
            status_detail: payment.status_detail,
            transaction_amount: payment.transaction_amount,
            external_reference: payment.external_reference
        });
    } catch (error) {
        res.status(500).json({ error: 'Erro ao consultar pagamento' });
    }
});

// Inicia servidor
app.listen(PORT, () => {
    console.log(`===========================================`);
    console.log(`  GRAZIA SORVETES - Servidor Backend`);
    console.log(`  Rodando na porta ${PORT}`);
    console.log(`  Mercado Pago: ${process.env.MP_ACCESS_TOKEN ? 'Configurado' : 'NAO CONFIGURADO'}`);
    console.log(`===========================================`);
});
