const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const Message = require('../models/Message');

// GET – weryfikacja webhooka
router.get('/webhook/messenger', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    if (mode && token === process.env.MESSENGER_VERIFY_TOKEN) {
        console.log('✅ Messenger webhook zweryfikowany');
        return res.status(200).send(challenge);
    }
    res.sendStatus(403);
});

// POST – odbieranie zdarzeń
router.post('/webhook/messenger', async (req, res) => {
    const body = req.body;
    console.log('📩 Messenger event:', JSON.stringify(body, null, 2));
    res.status(200).send('EVENT_RECEIVED');

    if (body.object !== 'page') return;

    for (const entry of body.entry) {
        const messaging = entry.messaging?.[0];
        if (!messaging) continue;

        const psid = messaging.sender.id;
        const referral = messaging.referral?.ref;

        // Powiąż PSID z klientem, jeśli przyszedł z linku
        if (referral && referral.startsWith('customer_')) {
            const customerId = referral.replace('customer_', '');
            await Customer.findByIdAndUpdate(customerId, { messengerPsid: psid });
            console.log(`✅ PSID zapisany dla klienta ${customerId}`);
        }

        // Znajdź klienta po PSID lub utwórz nowego
        let customer = await Customer.findOne({ messengerPsid: psid });
        if (!customer) {
            customer = new Customer({
                facebookId: psid,
                name: 'Użytkownik Messengera',
                messengerPsid: psid
            });
            await customer.save();
        }

        // Zapisz wiadomość
        const msg = messaging.message?.text;
        if (msg) {
            await Message.create({
                customerId: customer._id,
                psid: psid,
                direction: 'incoming',
                text: msg
            });
            console.log(`💬 Wiadomość od ${customer.name}: "${msg}"`);
        }
    }
});

module.exports = router;