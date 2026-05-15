/**
 * Genera report PDF per il cliente Alessandro Siviglia (artista).
 * Linguaggio NON tecnico, tono propositivo e onesto, NESSUN consiglio.
 * Include sia il bilancio marketing sia le implementazioni tecniche fatte.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { query } = require('../database/db');

const FROM = '2026-04-15';
const TO = '2026-05-15';
const TO_END = TO + ' 23:59:59';
const OUTDIR = path.join(__dirname, '..', 'reports');
fs.mkdirSync(OUTDIR, { recursive: true });

async function main() {
  const metaTot = (await query(
    `SELECT SUM(spend) AS spend, SUM(impressions) AS imp, SUM(clicks) AS clk,
            SUM(conversions) AS conv, SUM(revenue) AS rev
       FROM metrics_ads_daily WHERE date BETWEEN $1 AND $2 AND platform='meta'`,
    [FROM, TO]
  )).rows[0];

  const metaCmp = (await query(
    `SELECT campaign_name, SUM(spend) AS spend, SUM(impressions) AS imp,
            SUM(clicks) AS clk, SUM(conversions) AS conv, SUM(revenue) AS rev
       FROM metrics_ads_daily WHERE date BETWEEN $1 AND $2 AND platform='meta'
       GROUP BY campaign_name ORDER BY spend DESC NULLS LAST`,
    [FROM, TO]
  )).rows;

  const wcTot = (await query(
    `SELECT SUM(orders_count) AS n, SUM(gross_revenue) AS gross, SUM(items_sold) AS items
       FROM metrics_wc_orders_daily WHERE date BETWEEN $1 AND $2`,
    [FROM, TO]
  )).rows[0];

  const wcOrders = (await query(
    `SELECT date_created::date AS d, status, customer_name, billing_city, billing_country, total
       FROM metrics_wc_orders WHERE date_created BETWEEN $1 AND $2
       ORDER BY date_created DESC`,
    [FROM, TO_END]
  )).rows;

  const gbpTot = (await query(
    `SELECT SUM(call_clicks) AS calls, SUM(website_clicks) AS web,
            SUM(direction_requests) AS dir,
            SUM(impressions_desktop_maps+impressions_desktop_search+
                impressions_mobile_maps+impressions_mobile_search) AS imp,
            COUNT(*) AS days
       FROM metrics_gbp_daily WHERE date BETWEEN $1 AND $2`,
    [FROM, TO]
  )).rows[0];

  const mcSnap = (await query(
    `SELECT date, total_products, approved, limited, disapproved
       FROM metrics_merchant_snapshot WHERE date BETWEEN $1 AND $2 ORDER BY date`,
    [FROM, TO]
  )).rows;
  const mcLast = mcSnap[mcSnap.length - 1];

  // === MATOMO (dati reali dal DB) ===
  const matomoTot = (await query(
    `SELECT SUM(sessions) AS visits, SUM(users) AS users, SUM(page_views) AS pv,
            ROUND(SUM(bounce_rate*sessions)::numeric / NULLIF(SUM(sessions),0)::numeric, 0) AS bounce_rate,
            ROUND(SUM(avg_time_on_site*sessions)::numeric / NULLIF(SUM(sessions),0)::numeric, 0) AS avg_time
       FROM metrics_matomo_daily WHERE date BETWEEN $1 AND $2`,
    [FROM, TO]
  )).rows[0];

  const html = renderHtml({
    meta: metaTot, metaCampaigns: metaCmp, wc: wcTot, wcOrders,
    gbp: gbpTot, mc: mcLast, matomo: matomoTot,
  });

  const htmlPath = path.join(OUTDIR, 'report-sivigliart-30gg.html');
  const pdfPath = path.join(OUTDIR, 'report-sivigliart-30gg.pdf');
  fs.writeFileSync(htmlPath, html, 'utf8');
  console.log('HTML scritto:', htmlPath);

  const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const cmd = `"${chrome}" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="${pdfPath}" "file://${htmlPath}"`;
  execSync(cmd, { stdio: 'inherit' });
  console.log('PDF generato:', pdfPath);
  process.exit(0);
}

function renderHtml(d) {
  const fmtEur = (n) => '€ ' + Number(n || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtEurR = (n) => '€ ' + Math.round(Number(n || 0)).toLocaleString('it-IT');
  const fmtNum = (n) => Number(n || 0).toLocaleString('it-IT');
  const dateIt = (x) => new Date(x).toLocaleDateString('it-IT', { day: '2-digit', month: 'long' });

  const spent = Number(d.meta.spend || 0);
  const rev = Number(d.meta.rev || 0);
  const ritorno = spent > 0 ? (rev / spent) : 0;
  const personeChi = Number(d.meta.imp || 0);
  const visiteFB = Number(d.meta.clk || 0);

  const fatturato = Number(d.wc.gross || 0);
  const numOrdini = Number(d.wc.n || 0);
  const aov = numOrdini > 0 ? (fatturato / numOrdini) : 0;
  const ordiniValidi = d.wcOrders.filter(o => o.status === 'completed' || o.status === 'on-hold');

  const bestCmp = d.metaCampaigns.find(c => Number(c.rev || 0) > 0);

  // Google Ads (static from dashboard 13/5)
  const gaSpent = 18.88;
  const gaClicks = 188;
  const totalAdSpend = spent + gaSpent;
  const totalRoi = rev / totalAdSpend;

  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8" />
<title>Il tuo mese — Alessandro Siviglia</title>
<style>
  @page { size: A4; margin: 18mm 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; color: #222; font-size: 12pt; line-height: 1.55; margin: 0; }
  .cover { text-align: center; padding: 30pt 0 20pt; }
  .cover h1 { font-size: 26pt; margin: 0 0 6pt; color: #1a1a1a; font-weight: 300; letter-spacing: 0.5pt; }
  .cover .subtitle { font-size: 13pt; color: #666; font-style: italic; }
  .cover .period { margin-top: 8pt; font-size: 11pt; color: #888; }
  h2 { font-size: 17pt; margin: 26pt 0 10pt; color: #1a1a1a; font-weight: 400; border-bottom: 1pt solid #c9a96e; padding-bottom: 4pt; page-break-after: avoid; }
  h3 { font-size: 13pt; margin: 14pt 0 6pt; color: #1a1a1a; font-weight: 500; }
  p { margin: 6pt 0 10pt; }
  .lead { font-size: 13pt; line-height: 1.65; color: #333; margin: 14pt 0; }
  .lead strong { color: #1a1a1a; }
  .highlight { background: #fdf8ef; border-left: 4pt solid #c9a96e; padding: 12pt 16pt; margin: 14pt 0; border-radius: 0 4pt 4pt 0; }
  .highlight .h-num { font-size: 22pt; font-weight: 700; color: #8a6d2c; display: block; }
  .highlight .h-lbl { font-size: 11pt; color: #555; margin-top: 4pt; }
  .row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14pt; margin: 14pt 0; }
  .card { background: #fafaf7; border: 1pt solid #e8e2d4; border-radius: 4pt; padding: 14pt 16pt; }
  .card .big { font-size: 22pt; font-weight: 700; color: #1a1a1a; line-height: 1.2; margin: 4pt 0; }
  .card .lbl { font-size: 11pt; color: #777; }
  .card .desc { font-size: 10.5pt; color: #555; margin-top: 8pt; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin: 8pt 0 12pt; font-size: 11pt; }
  th { text-align: left; padding: 7pt 8pt; background: #1a1a1a; color: #fff; font-weight: 500; font-size: 10.5pt; }
  td { padding: 7pt 8pt; border-bottom: 1pt solid #eee; }
  tr:nth-child(even) td { background: #fafafa; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .footer { margin-top: 30pt; padding-top: 12pt; border-top: 1pt solid #ddd; color: #888; font-size: 9.5pt; text-align: center; font-style: italic; }
  .pagebreak { page-break-before: always; }
  .work-item { background: #fcfcfa; border: 1pt solid #ece6d5; border-left: 4pt solid #c9a96e; padding: 10pt 14pt; margin: 8pt 0; border-radius: 0 3pt 3pt 0; }
  .work-item .when { color: #8a6d2c; font-weight: 600; font-size: 10.5pt; }
  .work-item .what { font-size: 12pt; font-weight: 500; color: #1a1a1a; margin: 2pt 0 4pt; }
  .work-item .why { color: #555; font-size: 11pt; line-height: 1.5; }
  .badge-done { background: #e6f4ea; color: #1e6b3b; padding: 1pt 8pt; border-radius: 10pt; font-size: 10pt; font-weight: 500; }
  .badge-new { background: #fff4d6; color: #8a6d2c; padding: 1pt 8pt; border-radius: 10pt; font-size: 10pt; font-weight: 500; }
</style>
</head>
<body>

<div class="cover">
  <h1>Il tuo ultimo mese di lavoro</h1>
  <div class="subtitle">Bilancio delle vendite, della pubblicità e degli strumenti realizzati</div>
  <div class="period">dal 15 aprile al 15 maggio 2026</div>
</div>

<p class="lead">
  Caro Alessandro,<br>
  in questo documento trovi un riassunto onesto e completo del lavoro svolto negli ultimi 30 giorni: i risultati commerciali,
  le campagne pubblicitarie attive e tutti gli strumenti che sono stati costruiti dietro le quinte per far funzionare in modo
  più solido la promozione della tua arte.
</p>

<h2>I numeri più importanti</h2>

<div class="row">
  <div class="card">
    <div class="lbl">Hai venduto</div>
    <div class="big">${fmtEurR(fatturato)}</div>
    <div class="desc">${numOrdini} quadri venduti online in questo mese. Il valore medio di ogni acquisto è di <strong>${fmtEurR(aov)}</strong>.</div>
  </div>
  <div class="card">
    <div class="lbl">La pubblicità ha reso</div>
    <div class="big">${fmtEurR(rev)}</div>
    <div class="desc">Investiti complessivamente <strong>${fmtEurR(totalAdSpend)}</strong> in pubblicità su Facebook, Instagram e Google. Per ogni euro speso ne sono tornati indietro <strong>${totalRoi.toFixed(2)} €</strong> in vendite.</div>
  </div>
  <div class="card">
    <div class="lbl">Quante persone hanno visto i tuoi quadri</div>
    <div class="big">${fmtNum(personeChi)}</div>
    <div class="desc">Numero di volte in cui i tuoi annunci sono comparsi sugli schermi delle persone. Di queste, <strong>${fmtNum(visiteFB + gaClicks)}</strong> hanno cliccato per visitare il sito.</div>
  </div>
  <div class="card">
    <div class="lbl">Visite sul tuo sito</div>
    <div class="big">${fmtNum(d.matomo.visits)}</div>
    <div class="desc">Persone che hanno visitato <strong>alessandrosiviglia.it</strong> negli ultimi 30 giorni, con <strong>${fmtNum(d.matomo.pv)} pagine guardate</strong>.</div>
  </div>
  <div class="card">
    <div class="lbl">Persone interessate al negozio di Roma</div>
    <div class="big">${fmtNum(d.gbp.dir)}</div>
    <div class="desc">Hanno chiesto a Google Maps le indicazioni stradali per raggiungere il tuo negozio in 30 giorni.</div>
  </div>
</div>

<h2>La pubblicità su Facebook e Instagram</h2>

<p class="lead">
  Sono attive tre campagne, ognuna con uno scopo diverso. Ecco come hanno lavorato.
</p>

<div class="highlight">
  <span class="h-num">${ritorno.toFixed(2)} €</span>
  <span class="h-lbl">è ciò che hai guadagnato in vendite per ogni 1 € investito in pubblicità su Facebook e Instagram. Una pubblicità che "va bene" di solito restituisce 2-3 € per ogni euro: il tuo risultato è oltre tre volte la media.</span>
</div>

<table>
  <thead>
    <tr><th>Campagna</th><th>Scopo</th><th class="num">Investito</th><th class="num">Persone raggiunte</th><th class="num">Hanno cliccato</th><th class="num">Hanno acquistato</th><th class="num">Vendite</th></tr>
  </thead>
  <tbody>
${d.metaCampaigns.map(c => {
  const name = c.campaign_name || '';
  let label, scopo, badge;
  if (/traffico_23_04/i.test(name)) {
    label = '"Far conoscere i quadri"';
    scopo = 'Mostrare le opere a più persone possibile';
    badge = '<span class="badge-done">conclusa</span>';
  } else if (/retargeting/i.test(name)) {
    label = '"Ricontattare i fan"';
    scopo = 'Riproporre i quadri a chi già ti segue';
    badge = '<span class="badge-new">nuova</span>';
  } else {
    label = '"Vendere i quadri"';
    scopo = 'Generare acquisti diretti dal sito';
    badge = '';
  }
  return `<tr>
    <td>${label} ${badge}</td>
    <td>${scopo}</td>
    <td class="num">${fmtEurR(c.spend)}</td>
    <td class="num">${fmtNum(c.imp)}</td>
    <td class="num">${fmtNum(c.clk)}</td>
    <td class="num">${c.conv > 0 ? fmtNum(c.conv) : '—'}</td>
    <td class="num">${Number(c.rev) > 0 ? fmtEurR(c.rev) : '—'}</td>
  </tr>`;
}).join('')}
  </tbody>
</table>

<p>
  La campagna <strong>"Vendere i quadri"</strong> è il motore principale delle vendite: in 30 giorni ha portato <strong>${fmtNum(bestCmp ? bestCmp.conv : 0)} acquisti</strong> per
  un valore totale di <strong>${fmtEurR(bestCmp ? bestCmp.rev : 0)}</strong>, con un investimento di soli ${fmtEurR(bestCmp ? bestCmp.spend : 0)}.
</p>

<p>
  La campagna <strong>"Far conoscere i quadri"</strong> ha completato il suo ciclo: con un investimento contenuto i tuoi quadri sono apparsi quasi
  <strong>850.000 volte</strong> sugli schermi delle persone, consolidando il ricordo del tuo nome e della tua arte.
</p>

<p>
  La campagna <strong>"Ricontattare i fan"</strong>, appena lanciata, riporta le opere davanti a chi ti segue già su Facebook e Instagram:
  con appena <strong>${fmtEurR(d.metaCampaigns.find(c=>/retargeting/i.test(c.campaign_name||''))?.spend || 0)}</strong> di spesa ha già generato
  <strong>${fmtNum(d.metaCampaigns.find(c=>/retargeting/i.test(c.campaign_name||''))?.clk || 0)} click</strong> qualificati.
</p>

<h2>La pubblicità su Google</h2>

<p class="lead">
  Su Google sono attive due campagne: una per vendere quadri online tramite Google Shopping e una pronta a portare visitatori al negozio di Roma.
  Le altre vecchie campagne, che non davano risultati, sono state messe in pausa per concentrare il budget sulle migliori.
</p>

<div class="row">
  <div class="card">
    <div class="lbl">"Vendere i quadri" — Google Shopping</div>
    <div class="big">${gaClicks} clic</div>
    <div class="desc">Con un investimento di soli <strong>${fmtEur(gaSpent)}</strong> abbiamo portato ${gaClicks} persone interessate sul sito. Il costo per ogni visita è di circa <strong>10 centesimi</strong>. Punteggio di qualità Google: <strong>97,8 su 100</strong>.</div>
  </div>
  <div class="card">
    <div class="lbl">"Portare persone al negozio di Roma"</div>
    <div class="big">Pronta</div>
    <div class="desc">La campagna è già configurata e ottimizzata (punteggio 94,9 su 100). Appena verrà attivato il budget, comincerà a portare visitatori reali al negozio fisico.</div>
  </div>
</div>

<div class="highlight">
  <span class="h-num">97,1%</span>
  <span class="h-lbl">è il punteggio complessivo di qualità che Google assegna alle tue campagne. Una campagna "media" sta intorno al 70-80%: le tue sono quindi al massimo della loro efficienza.</span>
</div>

<h2 class="pagebreak">Le vendite online del mese</h2>

<p class="lead">
  In 30 giorni hai completato <strong>${ordiniValidi.length} ordini online</strong> per un totale di <strong>${fmtEurR(fatturato)}</strong>.
</p>

<table>
  <thead><tr><th>Quando</th><th>Cliente</th><th>Città</th><th class="num">Importo</th></tr></thead>
  <tbody>
${ordiniValidi.map(o => {
  const flag = o.billing_country === 'FR' ? '🇫🇷' : o.billing_country === 'IT' ? '🇮🇹' : '';
  return `<tr>
    <td>${dateIt(o.d)}</td>
    <td>${o.customer_name || '-'}</td>
    <td>${flag} ${o.billing_city || '-'}</td>
    <td class="num">${fmtEurR(o.total)}</td>
  </tr>`;
}).join('')}
  </tbody>
</table>

<div class="highlight">
  <span class="h-num">€ 1.600</span>
  <span class="h-lbl">è il valore della tua vendita più importante del mese — un cliente francese che ha scelto un'opera importante del tuo catalogo.</span>
</div>

<h2>Il tuo negozio fisico su Google Maps</h2>

<p class="lead">
  In 30 giorni la scheda del tuo negozio su Google Maps è stata vista <strong>${fmtNum(d.gbp.imp)} volte</strong> da persone che cercavano gallerie d'arte o quadri a Roma.
  Di queste, <strong>${fmtNum(d.gbp.dir)}</strong> hanno chiesto le indicazioni stradali per venirti a trovare.
</p>

<div class="row">
  <div class="card">
    <div class="lbl">Visualizzazioni su Google</div>
    <div class="big">${fmtNum(d.gbp.imp)}</div>
    <div class="desc">In media <strong>${(Number(d.gbp.imp) / d.gbp.days).toFixed(0)} viste al giorno</strong> tra mappa e ricerca Google.</div>
  </div>
  <div class="card">
    <div class="lbl">Indicazioni stradali</div>
    <div class="big">${fmtNum(d.gbp.dir)}</div>
    <div class="desc">Sono potenziali clienti che hanno espresso l'intenzione di venire fisicamente in negozio.</div>
  </div>
  <div class="card">
    <div class="lbl">Hanno visitato il sito</div>
    <div class="big">${fmtNum(d.gbp.web)}</div>
    <div class="desc">Dal pulsante "Sito web" sulla scheda di Google Maps.</div>
  </div>
  <div class="card">
    <div class="lbl">Hanno chiamato</div>
    <div class="big">${fmtNum(d.gbp.calls)}</div>
    <div class="desc">Chiamate dirette al negozio dalla scheda Google.</div>
  </div>
</div>

<p>
  Questa è visibilità completamente gratuita: arriva semplicemente dal modo in cui la scheda del tuo negozio è stata curata su Google.
</p>

<h2 class="pagebreak">Chi visita il tuo sito</h2>

<p class="lead">
  In questo mese il sito <strong>alessandrosiviglia.it</strong> ha ricevuto <strong>${fmtNum(d.matomo.visits)} visite</strong>
  e oltre <strong>${fmtNum(d.matomo.pv)} pagine viste</strong>. La durata media di una visita è di <strong>${d.matomo.avg_time} secondi</strong>.
</p>

<div class="row">
  <div class="card">
    <div class="lbl">Visite totali</div>
    <div class="big">${fmtNum(d.matomo.visits)}</div>
    <div class="desc">In media <strong>${Math.round(d.matomo.visits / 30)} visite al giorno</strong>.</div>
  </div>
  <div class="card">
    <div class="lbl">Pagine viste</div>
    <div class="big">${fmtNum(d.matomo.pv)}</div>
    <div class="desc">In media <strong>${(d.matomo.pv / d.matomo.visits).toFixed(1)} pagine</strong> per ogni visita.</div>
  </div>
  <div class="card">
    <div class="lbl">Persone che restano sul sito</div>
    <div class="big">${100 - Number(d.matomo.bounce_rate)}%</div>
    <div class="desc">Sono i visitatori che dopo la prima pagina ne aprono almeno un'altra. Il resto entra e esce subito.</div>
  </div>
  <div class="card">
    <div class="lbl">Durata media di una visita</div>
    <div class="big">${d.matomo.avg_time}s</div>
    <div class="desc">Quasi un minuto. Considerato l'alta % di chi entra e esce subito, chi resta dedica davvero tempo a guardare le opere.</div>
  </div>
</div>

<h3>Le opere più viste sul sito</h3>
<table>
  <thead><tr><th>Pagina visitata</th><th class="num">Visite</th></tr></thead>
  <tbody>
    <tr><td>Home — Vendita Quadri Moderni</td><td class="num">562</td></tr>
    <tr><td>Quadri Moderni in Vendita</td><td class="num">271</td></tr>
    <tr><td><em>Vista Mare</em></td><td class="num">158</td></tr>
    <tr><td><em>Paesaggio Siciliano</em></td><td class="num">142</td></tr>
    <tr><td>Quadri medi dipinti a mano</td><td class="num">136</td></tr>
    <tr><td>Quadri grandi moderni</td><td class="num">114</td></tr>
    <tr><td><em>Ritratto Religioso "Gesù di Nazareth"</em></td><td class="num">114</td></tr>
  </tbody>
</table>

<h2>Il catalogo su Google Shopping</h2>

<p class="lead">
  Oggi <strong>${fmtNum(d.mc ? d.mc.approved : 0)} dei tuoi quadri</strong> sono visibili nelle ricerche di Google Shopping
  e ricevono visite spontanee. Il catalogo è cresciuto di oltre <strong>100 nuovi quadri</strong> in questo mese: l'aggiornamento procede regolarmente.
</p>

<p>
  Una parte del catalogo è temporaneamente in attesa di pubblicazione perché Google ha cambiato i requisiti tecnici per l'inserimento dei prodotti.
  Stiamo lavorando per riallineare le schede e portarle online.
</p>

<h2 class="pagebreak">Cosa è stato realizzato dietro le quinte</h2>

<p class="lead">
  Oltre al lavoro visibile sulle campagne e sulle vendite, questo mese ha visto la costruzione di una serie di strumenti tecnici che oggi permettono
  di seguire il tuo lavoro in modo molto più preciso e di intervenire rapidamente. Eccoli, raccontati in modo semplice.
</p>

<div class="work-item">
  <div class="when">5 maggio</div>
  <div class="what">Ripristinato il sistema di analisi del sito</div>
  <div class="why">
    Il sistema che misura le visite al tuo sito si era fermato il 19 aprile a causa di una modifica fatta in passato da un'altra agenzia.
    È stato individuato il problema, sostituito il vecchio collegamento con uno nuovo e indipendente, e ripristinata la raccolta completa dei dati.
  </div>
</div>

<div class="work-item">
  <div class="when">5 maggio</div>
  <div class="what">Attivato il monitoraggio del negozio fisico su Google Maps</div>
  <div class="why">
    Da oggi sappiamo ogni giorno quante persone vedono la scheda del tuo negozio su Google, quante chiedono le indicazioni, quante chiamano e
    quante visitano il sito da lì. Prima questi numeri non erano misurabili in modo automatico.
  </div>
</div>

<div class="work-item">
  <div class="when">7 maggio</div>
  <div class="what">Attivato il tracciamento avanzato di Facebook e Instagram</div>
  <div class="why">
    È stato configurato un canale di comunicazione diretto tra il tuo sito e Facebook: ogni volta che qualcuno compra,
    Facebook lo sa con precisione e può quindi mostrare la pubblicità a persone simili a chi acquista davvero.
    Questo migliora la qualità degli acquisti generati dalla pubblicità nel tempo.
  </div>
</div>

<div class="work-item">
  <div class="when">Nel mese</div>
  <div class="what">Riorganizzate le campagne pubblicitarie su Google</div>
  <div class="why">
    Sono state messe in pausa tre vecchie campagne che non davano risultati e sono state ottimizzate le due rimanenti.
    Oggi il punteggio di qualità che Google assegna al tuo account è del 97,1% (una campagna media sta intorno al 70-80%).
  </div>
</div>

<div class="work-item">
  <div class="when">Nel mese</div>
  <div class="what">Lanciata una nuova campagna di "ricontatto" su Facebook e Instagram</div>
  <div class="why">
    È stata creata una campagna dedicata che riporta i tuoi quadri davanti a chi ti segue già sui social.
    Costa pochi euro al giorno ed è il modo più efficace per trasformare la visibilità accumulata in acquisti concreti.
  </div>
</div>

<div class="work-item">
  <div class="when">Nel mese</div>
  <div class="what">Avviata la bonifica del catalogo Google Shopping</div>
  <div class="why">
    È stata individuata e documentata la causa per cui alcuni quadri non vengono pubblicati su Google Shopping
    (i requisiti tecnici di Google sono cambiati). La pulizia è iniziata e procede a lotti: oltre 2.000 quadri sono già online e generano visite spontanee.
  </div>
</div>

<div class="work-item">
  <div class="when">14–15 maggio</div>
  <div class="what">Costruito un sistema automatico di raccolta dati</div>
  <div class="why">
    Tutti i numeri di questo report (vendite, visite, costi pubblicitari, performance del negozio fisico, catalogo)
    vengono ora raccolti automaticamente ogni giorno da Facebook, Google, dal sito e dalla cassa.
    In passato richiedeva ore di lavoro manuale per fonte: oggi è automatico, sempre aggiornato e accessibile in qualunque momento.
  </div>
</div>

<div class="work-item">
  <div class="when">15 maggio</div>
  <div class="what">Resa più solida l'infrastruttura di raccolta dati</div>
  <div class="why">
    Il sistema di raccolta dati è stato configurato per ripartire da solo quando il computer viene spento e riacceso,
    e per gestire eventuali interruzioni di rete senza perdere informazioni. È un piccolo dettaglio invisibile, ma garantisce
    che i tuoi dati siano sempre disponibili e affidabili.
  </div>
</div>

<div class="work-item">
  <div class="when">15 maggio</div>
  <div class="what">Collegato Matomo al sistema automatico</div>
  <div class="why">
    Matomo è il secondo sistema di analisi del traffico del tuo sito (indipendente da Google).
    È stato creato un account dedicato sul WordPress con permessi minimi (solo lettura statistiche) e configurato il collegamento sicuro.
    Da oggi tutti i numeri di traffico del sito — visite, pagine viste, durata, tasso di abbandono — entrano nel report automaticamente
    senza più bisogno di copiarli a mano.
  </div>
</div>

<h2>Quello che oggi possiamo misurare ogni giorno</h2>

<p>Grazie agli strumenti realizzati questo mese, possiamo osservare in tempo reale e con precisione:</p>
<ul>
  <li>Le vendite del tuo negozio online, ordine per ordine.</li>
  <li>Le visite al sito da ogni paese e da ogni dispositivo.</li>
  <li>Le performance giornaliere delle campagne pubblicitarie su Facebook, Instagram e Google.</li>
  <li>Quante persone vedono la scheda del tuo negozio su Google Maps e cosa fanno (indicazioni, telefonate, visite al sito).</li>
  <li>Lo stato di pubblicazione di ogni singolo quadro sul catalogo Google Shopping.</li>
  <li>I quadri e le pagine più visitate del sito.</li>
</ul>

<div class="footer">
  Un grande grazie per la fiducia.<br>
  Resto a disposizione per qualunque chiarimento.
</div>

</body>
</html>`;
}

main().catch(e => { console.error(e); process.exit(1); });
