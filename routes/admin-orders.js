// routes/admin-orders.js
const express = require('express');
const router = express.Router();
const Order = require('../models/Order');
const Product = require('../models/Product');

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

// GET – lista zamówień pogrupowana (admin)
router.get('/admin/orders', requireAuth, async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 }).populate('customerId');

    const grouped = new Map();
    orders.forEach(order => {
      const createdAt = order.createdAt || new Date();
      const dateKey = createdAt.toISOString().split('T')[0];
      const key = `${order.customerId?._id || 'unknown'}_${dateKey}`;

      if (!grouped.has(key)) {
        grouped.set(key, {
          customerName: order.customerName,
          customerShortId: order.customerId?.shortId || null,
          date: createdAt.toLocaleDateString(),
          items: [],
          totalAmount: 0,
          orders: []   // przechowujemy oryginalne zamówienia
          liveVideoId: order.liveVideoId   // ← dodaj tę linię
        });
      }

      const group = grouped.get(key);
      group.orders.push(order);
      group.items.push(...order.items);
      group.totalAmount += order.totalAmount;
    });

    const groupedOrders = Array.from(grouped.values()).map(group => {
      const statuses = group.orders.map(o => o.status);
      const allSameStatus = statuses.every(s => s === statuses[0]);
      return {
        customerName: group.customerName,
        customerShortId: group.customerShortId,
        date: group.date,
        items: group.items,
        totalAmount: group.totalAmount,
        orderIds: group.orders.map(o => o._id),
        statuses,
        allSameStatus
      };
    });

    // Mapa statusów dla formularzy zmiany (dla każdego zamówienia osobno)
    const orderStatusMap = {};
    orders.forEach(order => {
      orderStatusMap[order._id.toString()] = order.status;
    });

    res.render('admin-orders', { groupedOrders, orderStatusMap });
  } catch (err) {
    console.error(err);
    res.redirect('/admin');
  }
});

// POST – wyślij podsumowania dla danego live
router.post('/admin/orders/send-summaries', requireAuth, async (req, res) => {
    const { liveVideoId } = req.body;
    if (!liveVideoId) return res.redirect('/admin/orders');

    const orders = await Order.find({ liveVideoId }).populate('customerId');

    const customerOrders = {};
    orders.forEach(order => {
        const custId = order.customerId?._id.toString();
        if (!custId) return;
        if (!customerOrders[custId]) customerOrders[custId] = [];
        customerOrders[custId].push(order);
    });

    for (const [custId, orders] of Object.entries(customerOrders)) {
        const customer = orders[0].customerId;
        if (!customer?.messengerPsid) continue;

        let summary = `Twoje podsumowanie zamówienia z live:\n\n`;
        let total = 0;
        orders.forEach(order => {
            order.items.forEach(item => {
                summary += `- ${item.productName} (${item.color}/${item.size}) x${item.quantity} = ${(item.price * item.quantity).toFixed(2)} zł\n`;
                total += item.price * item.quantity;
            });
        });
        summary += `\nŁączna kwota do zapłaty: ${total.toFixed(2)} zł`;

        try {
            await axios.post(
                `https://graph.facebook.com/v25.0/me/messages`,
                { recipient: { id: customer.messengerPsid }, message: { text: summary } },
                { params: { access_token: process.env.FACEBOOK_PAGE_ACCESS_TOKEN } }
            );
            console.log(`✅ Podsumowanie wysłane do ${customer.name}`);
        } catch (err) {
            console.error(`❌ Błąd wysyłania do ${customer.name}:`, err.response?.data || err.message);
        }
    }

    res.redirect('/admin/orders');
});