/**
 * Enum Translations — Traduce IT → FR/DE/ES i valori meta degli attributi Amazon
 * che vengono generati in italiano dall'AI (chiavi DB) e finirebbero in italiano
 * nel flat file di Amazon.fr/.de/.es.
 *
 * Scope: solo i valori degli attributi "enum" e "free-text localizzato" che
 * compaiono nella sezione "Informations produit" / "Product information" del
 * listing live, dove Amazon mostra i valori come sono stati caricati.
 *
 * Se un valore non è nel dizionario, resta in italiano (fallback). Aggiungere
 * man mano che si scoprono valori nuovi dal log.
 */

// ── Dizionari per campo: { itValue: { fr, de, es } } ─────────────────────────

const FAMIGLIA_COLORI = {
  'Bianco':                 { fr: 'Blanc',           de: 'Weiß',          es: 'Blanco' },
  'Bianco e nero':          { fr: 'Noir et blanc',   de: 'Schwarz-Weiß',  es: 'Blanco y negro' },
  'Caldi':                  { fr: 'Chauds',          de: 'Warm',          es: 'Cálido' },
  'Freddi':                 { fr: 'Froids',          de: 'Kühl',          es: 'Fresco' },
  'Luminosi':               { fr: 'Vives',           de: 'Hell',          es: 'Brillantes' },
  'Neutro':                 { fr: 'Neutre',          de: 'Neutral',       es: 'Neutral' },
  'Pastelli':               { fr: 'Pastels',         de: 'Pastell',       es: 'Pasteles' },
  'Scala di grigi':         { fr: 'Nuances de gris', de: 'Graustufen',    es: 'Escala de grises' },
  'Tonalità della terra':   { fr: 'Tons terreux',    de: 'Erdtöne',       es: 'Tonos tierra' },
  'Toni gioiello':          { fr: 'Tons bijoux',     de: 'Juwelentöne',   es: 'Tonos joya' },
};

const STAGIONI = {
  'Tutte le stagioni': { fr: 'Toutes les saisons', de: 'Alle Jahreszeiten', es: 'Todas las estaciones' },
  'Primavera':         { fr: 'Printemps',          de: 'Frühling',          es: 'Primavera' },
  'Estate':            { fr: 'Été',                de: 'Sommer',            es: 'Verano' },
  'Autunno':           { fr: 'Automne',            de: 'Herbst',            es: 'Otoño' },
  'Inverno':           { fr: 'Hiver',              de: 'Winter',            es: 'Invierno' },
};

const COLORE = {
  'Rosso':        { fr: 'Rouge',       de: 'Rot',           es: 'Rojo' },
  'Blu':          { fr: 'Bleu',        de: 'Blau',          es: 'Azul' },
  'Azzurro':      { fr: 'Bleu clair',  de: 'Hellblau',      es: 'Azul claro' },
  'Giallo':       { fr: 'Jaune',       de: 'Gelb',          es: 'Amarillo' },
  'Verde':        { fr: 'Vert',        de: 'Grün',          es: 'Verde' },
  'Nero':         { fr: 'Noir',        de: 'Schwarz',       es: 'Negro' },
  'Bianco':       { fr: 'Blanc',       de: 'Weiß',          es: 'Blanco' },
  'Arancione':    { fr: 'Orange',      de: 'Orange',        es: 'Naranja' },
  'Viola':        { fr: 'Violet',      de: 'Violett',       es: 'Morado' },
  'Rosa':         { fr: 'Rose',        de: 'Rosa',          es: 'Rosa' },
  'Marrone':      { fr: 'Marron',      de: 'Braun',         es: 'Marrón' },
  'Grigio':       { fr: 'Gris',        de: 'Grau',          es: 'Gris' },
  'Oro':          { fr: 'Or',          de: 'Gold',          es: 'Dorado' },
  'Argento':      { fr: 'Argent',      de: 'Silber',        es: 'Plateado' },
  'Beige':        { fr: 'Beige',       de: 'Beige',         es: 'Beis' },
  'Turchese':     { fr: 'Turquoise',   de: 'Türkis',        es: 'Turquesa' },
  'Bordeaux':     { fr: 'Bordeaux',    de: 'Bordeaux',      es: 'Burdeos' },
  'Fucsia':       { fr: 'Fuchsia',     de: 'Fuchsia',       es: 'Fucsia' },
  'Multicolore':  { fr: 'Multicolore', de: 'Mehrfarbig',    es: 'Multicolor' },
};

const TIPO_STANZA = {
  'Soggiorno':         { fr: 'Salon',              de: 'Wohnzimmer',     es: 'Salón' },
  'Sala':              { fr: 'Salon',              de: 'Wohnzimmer',     es: 'Sala' },
  'Salotto':           { fr: 'Salon',              de: 'Wohnzimmer',     es: 'Salón' },
  'Camera da letto':   { fr: 'Chambre',            de: 'Schlafzimmer',   es: 'Dormitorio' },
  'Camera':            { fr: 'Chambre',            de: 'Schlafzimmer',   es: 'Dormitorio' },
  'Camera bambini':    { fr: 'Chambre enfant',     de: 'Kinderzimmer',   es: 'Cuarto para los niños' },
  'Camera bambino':    { fr: 'Chambre enfant',     de: 'Kinderzimmer',   es: 'Cuarto para los niños' },
  'Cameretta':         { fr: 'Chambre enfant',     de: 'Kinderzimmer',   es: 'Cuarto para los niños' },
  'Ufficio':           { fr: 'Bureau',             de: 'Büro',           es: 'Oficina en casa' },
  'Studio':            { fr: 'Bureau',             de: 'Arbeitszimmer',  es: 'Sala de estudio' },
  'Studio medico':     { fr: 'Cabinet médical',    de: 'Arztpraxis',     es: 'Sala de reuniones' },
  'Studio pediatrico': { fr: 'Cabinet pédiatrique',de: 'Kinderarztpraxis', es: 'Sala de reuniones' },
  'Cucina':            { fr: 'Cuisine',            de: 'Küche',          es: 'Cocina' },
  'Bagno':             { fr: 'Salle de bains',     de: 'Badezimmer',     es: 'Baño' },
  'Sala da pranzo':    { fr: 'Salle à manger',     de: 'Esszimmer',      es: 'Comedor' },
  'Ingresso':          { fr: 'Entrée',             de: 'Eingangsbereich',es: 'Hall' },
  'Corridoio':         { fr: 'Couloir',            de: 'Flur',           es: 'Hall' },
  'Hall':              { fr: 'Hall',               de: 'Eingangsbereich',es: 'Hall' },
  'Reception':         { fr: 'Accueil',            de: 'Empfang',        es: 'Hall' },
  'Sala d\'attesa':    { fr: 'Salle d\'attente',   de: 'Wartezimmer',    es: 'Sala de espera' },
  "Sala d'attesa":     { fr: 'Salle d\'attente',   de: 'Wartezimmer',    es: 'Sala de espera' },
  'Open space':        { fr: 'Espace ouvert',      de: 'Großraumbüro',   es: 'Oficina en casa' },
  'Biblioteca':        { fr: 'Bibliothèque',       de: 'Bibliothek',     es: 'Biblioteca' },
  'Ristorante':        { fr: 'Restaurant',         de: 'Restaurant',     es: 'Salón' },
  'Hotel':             { fr: 'Hôtel',              de: 'Hotel',          es: 'Salón' },
};

const TEMA_ANIMALI = {
  'Cavallo':    { fr: 'Cheval',     de: 'Pferd',       es: 'Caballo' },
  'Gatto':      { fr: 'Chat',       de: 'Katze',       es: 'Gato' },
  'Cane':       { fr: 'Chien',      de: 'Hund',        es: 'Perro' },
  'Leone':      { fr: 'Lion',       de: 'Löwe',        es: 'León' },
  'Tigre':      { fr: 'Tigre',      de: 'Tiger',       es: 'Tigre' },
  'Elefante':   { fr: 'Éléphant',   de: 'Elefant',     es: 'Elefante' },
  'Giraffa':    { fr: 'Girafe',     de: 'Giraffe',     es: 'Jirafa' },
  'Scimmia':    { fr: 'Singe',      de: 'Affe',        es: 'Mono' },
  'Uccello':    { fr: 'Oiseau',     de: 'Vogel',       es: 'Ave' },
  'Pesce':      { fr: 'Poisson',    de: 'Fisch',       es: 'Pez' },
  'Delfino':    { fr: 'Dauphin',    de: 'Delfin',      es: 'Delfín' },
  'Balena':     { fr: 'Baleine',    de: 'Wal',         es: 'Ballena' },
  'Unicorno':   { fr: 'Licorne',    de: 'Einhorn',     es: 'Unicornio' },
  'Asino':      { fr: 'Âne',        de: 'Esel',        es: 'Burro' },
  'Gallina':    { fr: 'Poule',      de: 'Henne',       es: 'Gallina' },
  'Mucca':      { fr: 'Vache',      de: 'Kuh',         es: 'Vaca' },
  'Pecora':     { fr: 'Mouton',     de: 'Schaf',       es: 'Oveja' },
  'Coniglio':   { fr: 'Lapin',      de: 'Kaninchen',   es: 'Conejo' },
  'Volpe':      { fr: 'Renard',     de: 'Fuchs',       es: 'Zorro' },
  'Lupo':       { fr: 'Loup',       de: 'Wolf',        es: 'Lobo' },
  'Orso':       { fr: 'Ours',       de: 'Bär',         es: 'Oso' },
  'Cervo':      { fr: 'Cerf',       de: 'Hirsch',      es: 'Ciervo' },
  'Farfalla':   { fr: 'Papillon',   de: 'Schmetterling', es: 'Mariposa' },
};

const PERSONAGGIO = {
  'Coppia':                { fr: 'Couple',              de: 'Paar',                  es: 'Pareja' },
  'Donna':                 { fr: 'Femme',               de: 'Frau',                  es: 'Mujer' },
  'Uomo':                  { fr: 'Homme',               de: 'Mann',                  es: 'Hombre' },
  'Bambino':               { fr: 'Enfant',              de: 'Kind',                  es: 'Niño' },
  'Bambina':               { fr: 'Fillette',            de: 'Mädchen',               es: 'Niña' },
  'Musicista':             { fr: 'Musicien',            de: 'Musiker',               es: 'Músico' },
  'Ballerina':             { fr: 'Danseuse',            de: 'Tänzerin',              es: 'Bailarina' },
  'Ballerino':             { fr: 'Danseur',             de: 'Tänzer',                es: 'Bailarín' },
  'Famiglia':              { fr: 'Famille',             de: 'Familie',               es: 'Familia' },
  'Madre e figlio':        { fr: 'Mère et enfant',      de: 'Mutter und Kind',       es: 'Madre e hijo' },
  'Animali':               { fr: 'Animaux',             de: 'Tiere',                 es: 'Animales' },
  'Figure umane':          { fr: 'Figures humaines',    de: 'Menschliche Figuren',   es: 'Figuras humanas' },
  'Personaggi fantastici': { fr: 'Personnages fantastiques', de: 'Fantasiefiguren',  es: 'Personajes fantásticos' },
  'Figure fantastiche':    { fr: 'Figures fantastiques',de: 'Fabelfiguren',          es: 'Figuras fantásticas' },
};

const USI_CONSIGLIATI = {
  // ── Decorazione ──────────────────────────────────────────────────────────────
  'Decorazione parete':              { fr: 'Décoration murale',              de: 'Wanddekoration',               es: 'Decoración de pared' },
  'Decorazione pareti':              { fr: 'Décoration murale',              de: 'Wanddekoration',               es: 'Decoración de pared' },
  'Decorazione camera':              { fr: 'Décoration chambre',             de: 'Zimmerdekoration',             es: 'Decoración dormitorio' },
  'Decorazione camera da letto':     { fr: 'Décoration chambre à coucher',   de: 'Schlafzimmerdekoration',       es: 'Decoración dormitorio' },
  'Decorazione hotel':               { fr: 'Décoration hôtel',               de: 'Hoteldekoration',              es: 'Decoración hotel' },
  'Decorazione studio medico':       { fr: 'Décoration cabinet médical',     de: 'Arztpraxisdekoration',         es: 'Decoración consultorio médico' },
  // ── Arredamento ──────────────────────────────────────────────────────────────
  'Arredamento casa':                { fr: 'Décoration maison',              de: 'Wohnungseinrichtung',          es: 'Decoración hogar' },
  'Arredamento moderno':             { fr: 'Décoration moderne',             de: 'Moderne Einrichtung',          es: 'Decoración moderna' },
  'Arredamento camera':              { fr: 'Décoration chambre',             de: 'Schlafzimmereinrichtung',      es: 'Decoración dormitorio' },
  'Arredamento soggiorno':           { fr: 'Décoration salon',               de: 'Wohnzimmereinrichtung',        es: 'Decoración salón' },
  'Arredamento interni':             { fr: 'Décoration intérieure',          de: 'Innenraumdekoration',          es: 'Decoración de interiores' },
  'Arredamento creativo':            { fr: 'Décoration créative',            de: 'Kreative Einrichtung',         es: 'Decoración creativa' },
  'Arredamento artistico':           { fr: 'Décoration artistique',          de: 'Künstlerische Einrichtung',    es: 'Decoración artística' },
  'Arredamento professionale':       { fr: 'Décoration professionnelle',     de: 'Professionelle Einrichtung',   es: 'Decoración profesional' },
  'Arredamento ufficio':             { fr: 'Décoration bureau',              de: 'Bürodekoration',               es: 'Decoración oficina' },
  'Arredamento studio professionale':{ fr: 'Décoration studio professionnel',de: 'Professionelles Büro',         es: 'Decoración estudio profesional' },
  'Arredamento locale':              { fr: 'Décoration établissement',       de: 'Lokaldekoration',              es: 'Decoración local' },
  'Arredamento bar':                 { fr: 'Décoration bar',                 de: 'Bardekoration',                es: 'Decoración bar' },
  'Arredamento ristorante':          { fr: 'Décoration restaurant',          de: 'Restaurantdekoration',         es: 'Decoración restaurante' },
  "Arredamento sala d'attesa":       { fr: 'Décoration salle d\'attente',    de: 'Wartezimmerdekoration',        es: 'Decoración sala de espera' },
  'Arredamento casa vacanze':        { fr: 'Décoration maison de vacances',  de: 'Ferienhausdekoration',         es: 'Decoración casa de vacaciones' },
  'Arredo ufficio':                  { fr: 'Décoration bureau',              de: 'Bürodekoration',               es: 'Decoración oficina' },
  'Arredo studio':                   { fr: 'Décoration bureau',              de: 'Arbeitszimmerdeko',             es: 'Decoración estudio' },
  // ── Camera / spazi ───────────────────────────────────────────────────────────
  'Camera bambini':                  { fr: 'Chambre d\'enfant',              de: 'Kinderzimmer',                 es: 'Habitación infantil' },
  'Cameretta bambini':               { fr: 'Chambre d\'enfant',              de: 'Kinderzimmer',                 es: 'Habitación infantil' },
  'Hall hotel':                      { fr: 'Hall d\'hôtel',                  de: 'Hotellobby',                   es: 'Hall hotel' },
  'Spazi professionali':             { fr: 'Espaces professionnels',         de: 'Professionelle Räume',         es: 'Espacios profesionales' },
  'Spazi pubblici':                  { fr: 'Espaces publics',                de: 'Öffentliche Räume',            es: 'Espacios públicos' },
  // ── Uffici / studi ────────────────────────────────────────────────────────────
  'Ufficio':                         { fr: 'Bureau',                         de: 'Büro',                         es: 'Oficina' },
  'Uffici':                          { fr: 'Bureaux',                        de: 'Büros',                        es: 'Oficinas' },
  'Ufficio creativo':                { fr: 'Bureau créatif',                 de: 'Kreativbüro',                  es: 'Oficina creativa' },
  'Ufficio professionale':           { fr: 'Bureau professionnel',           de: 'Professionelles Büro',         es: 'Oficina profesional' },
  'Studio medico':                   { fr: 'Cabinet médical',                de: 'Arztpraxis',                   es: 'Consultorio médico' },
  'Studio pediatrico':               { fr: 'Cabinet pédiatrique',            de: 'Kinderarztpraxis',             es: 'Consultorio pediátrico' },
  'Studio legale':                   { fr: 'Cabinet juridique',              de: 'Kanzlei',                      es: 'Despacho jurídico' },
  'Studio tecnico':                  { fr: 'Cabinet technique',              de: 'Technisches Büro',             es: 'Estudio técnico' },
  // ── Locali commerciali ────────────────────────────────────────────────────────
  'Ristorante':                      { fr: 'Restaurant',                     de: 'Restaurant',                   es: 'Restaurante' },
  'Pizzeria':                        { fr: 'Pizzeria',                       de: 'Pizzeria',                     es: 'Pizzería' },
  'Agenzie immobiliari':             { fr: 'Agences immobilières',           de: 'Immobilienbüros',              es: 'Agencias inmobiliarias' },
  // ── Regalo ───────────────────────────────────────────────────────────────────
  'Regalo':                          { fr: 'Cadeau',                         de: 'Geschenk',                     es: 'Regalo' },
  'Regalo romantico':                { fr: 'Cadeau romantique',              de: 'Romantisches Geschenk',        es: 'Regalo romántico' },
  'Regalo anniversario':             { fr: 'Cadeau anniversaire',            de: 'Jahrestagsgeschenk',           es: 'Regalo aniversario' },
  'Idea regalo anniversario':        { fr: 'Idée cadeau anniversaire',       de: 'Jahrestagsgeschenk-Idee',      es: 'Idea regalo aniversario' },
  'Regalo San Valentin':             { fr: 'Cadeau Saint-Valentin',          de: 'Valentinstagsgeschenk',        es: 'Regalo San Valentín' },
  'Regalo San Valentino':            { fr: 'Cadeau Saint-Valentin',          de: 'Valentinstagsgeschenk',        es: 'Regalo San Valentín' },
  'Regalo compleanno':               { fr: 'Cadeau anniversaire',            de: 'Geburtstagsgeschenk',          es: 'Regalo de cumpleaños' },
  'Regalo matrimonio':               { fr: 'Cadeau mariage',                 de: 'Hochzeitsgeschenk',            es: 'Regalo de boda' },
  'Regalo coppia':                   { fr: 'Cadeau couple',                  de: 'Paargeschenk',                 es: 'Regalo pareja' },
  'Regalo famiglia':                 { fr: 'Cadeau famille',                 de: 'Familiengeschenk',             es: 'Regalo familia' },
  'Regalo nascita':                  { fr: 'Cadeau naissance',               de: 'Geburtsgeschenk',              es: 'Regalo nacimiento' },
  'Regalo Natale':                   { fr: 'Cadeau Noël',                    de: 'Weihnachtsgeschenk',           es: 'Regalo Navidad' },
  'Regalo casa nuova':               { fr: 'Cadeau pendaison crémaillère',   de: 'Einweihungsgeschenk',          es: 'Regalo casa nueva' },
  'Regalo professionale':            { fr: 'Cadeau professionnel',           de: 'Professionelles Geschenk',     es: 'Regalo profesional' },
  'Regalo simbolico':                { fr: 'Cadeau symbolique',              de: 'Symbolisches Geschenk',        es: 'Regalo simbólico' },
  // ── Arte / collezione ─────────────────────────────────────────────────────────
  "Collezione d'arte":               { fr: 'Collection d\'art',              de: 'Kunstsammlung',                es: 'Colección de arte' },
  'Collezione arte':                 { fr: 'Collection d\'art',              de: 'Kunstsammlung',                es: 'Colección de arte' },
  // ── Occasioni ─────────────────────────────────────────────────────────────────
  'Lista nozze':                     { fr: 'Liste de mariage',               de: 'Hochzeitsliste',               es: 'Lista de bodas' },
  'Festa della Donna':               { fr: 'Fête des femmes',                de: 'Frauentag',                    es: 'Día de la Mujer' },
  'Celebrazione femminile':          { fr: 'Célébration féminine',           de: 'Feier der Frauen',             es: 'Celebración femenina' },
};

const FUNZIONI_SPECIALI = {
  'Pronto da appendere':  { fr: 'Prêt à accrocher',  de: 'Fertig zum Aufhängen', es: 'Listo para colgar' },
  'Con telaio in legno':  { fr: 'Avec cadre en bois',de: 'Mit Holzrahmen',       es: 'Con marco de madera' },
  'Leggero':              { fr: 'Léger',             de: 'Leicht',               es: 'Ligera' },
  'Resistente':           { fr: 'Résistant',         de: 'Robust',               es: 'Duradera' },
  'Duraturo':             { fr: 'Durable',           de: 'Langlebig',            es: 'Duradera' },
  'Impermeabile':         { fr: 'Imperméable',       de: 'Wasserfest',           es: 'Impermeable' },
  'Resistente al graffio':{ fr: 'Résistant aux rayures', de: 'Kratzfest',        es: 'Resistente a los arañazos' },
};

const STILE = {
  'Arte Moderna':                       { fr: 'Art moderne',                    de: 'Moderne Kunst',                es: 'Arte Moderno' },
  'Arte Moderna Figurativa':            { fr: 'Art moderne figuratif',           de: 'Figurative Moderne Kunst',     es: 'Arte Moderno Figurativo' },
  'Arte Moderna Espressionista':        { fr: 'Art moderne expressionniste',     de: 'Moderne Expressionistische Kunst', es: 'Arte Moderna Expresionista' },
  'Arte Contemporanea':                 { fr: 'Art contemporain',                de: 'Zeitgenössische Kunst',        es: 'Arte Contemporáneo' },
  'Impressionista':                     { fr: 'Impressionniste',                 de: 'Impressionistisch',            es: 'Impresionista' },
  'Espressionista':                     { fr: 'Expressionniste',                 de: 'Expressionistisch',            es: 'Expresionista' },
  'Espressionismo':                     { fr: 'Expressionnisme',                 de: 'Expressionismus',              es: 'Expresionismo' },
  'Espressionismo Figurativo':          { fr: 'Expressionnisme figuratif',        de: 'Figurativer Expressionismus',  es: 'Expresionismo Figurativo' },
  'Espressionismo Naïf':               { fr: 'Expressionnisme naïf',             de: 'Naiver Expressionismus',       es: 'Expresionismo Naïf' },
  'Neo-Espressionista':                 { fr: 'Néo-expressionniste',             de: 'Neoexpressionistisch',         es: 'Neoexpresionista' },
  'Neo-espressionista':                 { fr: 'Néo-expressionniste',             de: 'Neoexpressionistisch',         es: 'Neoexpresionista' },
  'Neo-Espressionismo':                 { fr: 'Néo-expressionnisme',             de: 'Neoexpressionismus',           es: 'Neoexpresionismo' },
  'Neo-espressionismo':                 { fr: 'Néo-expressionnisme',             de: 'Neoexpressionismus',           es: 'Neoexpresionismo' },
  'Neoespressionismo':                  { fr: 'Néo-expressionnisme',             de: 'Neoexpressionismus',           es: 'Neoexpresionismo' },
  'Astratto':                           { fr: 'Abstrait',                        de: 'Abstrakt',                     es: 'Abstracto' },
  'Figurativo':                         { fr: 'Figuratif',                       de: 'Figurativ',                    es: 'Figurativo' },
  'Figurativo Contemporaneo':           { fr: 'Figuratif contemporain',          de: 'Figurativ Zeitgenössisch',     es: 'Figurativo Contemporáneo' },
  'Neofigurativo':                      { fr: 'Néo-figuratif',                   de: 'Neofigurativ',                 es: 'Neofigurativo' },
  'Pop Art':                            { fr: 'Pop Art',                         de: 'Pop Art',                      es: 'Pop Art' },
  'Cubista':                            { fr: 'Cubiste',                         de: 'Kubistisch',                   es: 'Cubista' },
  'Cubismo':                            { fr: 'Cubisme',                         de: 'Kubismus',                     es: 'Cubismo' },
  'Cubismo Contemporaneo':              { fr: 'Cubisme contemporain',             de: 'Zeitgenössischer Kubismus',    es: 'Cubismo Contemporáneo' },
  'Neo-Cubista':                        { fr: 'Néo-cubiste',                     de: 'Neokubistisch',                es: 'Neocubista' },
  'Neo-Cubismo':                        { fr: 'Néo-cubisme',                     de: 'Neokubismus',                  es: 'Neocubismo' },
  'Neo-Cubista Pop Art':                { fr: 'Néo-cubisme Pop Art',             de: 'Neokubismus Pop Art',          es: 'Neocubismo Pop Art' },
  'Realista':                           { fr: 'Réaliste',                        de: 'Realistisch',                  es: 'Realista' },
  'Surrealista':                        { fr: 'Surréaliste',                     de: 'Surrealistisch',               es: 'Surrealista' },
  'Minimalista':                        { fr: 'Minimaliste',                     de: 'Minimalistisch',               es: 'Minimalista' },
  'Contemporaneo':                      { fr: 'Contemporain',                    de: 'Zeitgenössisch',               es: 'Contemporáneo' },
  'Classico':                           { fr: 'Classique',                       de: 'Klassisch',                    es: 'Clásico' },
  'Moderno':                            { fr: 'Moderne',                         de: 'Modern',                       es: 'Moderno' },
};

const TEMA = {
  'Coppia romantica':      { fr: 'Couple romantique',        de: 'Romantisches Paar',      es: 'Pareja romántica' },
  'Amore':                 { fr: 'Amour',                    de: 'Liebe',                  es: 'Amor' },
  'Amore familiare':       { fr: 'Amour familial',           de: 'Familienliebe',          es: 'Amor familiar' },
  'Musica':                { fr: 'Musique',                  de: 'Musik',                  es: 'Música' },
  'Musica jazz':           { fr: 'Musique jazz',             de: 'Jazzmusik',              es: 'Música jazz' },
  'Jazz':                  { fr: 'Jazz',                     de: 'Jazz',                   es: 'Jazz' },
  'Romanticismo':          { fr: 'Romantisme',               de: 'Romantik',               es: 'Romanticismo' },
  'Vita urbana':           { fr: 'Vie urbaine',              de: 'Stadtleben',             es: 'Vida urbana' },
  'Vita quotidiana':       { fr: 'Vie quotidienne',          de: 'Alltagsleben',           es: 'Vida cotidiana' },
  'Arte urbana':           { fr: 'Art urbain',               de: 'Urban Art',              es: 'Arte urbano' },
  'Natura':                { fr: 'Nature',                   de: 'Natur',                  es: 'Naturaleza' },
  'Paesaggio':             { fr: 'Paysage',                  de: 'Landschaft',             es: 'Paisaje' },
  'Mare':                  { fr: 'Mer',                      de: 'Meer',                   es: 'Mar' },
  'Montagna':              { fr: 'Montagne',                 de: 'Berg',                   es: 'Montaña' },
  'Fiaba':                 { fr: 'Conte',                    de: 'Märchen',                es: 'Cuento' },
  'Favola infantile':      { fr: 'Conte pour enfants',       de: 'Kindermärchen',          es: 'Cuento infantil' },
  'Animali fantastici':    { fr: 'Animaux fantastiques',     de: 'Fabelwesen',             es: 'Animales fantásticos' },
  'Amicizia':              { fr: 'Amitié',                   de: 'Freundschaft',           es: 'Amistad' },
  'Infanzia':              { fr: 'Enfance',                  de: 'Kindheit',               es: 'Infancia' },
  'Mondo dell\'infanzia':  { fr: 'Monde de l\'enfance',      de: 'Kinderwelt',             es: 'Mundo de la infancia' },
  "Mondo dell'infanzia":   { fr: 'Monde de l\'enfance',      de: 'Kinderwelt',             es: 'Mundo de la infancia' },
  'Allegria':              { fr: 'Joie',                     de: 'Freude',                 es: 'Alegría' },
  'Felicità':              { fr: 'Bonheur',                  de: 'Glück',                  es: 'Felicidad' },
  'Festa':                 { fr: 'Fête',                     de: 'Fest',                   es: 'Fiesta' },
  'Festa colorata':        { fr: 'Fête colorée',             de: 'Buntes Fest',            es: 'Fiesta colorida' },
  'Famiglia':              { fr: 'Famille',                  de: 'Familie',                es: 'Familia' },
  'Famiglia reale':        { fr: 'Famille royale',           de: 'Königliche Familie',     es: 'Familia real' },
  'Scena narrativa':       { fr: 'Scène narrative',          de: 'Erzählszene',            es: 'Escena narrativa' },
  'Scena musicale':        { fr: 'Scène musicale',           de: 'Musikszene',             es: 'Escena musical' },
  'Scena allegra':         { fr: 'Scène joyeuse',            de: 'Fröhliche Szene',        es: 'Escena alegre' },
  'Personaggi':            { fr: 'Personnages',              de: 'Figuren',                es: 'Personajes' },
  'Personaggi fantastici': { fr: 'Personnages fantastiques', de: 'Fantasiefiguren',        es: 'Personajes fantásticos' },
  'Figure colorate':       { fr: 'Figures colorées',         de: 'Bunte Figuren',          es: 'Figuras coloridas' },
  'Fantasia colorata':     { fr: 'Fantaisie colorée',        de: 'Bunte Fantasie',         es: 'Fantasía colorida' },
  'Protezione':            { fr: 'Protection',               de: 'Schutz',                 es: 'Protección' },
  'Unione familiare':      { fr: 'Union familiale',          de: 'Familienzusammenhalt',   es: 'Unión familiar' },
  'Abbraccio':             { fr: 'Enlacement',               de: 'Umarmung',               es: 'Abrazo' },
  'Corteggiamento':        { fr: 'Cour',                     de: 'Balz',                   es: 'Cortejo' },
  'Picnic':                { fr: 'Pique-nique',              de: 'Picknick',               es: 'Picnic' },
  'Picnic campestre':      { fr: 'Pique-nique champêtre',    de: 'Ländliches Picknick',    es: 'Picnic campestre' },
  'Crescita':              { fr: 'Croissance',               de: 'Wachstum',               es: 'Crecimiento' },
  'Primi passi':           { fr: 'Premiers pas',             de: 'Erste Schritte',         es: 'Primeros pasos' },
  'Gatto':                 { fr: 'Chat',                     de: 'Katze',                  es: 'Gato' },
};

const EDIZIONE = {
  'Stampa Artistica Moderna':      { fr: 'Impression artistique moderne',      de: 'Moderner Kunstdruck',      es: 'Impresión artística moderna' },
  'Stampa Artistica Contemporanea':{ fr: 'Impression artistique contemporaine',de: 'Zeitgenössischer Kunstdruck',es: 'Impresión artística contemporánea' },
  'Stampa Artistica':              { fr: 'Impression artistique',              de: 'Kunstdruck',               es: 'Impresión artística' },
  'Riproduzione d\'arte':          { fr: 'Reproduction d\'art',                de: 'Kunstreproduktion',        es: 'Reproducción de arte' },
  "Riproduzione d'arte":           { fr: 'Reproduction d\'art',                de: 'Kunstreproduktion',        es: 'Reproducción de arte' },
  'Edizione limitata':             { fr: 'Édition limitée',                    de: 'Limitierte Auflage',       es: 'Edición limitada' },
};

const MOTIVO = {
  'Personaggi e animali':            { fr: 'Personnages et animaux',        de: 'Figuren und Tiere',            es: 'Personajes y animales' },
  'Circo sotto la luna':             { fr: 'Cirque sous la lune',           de: 'Zirkus unter dem Mond',        es: 'Circo bajo la luna' },
  'Famiglia reale simbolica':        { fr: 'Famille royale symbolique',     de: 'Symbolische Königsfamilie',    es: 'Familia real simbólica' },
  'Famiglia con bambino':            { fr: 'Famille avec enfant',           de: 'Familie mit Kind',             es: 'Familia con bebé' },
  'Scena musicale con personaggi':   { fr: 'Scène musicale avec personnages',de: 'Musikszene mit Figuren',      es: 'Escena musical con personajes' },
  'Coppia romantica':                { fr: 'Couple romantique',             de: 'Romantisches Paar',            es: 'Pareja romántica' },
  'Scena di danza':                  { fr: 'Scène de danse',                de: 'Tanzszene',                    es: 'Escena de baile' },
  'Paesaggio urbano':                { fr: 'Paysage urbain',                de: 'Stadtlandschaft',              es: 'Paisaje urbano' },
  'Natura astratta':                 { fr: 'Nature abstraite',              de: 'Abstrakte Natur',              es: 'Naturaleza abstracta' },
  'Figure umane astratte':           { fr: 'Figures humaines abstraites',   de: 'Abstrakte menschliche Figuren',es: 'Figuras humanas abstractas' },
};

// ── Mappa principale nome_attributo → dizionario ─────────────────────────────
const FIELD_DICTS = {
  'Famiglia di colori':              FAMIGLIA_COLORI,
  'Stagioni':                        STAGIONI,
  'Colore':                          COLORE,
  'Tipo di stanza':                  TIPO_STANZA,
  'Tema animali':                    TEMA_ANIMALI,
  'Personaggio rappresentato':       PERSONAGGIO,
  'Usi consigliati per il prodotto': USI_CONSIGLIATI,
  'Funzioni speciali':               FUNZIONI_SPECIALI,
  'Stile':                           STILE,
  'Tema':                            TEMA,
  'Edizione':                        EDIZIONE,
  'Motivo':                          MOTIVO,
};

// Campi che possono contenere multipli valori separati da virgola
const MULTI_VALUE_FIELDS = new Set([
  'Colore',
  'Tipo di stanza',
  'Tema animali',
  'Personaggio rappresentato',
  'Usi consigliati per il prodotto',
  'Funzioni speciali',
  'Stile',
  'Tema',
  'Edizione',
  'Motivo',
]);

// Valori "vuoti" da ignorare sempre
const EMPTY_VALUES = new Set(['', 'N/D', 'n/d', 'nd', '-', '—']);

/**
 * Traduce un valore italiano nella lingua target per un certo attributo.
 * Se l'attributo non è tradotto oppure il valore non è in dizionario, ritorna il
 * valore originale (fallback). Gestisce automaticamente valori multipli
 * separati da virgola per i campi MULTI_VALUE_FIELDS.
 *
 * @param {string} attrName - nome dell'attributo (chiave DB italiana)
 * @param {string} itValue  - valore in italiano dal DB
 * @param {'fr'|'de'|'es'} locale - lingua target
 * @returns {string} valore tradotto, o itValue se nessuna traduzione trovata
 */
function translateEnumValue(attrName, itValue, locale) {
  if (!itValue || EMPTY_VALUES.has(String(itValue).trim())) return itValue;

  const dict = FIELD_DICTS[attrName];
  if (!dict) return itValue;

  const tryOne = (v) => {
    const key = String(v).trim();
    if (!key || EMPTY_VALUES.has(key)) return '';
    const t = dict[key];
    if (t && t[locale]) return t[locale];
    // Log una sola volta per valore sconosciuto (aiuta a manutenere il dizionario)
    if (!tryOne._seen) tryOne._seen = new Set();
    const missKey = `${attrName}::${key}::${locale}`;
    if (!tryOne._seen.has(missKey)) {
      tryOne._seen.add(missKey);
      console.warn(`[enumTranslations] ⚠️ Valore IT senza traduzione ${locale.toUpperCase()}: "${attrName}" → "${key}"`);
    }
    return key; // fallback IT
  };

  if (MULTI_VALUE_FIELDS.has(attrName)) {
    return String(itValue)
      .split(',')
      .map(v => tryOne(v))
      .filter(v => v && !EMPTY_VALUES.has(v))
      .join(', ');
  }

  return tryOne(itValue);
}

module.exports = { translateEnumValue, FIELD_DICTS };
