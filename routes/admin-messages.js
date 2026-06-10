const express = require('express');
const router = express.Router();
const Customer = require('../models/Customer');
const Message = require('../models/Message');
const axios = require('axios');

function requireAuth(req, res, next) {
    if (!req.session.userId) return res.redirect('/login');
    next();
}

// GET – lista rozmów
router.get('/admin/messages', requireAuth, async (req, res) => {
    const customers = await Customer.find({ messengerPsid: { $ne: null } }).lean();
    for (let c of customers) {
        const lastMsg = await Message.findOne({ customerId: c._id }).sort({ timestamp: -1 });
        c.lastMessage = lastMsg ? `${lastMsg.direction === 'incoming' ? '←' : '→'} ${lastMsg.text}` : '';
        c.unread = await Message.countDocuments({ customerId: c._id, direction: 'incoming' });
    }
    res.render('admin-messages', { customers });
});

// GET – konwersacja z danym klientem
router.get('/admin/messages/:customerId', requireAuth, async (req, res) => {
    const customer = await Customer.findById(req.params.customerId);
    const messages = await Message.find({ customerId: req.params.customerId }).sort({ timestamp: 1 });
    res.json({ customer, messages });
});

// POST – wyślij wiadomość do klienta
router.post('/admin/messages/send', requireAuth, async (req, res) => {
    const { customerId, text } = req.body;
    const customer = await Customer.findById(customerId);
    if (!customer || !customer.messengerPsid) return res.status(400).json({ error: 'Brak PSID' });

    try {
        await axios.post(
            `https://graph.facebook.com/v25.0/me/messages`,
            { recipient: { id: customer.messengerPsid }, message: { text } },
            { params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN } }
        );

        await Message.create({ customerId, psid: customer.messengerPsid, direction: 'outgoing', text });
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.response?.data || err.message });
    }
});

module.exports = router;