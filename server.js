import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();

const PORT = process.env.PORT || 10000;
const SHOPIFY_STORE_DOMAIN = normalizeShopifyDomain(process.env.SHOPIFY_STORE_DOMAIN);
const SHOPIFY_ADMIN_ACCESS_TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
const BASE_STICKER_PRICE = Number(process.env.BASE_STICKER_PRICE || 25);
const EXTRA_STICKER_PRICE = Number(process.env.EXTRA_STICKER_PRICE || 5);

app.use(cors({
  origin: ALLOWED_ORIGIN === '*' ? true : ALLOWED_ORIGIN,
  credentials: false
}));

app.use(express.json({ limit: '10mb' }));

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

function calculateDTFTotalPrice(quantity) {
  const q = normalizeQuantity(quantity);
  const total = BASE_STICKER_PRICE + Math.max(0, q - 1) * EXTRA_STICKER_PRICE;
  return Number(total.toFixed(2));
}

function sanitizeProductTitle(title) {
  if (!title || typeof title !== 'string') return 'DTF Transfer Sticker';
  const cleaned = title.trim();
  return cleaned || 'DTF Transfer Sticker';
}

function buildDraftNote(data) {
  return [
    `Selected Product: ${data.productTitle || ''}`,
    `Product Handle: ${data.productHandle || ''}`,
    `Product Image: ${data.productImage || ''}`,
    `User Artwork: ${data.artworkUrl || ''}`,
    `Mockup Preview: ${data.mockupUrl || ''}`,
    `Artwork File Name: ${data.uploadedFileName || ''}`,
    `Mockup Side: ${data.side || ''}`,
    `Apparel Color: ${data.color || ''}`,
    `Width (in): ${data.width || ''}`,
    `Height (in): ${data.height || ''}`,
    `Sticker Quantity: ${data.quantity || ''}`,
    `Placement X: ${data.placementX ?? ''}`,
    `Placement Y: ${data.placementY ?? ''}`,
    `Placement Width Px: ${data.placementWidthPx ?? ''}`,
    `Placement Height Px: ${data.placementHeightPx ?? ''}`,
    `Base Sticker Price: $${BASE_STICKER_PRICE.toFixed(2)}`,
    `Extra Sticker Price: $${EXTRA_STICKER_PRICE.toFixed(2)}`,
    `Frontend Unit Price: ${data.frontendUnitPrice || ''}`,
    `Frontend Total Price: ${data.frontendTotalPrice || ''}`
  ].join('\n');
}

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'DTF Draft Order App running',
    pricing: {
      baseStickerPrice: BASE_STICKER_PRICE,
      extraStickerPrice: EXTRA_STICKER_PRICE
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
      frontendTotalPrice,
      productTitle,
      productHandle,
      productImage,
      selectedProductLabel
    } = req.body || {};

    if (!artworkUrl) {
      return res.status(400).json({ error: 'Artwork URL is required.' });
    }

    if (!mockupUrl) {
      return res.status(400).json({ error: 'Mockup URL is required.' });
    }

    const validatedQuantity = normalizeQuantity(quantity);
    const totalPrice = calculateDTFTotalPrice(validatedQuantity);
    const averageUnitPrice = Number((totalPrice / validatedQuantity).toFixed(2));

    const finalProductTitle = sanitizeProductTitle(
      selectedProductLabel || productTitle || 'DTF Transfer Sticker'
    );

    const draftPayload = {
      draft_order: {
        line_items: [
          {
            title: finalProductTitle,
            price: totalPrice.toFixed(2),
            quantity: 1,
            properties: [
              { name: 'Selected Product', value: finalProductTitle },
              { name: 'Product Handle', value: productHandle || '' },
              { name: 'Product Image', value: productImage || '' },
              { name: 'User Artwork', value: artworkUrl || '' },
              { name: 'Mockup Preview', value: mockupUrl || '' },
              { name: 'Artwork File Name', value: uploadedFileName || '' },
              { name: 'Mockup Side', value: side || '' },
              { name: 'Apparel Color', value: color || '' },
              { name: 'Width (in)', value: String(width || '') },
              { name: 'Height (in)', value: String(height || '') },
              { name: 'Sticker Quantity', value: String(validatedQuantity) },
              { name: 'Placement X', value: String(placementX ?? '') },
              { name: 'Placement Y', value: String(placementY ?? '') },
              { name: 'Placement Width Px', value: String(placementWidthPx ?? '') },
              { name: 'Placement Height Px', value: String(placementHeightPx ?? '') },
              { name: 'Base Sticker Price', value: `$${BASE_STICKER_PRICE.toFixed(2)}` },
              { name: 'Extra Sticker Price', value: `$${EXTRA_STICKER_PRICE.toFixed(2)}` },
              { name: 'Calculated Total Price', value: `$${totalPrice.toFixed(2)}` },
              { name: 'Average Price Per Sticker', value: `$${averageUnitPrice.toFixed(2)}` }
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
          frontendTotalPrice,
          productTitle: finalProductTitle,
          productHandle,
          productImage
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
      unitPrice: averageUnitPrice.toFixed(2),
      quantity: validatedQuantity,
      totalPrice: totalPrice.toFixed(2),
      baseStickerPrice: BASE_STICKER_PRICE.toFixed(2),
      extraStickerPrice: EXTRA_STICKER_PRICE.toFixed(2),
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
