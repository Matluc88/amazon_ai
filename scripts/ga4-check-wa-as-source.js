// Verifica: GA4 vede mai "whatsapp" o "wa.me" come sessionSource?
// Se sì, significa che WhatsApp passa il referrer e posso fare attribuzione più forte.

require('dotenv').config();
const { runReport } = require('../services/ga4Service');

function fmt(d) { return d.toISOString().slice(0, 10); }

async function main() {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 90);

  console.log(`\n🔍 GA4 sessionSource ultimi 90gg — cerco WhatsApp/wa.me\n`);

  const r = await runReport({
    dateFrom: fmt(from),
    dateTo: fmt(to),
    dimensions: ['sessionSource', 'sessionMedium'],
    metrics: ['sessions', 'totalUsers', 'conversions'],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 500,
  });

  const rows = (r.rows || []).map((row) => ({
    source: row.dimensionValues[0].value,
    medium: row.dimensionValues[1].value,
    sessions: Number(row.metricValues[0].value),
    users: Number(row.metricValues[1].value),
    conversions: Number(row.metricValues[2].value),
  }));

  console.log(`📋 Sorgenti totali distinte: ${rows.length}\n`);

  // Match diretto
  const waRows = rows.filter((x) => {
    const s = (x.source + ' ' + x.medium).toLowerCase();
    return s.includes('whatsapp') || s.includes('wa.me') || s.includes('l.wa.me');
  });

  if (waRows.length) {
    console.log('🎯 TROVATE sessioni da WhatsApp:\n');
    for (const r of waRows) {
      console.log(`   ${r.source} / ${r.medium} — ${r.sessions} sessioni, ${r.users} utenti, ${r.conversions} conversioni`);
    }
  } else {
    console.log('❌ Nessuna sessione con source=whatsapp/wa.me.');
    console.log('   Confermato: WhatsApp non passa referrer → tutti i ritorni al sito da WA vengono classificati Direct.\n');
  }

  // Mostro top 15 sorgenti per completezza
  console.log('\n📊 Top 15 sorgenti complessive:\n');
  console.log('Source'.padEnd(40) + 'Medium'.padEnd(20) + 'Sess'.padStart(8) + 'Conv'.padStart(8));
  console.log('─'.repeat(76));
  for (const r of rows.slice(0, 15)) {
    console.log(r.source.padEnd(40) + r.medium.padEnd(20) + String(r.sessions).padStart(8) + String(r.conversions).padStart(8));
  }

  console.log('\n✅ Scan completato.\n');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
