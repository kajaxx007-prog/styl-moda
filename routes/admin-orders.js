// routes/admin-orders.js
const express = require('express');
const router = express.Router();
const axios = require('axios');
const Order = require('../models/Order');
const Product = require('../models/Product');
const Customer = require('../models/Customer');

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
          orders: [],                  // ← przecinek po tym
          liveVideoId: order.liveVideoId
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
        allSameStatus,
        liveVideoId: group.liveVideoId
      };
    });

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

// GET – formularz edycji zamówienia
router.get('/admin/orders/:id/edit', requireAuth, async (req, res) => {
    const order = await Order.findById(req.params.id).populate('customerId');
    const products = await Product.find().sort({ number: 1 });
    res.render('admin-orders-edit', { order, products });
});

// POST – zapis edycji zamówienia
router.post('/admin/orders/:id/edit', requireAuth, async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.redirect('/admin/orders');

        const { itemProductId, itemVariantId, itemQuantity, newProductId, newVariantId, newQuantity } = req.body;

        if (Array.isArray(itemProductId)) {
            for (let i = 0; i < itemProductId.length; i++) {
                if (!order.items[i]) continue;
                order.items[i].productId = itemProductId[i];
                order.items[i].variantId = itemVariantId[i];
                order.items[i].quantity = parseInt(itemQuantity[i]) || 1;

                const product = await Product.findById(itemProductId[i]);
                if (product) {
                    const variant = product.variants.id(itemVariantId[i]);
                    if (variant) {
                        order.items[i].productName = product.name;
                        order.items[i].color = variant.color;
                        order.items[i].size = variant.size;
                        order.items[i].price = product.sellingPrice;
                    }
                }
            }
        }

        if (newProductId && newVariantId) {
            const product = await Product.findById(newProductId);
            if (product) {
                const variant = product.variants.id(newVariantId);
                if (variant) {
                    order.items.push({
                        productId: product._id,
                        variantId: variant._id,
                        productName: product.name,
                        color: variant.color,
                        size: variant.size,
                        price: product.sellingPrice,
                        quantity: parseInt(newQuantity) || 1
                    });
                }
            }
        }

        order.items = order.items.filter(item => item.quantity > 0);
        order.totalAmount = order.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
        await order.save();
        res.redirect('/admin/orders');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/orders');
    }
});

// GET – formularz nowego zamówienia
router.get('/admin/orders/new', requireAuth, async (req, res) => {
    const customers = await Customer.find().sort({ name: 1 });
    const products = await Product.find().sort({ number: 1 });
    res.render('admin-orders-new', { customers, products });
});

// POST – utwórz nowe zamówienie ręcznie
router.post('/admin/orders/new', requireAuth, async (req, res) => {
    try {
        const { customerId, liveVideoId, productIds, variantIds, quantities } = req.body;

        const customer = await Customer.findById(customerId);
        if (!customer) return res.redirect('/admin/orders');

        const items = [];
        let totalAmount = 0;

        const prodIds = Array.isArray(productIds) ? productIds : [productIds];
        const varIds = Array.isArray(variantIds) ? variantIds : [variantIds];
        const qty = Array.isArray(quantities) ? quantities : [quantities];

        for (let i = 0; i < prodIds.length; i++) {
            if (!prodIds[i] || !varIds[i]) continue;
            const product = await Product.findById(prodIds[i]);
            if (!product) continue;

            const variant = product.variants.id(varIds[i]);
            if (!variant) continue;

            const quantity = parseInt(qty[i]) || 1;
            const price = product.sellingPrice;

            items.push({
                productId: product._id,
                variantId: variant._id,
                productName: product.name,
                color: variant.color,
                size: variant.size,
                price: price,
                quantity: quantity
            });
            totalAmount += price * quantity;
        }

        if (items.length === 0) return res.redirect('/admin/orders');

        const order = new Order({
            customerId: customer._id,
            customerName: customer.name,
            liveVideoId: liveVideoId || 'manual',
            items,
            totalAmount,
            status: 'nowe'
        });
        await order.save();

        res.redirect('/admin/orders');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/orders');
    }
});

module.exports = router;
