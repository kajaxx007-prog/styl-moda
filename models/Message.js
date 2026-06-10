const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
    psid: String,
    direction: { type: String, enum: ['incoming', 'outgoing'], required: true },
    text: String,
    timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', messageSchema);