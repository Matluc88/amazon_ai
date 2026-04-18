const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { generateAllAiAttributes, regenerateSingleAttribute, generateAllAiAttributesFR, generateAllAiAttributesDE, generateAllAiAttributesES } = require('../services/anthropicService');
const { compileFixedAndAuto, saveAiValues, saveAiValuesFR, saveAiValuesDE, saveAiValuesES, getProductListing, getProductListingFR, getProductListingDE, getProductListingES, upsertAttributeValue, getCachedKeywords } = require('../services/attributeService');
const { getCerebroPromptSection } = require('../services/cerebroService');

// GET /api/listings — tutti i prodotti con conteggio attributi compilati
router.get('/', async (req, res) => {
  try {
    const result = await query(`
      SELECT 
        p.*,
        COUNT(pav.id) as attributi_compilati,
        (SELECT COUNT(*) FROM attribute_definitions WHERE source != 'SKIP') as attributi_totali
      FROM products p
      LEFT JOIN product_attribute_values pav ON pav.product_id = p.id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Errore get listings:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/listings/:productId — listing completo per sezione
router.get('/:productId', async (req, res) => {
  try {
    const product = await query('SELECT * FROM products WHERE id = $1', [req.params.productId]);
    if (!product.rows[0]) return res.status(404).json({ error: 'Prodotto non trovato' });

    // Passa il prodotto a getProductListing così i campi AUTO hanno
    // sempre il fallback corretto anche senza aver mai rigenerato
    const sections = await getProductListing(req.params.productId, product.rows[0]);
    res.json({ product: product.rows[0], sections });
  } catch (err) {
    console.error('Errore get listing:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/listings/generate/:productId — genera tutti gli attributi
router.post('/generate/:productId', async (req, res) => {
  try {
    const prodResult = await query('SELECT * FROM products WHERE id = $1', [req.params.productId]);
    const product = prodResult.rows[0];
    if (!product) return res.status(404).json({ error: 'Prodotto non trovato' });

    // 1. Compila FIXED + AUTO
    await compileFixedAndAuto(req.params.productId, product);

    // 2. Recupera keyword AI in cache
    const keywords = await getCachedKeywords(req.params.productId);

    // 3. Recupera sezione Cerebro (keyword reali da Helium 10, se cluster associato)
    const cerebroSection = await getCerebroPromptSection(product.cerebro_cluster_id);
    if (cerebroSection) {
      console.log(`[Listings] Cerebro keywords iniettate per prodotto ${req.params.productId} (cluster: ${product.cerebro_cluster_id})`);
    }

    // 4. Genera attributi AI con Claude (keyword AI + Cerebro)
    const aiValues = await generateAllAiAttributes(product, keywords, cerebroSection);
    await saveAiValues(req.params.productId, aiValues);

    // 5. Ritorna il listing completo
    const sections = await getProductListing(req.params.productId, product);
    res.json({ success: true, sections });
  } catch (err) {
    console.error('Errore generazione listing:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/listings/generate-fr/:productId — genera listing FR con AI
router.post('/generate-fr/:productId', async (req, res) => {
  try {
    const prodResult = await query('SELECT * FROM products WHERE id = $1', [req.params.productId]);
    const product = prodResult.rows[0];
    if (!product) return res.status(404).json({ error: 'Prodotto non trovato' });

    const aiValues = await generateAllAiAttributesFR(product, [], '');
    await saveAiValuesFR(req.params.productId, aiValues);

    const attrsFR = await getProductListingFR(req.params.productId);
    res.json({ success: true, attrsFR });
  } catch (err) {
    console.error('Errore generazione listing FR:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/listings/generate-de/:productId — genera listing DE con AI
router.post('/generate-de/:productId', async (req, res) => {
  try {
    const prodResult = await query('SELECT * FROM products WHERE id = $1', [req.params.productId]);
    const product = prodResult.rows[0];
    if (!product) return res.status(404).json({ error: 'Prodotto non trovato' });

    const aiValues = await generateAllAiAttributesDE(product, [], '');
    await saveAiValuesDE(req.params.productId, aiValues);

    const attrsDE = await getProductListingDE(req.params.productId);
    res.json({ success: true, attrsDE });
  } catch (err) {
    console.error('Errore generazione listing DE:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/listings/generate-es/:productId — genera listing ES con AI
router.post('/generate-es/:productId', async (req, res) => {
  try {
    const prodResult = await query('SELECT * FROM products WHERE id = $1', [req.params.productId]);
    const product = prodResult.rows[0];
    if (!product) return res.status(404).json({ error: 'Prodotto non trovato' });

    const aiValues = await generateAllAiAttributesES(product, [], '');
    await saveAiValuesES(req.params.productId, aiValues);

    const attrsES = await getProductListingES(req.params.productId);
    res.json({ success: true, attrsES });
  } catch (err) {
    console.error('Errore generazione listing ES:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/listings/:productId/attribute/:attributeId — aggiorna un singolo attributo
router.put('/:productId/attribute/:attributeId', async (req, res) => {
  try {
    const { value } = req.body;
    await upsertAttributeValue(req.params.productId, req.params.attributeId, value || '', 'MANUAL');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/listings/:productId/bulk — aggiorna più attributi in una volta
router.put('/:productId/bulk', async (req, res) => {
  try {
    const { attributes } = req.body; // [{ attribute_id, value }]
    if (!Array.isArray(attributes)) return res.status(400).json({ error: 'attributes deve essere un array' });

    for (const { attribute_id, value } of attributes) {
      await upsertAttributeValue(req.params.productId, attribute_id, value || '', 'MANUAL');
    }
    res.json({ success: true, updated: attributes.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/listings/:productId/regenerate — rigenera un singolo attributo AI
router.post('/:productId/regenerate', async (req, res) => {
  try {
    const { attribute_id, nome_attributo, current_value } = req.body;

    if (!nome_attributo) return res.status(400).json({ error: 'nome_attributo obbligatorio' });

    // Verifica che l'attributo sia AI
    const attrResult = await query('SELECT * FROM attribute_definitions WHERE id = $1', [attribute_id]);
    const attr = attrResult.rows[0];
    if (!attr || attr.source !== 'AI') {
      return res.status(400).json({ error: 'Questo attributo non è di tipo AI' });
    }

    const prodResult = await query('SELECT * FROM products WHERE id = $1', [req.params.productId]);
    const product = prodResult.rows[0];
    if (!product) return res.status(404).json({ error: 'Prodotto non trovato' });

    const keywords = await getCachedKeywords(req.params.productId);
    const cerebroSection = await getCerebroPromptSection(product.cerebro_cluster_id);
    const result = await regenerateSingleAttribute(product, nome_attributo, current_value, keywords, cerebroSection);

    const newValue = result[nome_attributo] || '';
    await upsertAttributeValue(req.params.productId, attribute_id, newValue, 'AI');

    res.json({ success: true, value: newValue });
  } catch (err) {
    console.error('Errore rigenerazione:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
