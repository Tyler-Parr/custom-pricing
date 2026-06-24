import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

const PORT = process.env.PORT || 10000;
const SHOPIFY_STORE_DOMAIN = normalizeShopifyDomain(process.env.SHOPIFY_STORE_DOMAIN);
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const ALLOWED_ORIGINS = buildAllowedOrigins();
const BASE_STICKER_PRICE = Number(process.env.BASE_STICKER_PRICE || 25);
const EXTRA_STICKER_PRICE = Number(process.env.EXTRA_STICKER_PRICE || 5);
const PRICE_PER_SQ_IN = Number(process.env.PRICE_PER_SQ_IN || 0.07);

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    if (ALLOWED_ORIGINS === true || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  credentials: false
}));

app.use(express.json({ limit: '10mb' }));

function buildAllowedOrigins() {
  const configured = (process.env.ALLOWED_ORIGINS || process.env.ALLOWED_ORIGIN || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.includes('*')) {
    return true;
  }

  const shopDomain = normalizeShopifyDomain(process.env.SHOPIFY_STORE_DOMAIN);
  const defaults = [
    'http://127.0.0.1:9292',
    'http://localhost:9292'
  ];

  if (shopDomain) {
    defaults.push(`https://${shopDomain}`);
  }

  return [...new Set([...configured, ...defaults])];
}

function normalizeShopifyDomain(domain) {
  if (!domain || typeof domain !== 'string') return '';
  return domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function normalizeQuantity(quantity) {
  const q = parseInt(quantity, 10);

  if (Number.isNaN(q) || q < 1) {
    throw new Error('Quantity must be at least 1.');
  }

  return q;
}

function normalizeDimensions(width, height) {
  const w = Number(width);
  const h = Number(height);

  if (Number.isNaN(w) || Number.isNaN(h)) {
    throw new Error('Width and height must be valid numbers.');
  }

  if (w < 1 || w > 13) {
    throw new Error('Width must be between 1 and 13 inches.');
  }

  if (h < 1 || h > 22) {
    throw new Error('Height must be between 1 and 22 inches.');
  }

  return { width: w, height: h };
}

function isCustomizerOrder(orderType) {
  return String(orderType || '').toLowerCase() === 'customizer';
}

function calculateCustomizerTotalPrice(quantity) {
  const q = normalizeQuantity(quantity);
  const total = BASE_STICKER_PRICE + Math.max(0, q - 1) * EXTRA_STICKER_PRICE;
  return Number(total.toFixed(2));
}

function calculateTransferPricing(width, height, quantity) {
  const q = normalizeQuantity(quantity);
  const dims = normalizeDimensions(width, height);
  const unitPrice = Number((dims.width * dims.height * PRICE_PER_SQ_IN).toFixed(2));
  const totalPrice = Number((unitPrice * q).toFixed(2));

  return {
    quantity: q,
    width: dims.width,
    height: dims.height,
    unitPrice,
    totalPrice
  };
}

function sanitizeProductTitle(title, fallback) {
  if (!title || typeof title !== 'string') return fallback;
  const cleaned = title.trim();
  return cleaned || fallback;
}

function buildDraftNote(data) {
  const lines = [
    `Order Type: ${data.orderType || ''}`,
    `Selected Product: ${data.productTitle || ''}`,
    `Product Handle: ${data.productHandle || ''}`,
    `Product Image: ${data.productImage || ''}`,
    `User Artwork: ${data.artworkUrl || ''}`,
    `Mockup Preview: ${data.mockupUrl || ''}`,
    `Artwork File Name: ${data.uploadedFileName || ''}`,
    `Mockup Side: ${data.side || ''}`,
    `Apparel Color: ${data.color || ''}`,
    `Apparel Size: ${data.size || ''}`,
    `Width (in): ${data.width || ''}`,
    `Height (in): ${data.height || ''}`,
    `Quantity: ${data.quantity || ''}`
  ];

  if (data.orderType === 'customizer') {
    lines.push(
      `Transfer Count: ${data.quantity || ''}`,
      `Base Garment Price: $${BASE_STICKER_PRICE.toFixed(2)}`,
      `Extra Transfer Price: $${EXTRA_STICKER_PRICE.toFixed(2)}`
    );
  } else {
    lines.push(
      `Area (sq in): ${data.area || ''}`,
      `Rate Per Sq In: $${PRICE_PER_SQ_IN.toFixed(2)}`
    );
  }

  lines.push(
    `Placement X: ${data.placementX ?? ''}`,
    `Placement Y: ${data.placementY ?? ''}`,
    `Placement Width Px: ${data.placementWidthPx ?? ''}`,
    `Placement Height Px: ${data.placementHeightPx ?? ''}`,
    `Frontend Unit Price: ${data.frontendUnitPrice || ''}`,
    `Frontend Total Price: ${data.frontendTotalPrice || ''}`,
    `Calculated Total Price: $${data.totalPrice || ''}`
  );

  return lines.join('\n');
}

function buildLineItem(data) {
  const finalProductTitle = sanitizeProductTitle(
    data.selectedProductLabel || data.productTitle,
    isCustomizerOrder(data.orderType) ? 'Custom DTF Garment' : 'DTF Transfer Sticker'
  );

  const commonProperties = [
    { name: 'Order Type', value: data.orderType || 'transfer' },
    { name: 'Selected Product', value: finalProductTitle },
    { name: 'Product Handle', value: data.productHandle || '' },
    { name: 'Product Image', value: data.productImage || '' },
    { name: 'User Artwork', value: data.artworkUrl || '' },
    { name: 'Mockup Preview', value: data.mockupUrl || '' },
    { name: 'Artwork File Name', value: data.uploadedFileName || '' },
    { name: 'Mockup Side', value: data.side || '' },
    { name: 'Apparel Color', value: data.color || '' },
    { name: 'Apparel Size', value: String(data.size || '') },
    { name: 'Width (in)', value: String(data.width || '') },
    { name: 'Height (in)', value: String(data.height || '') },
    { name: 'Placement X', value: String(data.placementX ?? '') },
    { name: 'Placement Y', value: String(data.placementY ?? '') },
    { name: 'Placement Width Px', value: String(data.placementWidthPx ?? '') },
    { name: 'Placement Height Px', value: String(data.placementHeightPx ?? '') },
    { name: 'Calculated Total Price', value: `$${Number(data.totalPrice).toFixed(2)}` }
  ];

  if (isCustomizerOrder(data.orderType)) {
    return {
      title: `Custom DTF Garment - ${finalProductTitle}`,
      price: Number(data.totalPrice).toFixed(2),
      quantity: 1,
      custom: true,
      properties: [
        ...commonProperties,
        { name: 'Transfer Count', value: String(data.quantity) },
        { name: 'Base Garment Price', value: `$${BASE_STICKER_PRICE.toFixed(2)}` },
        { name: 'Extra Transfer Price', value: `$${EXTRA_STICKER_PRICE.toFixed(2)}` },
        { name: 'Average Price Per Transfer', value: `$${Number(data.unitPrice).toFixed(2)}` }
      ]
    };
  }

  return {
    title: finalProductTitle,
    price: Number(data.unitPrice).toFixed(2),
    quantity: data.quantity,
    custom: true,
    properties: [
      ...commonProperties,
      { name: 'Area (sq in)', value: String(data.area || '') },
      { name: 'Rate Per Sq In', value: `$${PRICE_PER_SQ_IN.toFixed(2)}` },
      { name: 'Calculated Unit Price', value: `$${Number(data.unitPrice).toFixed(2)}` }
    ]
  };
}

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'DTF Draft Order App running',
    pricing: {
      customizer: {
        baseStickerPrice: BASE_STICKER_PRICE,
        extraStickerPrice: EXTRA_STICKER_PRICE
      },
      transfer: {
        pricePerSqIn: PRICE_PER_SQ_IN
      }
    }
  });
});

app.post('/api/create-draft-order', async (req, res) => {
  try {
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return res.status(500).json({
        error: 'Missing Shopify environment variables.'
      });
    }

    const body = req.body || {};
    const {
      artworkUrl,
      mockupUrl,
      uploadedFileName,
      side,
      color,
      size,
      width,
      height,
      quantity,
      placementX,
      placementY,
      placementWidthPx,
      placementHeightPx,
      frontendUnitPrice,
      frontendTotalPrice,
      productTitle,
      productHandle,
      productImage,
      selectedProductLabel,
      orderType,
      area
    } = body;

    if (!artworkUrl) {
      return res.status(400).json({ error: 'Artwork URL is required.' });
    }

    if (!mockupUrl) {
      return res.status(400).json({ error: 'Mockup URL is required.' });
    }

    const resolvedOrderType = isCustomizerOrder(orderType) ? 'customizer' : 'transfer';
    let pricing;

    if (resolvedOrderType === 'customizer') {
      const validatedQuantity = normalizeQuantity(quantity);
      const totalPrice = calculateCustomizerTotalPrice(validatedQuantity);
      pricing = {
        orderType: resolvedOrderType,
        quantity: validatedQuantity,
        unitPrice: Number((totalPrice / validatedQuantity).toFixed(2)),
        totalPrice,
        width,
        height
      };
    } else {
      pricing = {
        orderType: resolvedOrderType,
        ...calculateTransferPricing(width, height, quantity),
        area: area || Number((Number(width) * Number(height)).toFixed(2))
      };
    }

    const finalProductTitle = sanitizeProductTitle(
      selectedProductLabel || productTitle,
      resolvedOrderType === 'customizer' ? 'Custom DTF Garment' : 'DTF Transfer Sticker'
    );

    const lineItemData = {
      orderType: resolvedOrderType,
      selectedProductLabel: finalProductTitle,
      productTitle: finalProductTitle,
      productHandle,
      productImage,
      artworkUrl,
      mockupUrl,
      uploadedFileName,
      side,
      color,
      size,
      width: pricing.width,
      height: pricing.height,
      quantity: pricing.quantity,
      placementX,
      placementY,
      placementWidthPx,
      placementHeightPx,
      unitPrice: pricing.unitPrice,
      totalPrice: pricing.totalPrice,
      area: pricing.area
    };

    const draftPayload = {
      draft_order: {
        line_items: [buildLineItem(lineItemData)],
        note: buildDraftNote({
          ...lineItemData,
          frontendUnitPrice,
          frontendTotalPrice
        }),
        tags: resolvedOrderType === 'customizer' ? 'dtf-customizer-order' : 'dtf-transfer-order'
      }
    };

    const createResp = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/admin/api/2025-01/draft_orders.json`, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': SHOPIFY_ADMIN_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(draftPayload)
    });

    const createData = await createResp.json();

    if (!createResp.ok) {
      return res.status(createResp.status).json({
        error: createData.errors || createData || 'Failed to create draft order.'
      });
    }

    const draftOrder = createData?.draft_order;
    const invoiceUrl = draftOrder?.invoice_url;

    if (!draftOrder?.id) {
      return res.status(500).json({
        error: 'Draft order created but no draft ID returned.'
      });
    }

    return res.json({
      success: true,
      draftOrderId: draftOrder.id,
      invoiceUrl,
      orderType: resolvedOrderType,
      unitPrice: pricing.unitPrice.toFixed(2),
      quantity: pricing.quantity,
      totalPrice: pricing.totalPrice.toFixed(2),
      baseStickerPrice: BASE_STICKER_PRICE.toFixed(2),
      extraStickerPrice: EXTRA_STICKER_PRICE.toFixed(2),
      pricePerSqIn: PRICE_PER_SQ_IN.toFixed(2),
      selectedProduct: finalProductTitle
    });
  } catch (error) {
    console.error('create-draft-order error:', error);
    return res.status(500).json({
      error: error.message || 'Internal server error.'
    });
  }
});

app.listen(PORT, () => {
  console.log(`DTF app running on port ${PORT}`);
});
