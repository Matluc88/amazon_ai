// Script one-shot: interroga GA4 per vedere tutti gli eventi degli ultimi 30gg
// e segnala se c'è qualcosa di WhatsApp-related già tracciato.

require('dotenv').config();
const { runReport } = require('../services/ga4Service');

function formatDate(d) { return d.toISOString().slice(0, 10); }

async function main() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 30);

  const dateFrom = formatDate(from);
  const dateTo = formatDate(to);

  console.log(`\n🔍 Cerco eventi GA4 tra ${dateFrom} e ${dateTo}\n`);

  // 1. Tutti gli eventi con count — per vedere cosa c'è
  const r = await runReport({
    dateFrom, dateTo,
    dimensions: ['eventName'],
    metrics: ['eventCount', 'totalUsers'],
    orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
    limit: 200,
  });

  const events = (r.rows || []).map((row) => ({
    name: row.dimensionValues[0].value,
    count: Number(row.metricValues[0].value),
    users: Number(row.metricValues[1].value),
  }));

  console.log(`📋 Trovati ${events.length} eventi distinti:\n`);
  console.log('Evento'.padEnd(40) + 'Count'.padStart(10) + 'Users'.padStart(10));
  console.log('─'.repeat(60));
  for (const e of events) {
    console.log(e.name.padEnd(40) + String(e.count).padStart(10) + String(e.users).padStart(10));
  }

  // 2. Filtro su pattern WhatsApp-related
  const WA_PATTERNS = ['whatsapp', 'wa_click', 'wa_', 'click_to_chat', 'outbound', 'click'];
  const waEvents = events.filter((e) => {
    const n = e.name.toLowerCase();
    return WA_PATTERNS.some((p) => n.includes(p));
  });

  console.log('\n\n🎯 Eventi potenzialmente WhatsApp-related:\n');
  if (!waEvents.length) {
    console.log('   ❌ Nessuno. Il sito NON traccia i click WhatsApp in GA4.');
    console.log('      Serve far configurare un evento a Marco.\n');
  } else {
    for (const e of waEvents) {
      console.log(`   ✅ ${e.name} — ${e.count} eventi, ${e.users} utenti`);
    }
  }

  // 3. Se c'è un evento "click" generico, proviamo a vedere se ha parametri utili
  const genericClick = events.find((e) => e.name === 'click' || e.name === 'outbound_click');
  if (genericClick) {
    console.log(`\n🔬 Dettaglio evento "${genericClick.name}" — cerco URL outbound:\n`);
    try {
      const r2 = await runReport({
        dateFrom, dateTo,
        dimensions: ['eventName', 'linkUrl'],
        metrics: ['eventCount'],
        orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }],
        limit: 50,
      });
      const urlRows = (r2.rows || []).filter((row) => row.dimensionValues[0].value === genericClick.name);
      for (const row of urlRows) {
        const url = row.dimensionValues[1].value;
        const count = Number(row.metricValues[0].value);
        const flag = url.toLowerCase().includes('wa.me') || url.toLowerCase().includes('whatsapp') ? ' 🎯' : '';
        console.log(`   ${String(count).padStart(6)} × ${url}${flag}`);
      }
    } catch (err) {
      console.log('   (dimensione linkUrl non disponibile per questo evento)');
    }
  }

  console.log('\n✅ Scan completato.\n');
}

main().catch((err) => {
  console.error('❌ Errore:', err.message);
  process.exit(1);
});
