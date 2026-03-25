import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

const PORT = process.env.PORT || 10000;
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN;
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const PRICE_PER_SQ_IN = Number(process.env.PRICE_PER_SQ_IN || 0.07);

app.use(cors({
  origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN,
  credentials: false
}));

app.use(express.json({ limit: '10mb' }));

function calculateDTFUnitPrice(width, height) {
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

  return Number((w * h * PRICE_PER_SQ_IN).toFixed(2));
}

function normalizeQuantity(quantity) {
  const q = parseInt(quantity, 10);

  if (Number.isNaN(q) || q < 1) {
    throw new Error('Quantity must be at least 1.');
  }

  return q;
}

function buildDraftNote(data) {
  return [
    `User Artwork: ${data.artworkUrl || ''}`,
    `Mockup Preview: ${data.mockupUrl || ''}`,
    `Artwork File Name: ${data.uploadedFileName || ''}`,
    `Mockup Side: ${data.side || ''}`,
    `Apparel Color: ${data.color || ''}`,
    `Width (in): ${data.width || ''}`,
    `Height (in): ${data.height || ''}`,
    `Quantity: ${data.quantity || ''}`,
    `Placement X: ${data.placementX ?? ''}`,
    `Placement Y: ${data.placementY ?? ''}`,
    `Placement Width Px: ${data.placementWidthPx ?? ''}`,
    `Placement Height Px: ${data.placementHeightPx ?? ''}`,
    `Frontend Unit Price: ${data.frontendUnitPrice || ''}`,
    `Frontend Total Price: ${data.frontendTotalPrice || ''}`
  ].join('\n');
}

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'DTF Draft Order App running'
  });
});

app.post('/api/create-draft-order', async (req, res) => {
  try {
    if (!SHOPIFY_STORE_DOMAIN || !SHOPIFY_ADMIN_ACCESS_TOKEN) {
      return res.status(500).json({
        error: 'Missing Shopify environment variables.'
      });
    }

    const {
      artworkUrl,
      mockupUrl,
      uploadedFileName,
      side,
      color,
      width,
      height,
      quantity,
      placementX,
      placementY,
      placementWidthPx,
      placementHeightPx,
      frontendUnitPrice,
      frontendTotalPrice
    } = req.body || {};

    if (!artworkUrl) {
      return res.status(400).json({ error: 'Artwork URL is required.' });
    }

    if (!mockupUrl) {
      return res.status(400).json({ error: 'Mockup URL is required.' });
    }

    const validatedQuantity = normalizeQuantity(quantity);
    const unitPrice = calculateDTFUnitPrice(width, height);
    const totalPrice = Number((unitPrice * validatedQuantity).toFixed(2));

    const draftPayload = {
      draft_order: {
        line_items: [
          {
            title: 'DTF Transfer Sticker',
            original_unit_price: unitPrice.toFixed(2),
            quantity: validatedQuantity,
            custom: true,
            properties: [
              { name: 'User Artwork', value: artworkUrl || '' },
              { name: 'Mockup Preview', value: mockupUrl || '' },
              { name: 'Artwork File Name', value: uploadedFileName || '' },
              { name: 'Mockup Side', value: side || '' },
              { name: 'Apparel Color', value: color || '' },
              { name: 'Width (in)', value: String(width || '') },
              { name: 'Height (in)', value: String(height || '') },
              { name: 'Quantity', value: String(validatedQuantity) },
              { name: 'Placement X', value: String(placementX ?? '') },
              { name: 'Placement Y', value: String(placementY ?? '') },
              { name: 'Placement Width Px', value: String(placementWidthPx ?? '') },
              { name: 'Placement Height Px', value: String(placementHeightPx ?? '') },
              { name: 'Calculated Unit Price', value: `$${unitPrice.toFixed(2)}` },
              { name: 'Calculated Total Price', value: `$${totalPrice.toFixed(2)}` }
            ]
          }
        ],
        note: buildDraftNote({
          artworkUrl,
          mockupUrl,
          uploadedFileName,
          side,
          color,
          width,
          height,
          quantity: validatedQuantity,
          placementX,
          placementY,
          placementWidthPx,
          placementHeightPx,
          frontendUnitPrice,
          frontendTotalPrice
        }),
        tags: 'dtf-custom-order'
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
      unitPrice: unitPrice.toFixed(2),
      quantity: validatedQuantity,
      totalPrice: totalPrice.toFixed(2)
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